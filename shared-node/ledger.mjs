// Per-task ledger: validated, SHA-signed JSON written under a lock file.
// Node built-ins only. Locking is synchronous.
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync, existsSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";

export const LEDGER_VERSION = 1;
export const STALE_LOCK_MS = 30_000;
export const LOCK_TIMEOUT_MS = 5_000;
// A file's timestamp can run a tick ahead of Date.now(), so a fresh lock must not read as one from the future.
const FUTURE_SLACK_MS = 1_000;

const HEX64 = /^[0-9a-f]{64}$/;
// Shape only, so a well-shaped impossible date stays readable and the gate can treat it as expired.
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/;
export const KINDS = ["code", "plan", "publish"];
// How a rolled-back fix group was kept: a fix commit, uncommitted work (red), a saved artifact with no git ref, or uncommitted work that repeated an approach already rolled back (repeated).
export const ROLLBACK_KINDS = ["commit", "red", "artifact", "repeated"];

// The one predicate for a publish run: kind and taskType agree (the validator holds them to it), so either says it.
export const isPublishRun = (ledger) => ledger.kind === "publish";
const TOP_KEYS = ["v", "seq", "sha", "kind", "taskType", "owner", "task", "plan", "configHash", "gitConfigHash", "policy", "stage", "stages", "gates", "tests", "commits", "retries", "spend", "stop", "needsHuman", "acceptances", "configAcceptances", "checkpoints", "configApproval", "lenses", "fixes", "voidedGates"];

// A ledger the CLI reports as a refusal rather than a crash.
export class LedgerRefused extends Error {}
export class LedgerShaMismatch extends Error {}
export class NoHandEdit extends LedgerRefused {}

// ---------- canonical JSON and sha ----------

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const isPlainObject = (v) => {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

// Throws unless the value survives JSON.stringify/JSON.parse unchanged: only null, booleans, strings,
// finite numbers, arrays and plain objects. Run before hashing so the sha always covers what lands on disk.
function assertJsonValue(value, where) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${where} is a non-finite number (${value}), which JSON cannot hold`);
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) assertJsonValue(value[i], `${where}[${i}]`);
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) assertJsonValue(value[key], `${where}.${key}`);
    return;
  }
  throw new Error(`${where} is not a JSON value (${value === undefined ? "undefined" : Object.prototype.toString.call(value)})`);
}

function computeSha(ledger) {
  const { sha, ...content } = ledger;
  return createHash("sha256").update(canonical(content)).digest("hex");
}

// ---------- validation ----------

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;
const isString = (v) => typeof v === "string";
const isSha = (v) => isString(v) && HEX64.test(v);
const isNullableString = (v) => v === null || typeof v === "string";
const isNonEmptyString = (v) => typeof v === "string" && v !== "";
const isNullableTimestamp = (v) => v === null || (typeof v === "string" && ISO_TIMESTAMP.test(v));

function checkObject(value, path, shape, errors, { closed = true, optional = [] } = {}) {
  if (!isObject(value)) {
    errors.push({ path, message: "must be an object" });
    return;
  }
  for (const [key, [test, message]] of Object.entries(shape)) {
    const child = path ? `${path}.${key}` : key;
    if (!Object.hasOwn(value, key)) {
      if (!optional.includes(key)) errors.push({ path: child, message: "is required" });
    } else if (!test(value[key])) errors.push({ path: child, message: `must be ${message}` });
  }
  if (closed) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(shape, key)) errors.push({ path: path ? `${path}.${key}` : key, message: "is not allowed" });
    }
  }
}

function checkNullableObject(value, path, shape, errors, options) {
  if (value !== null) checkObject(value, path, shape, errors, options);
}

export function validateLedger(ledger) {
  const errors = [];
  checkObject(ledger, "", {
    v: [(x) => x === LEDGER_VERSION, `${LEDGER_VERSION}`],
    seq: [isCount, "a non-negative integer"],
    sha: [isSha, "64 lowercase hex characters"],
    kind: [(x) => KINDS.includes(x), `one of ${KINDS.join(", ")}`],
    taskType: [isNullableString, "a string or null"],
    owner: [() => true, ""],
    task: [isString, "a string"],
    plan: [() => true, ""],
    configHash: [isSha, "64 lowercase hex characters"],
    gitConfigHash: [isSha, "64 lowercase hex characters"],
    policy: [() => true, ""],
    stage: [() => true, ""],
    stages: [Array.isArray, "an array"],
    gates: [isObject, "an object"],
    tests: [isObject, "an object"],
    commits: [(x) => Array.isArray(x) && x.every(isString), "an array of strings"],
    retries: [isObject, "an object"],
    spend: [() => true, ""],
    stop: [() => true, ""],
    needsHuman: [() => true, ""],
    acceptances: [Array.isArray, "an array"],
    configAcceptances: [Array.isArray, "an array"],
    checkpoints: [Array.isArray, "an array"],
    configApproval: [() => true, ""],
    lenses: [isObject, "an object"], // pb stage finish writes "safety-net" (counts and lens names, no finding content); the schema documents it
    fixes: [isObject, "an object"],
    voidedGates: [Array.isArray, "an array"],
    runId: [(x) => isString(x) && x !== "", "a non-empty string"],
  }, errors, { optional: ["acceptances", "configAcceptances", "checkpoints", "runId", "gitConfigHash", "configApproval", "lenses", "fixes", "voidedGates"] });
  if (!isObject(ledger)) return { valid: false, errors };

  for (const key of TOP_KEYS) {
    if (!Object.hasOwn(ledger, key)) continue;
    switch (key) {
      case "owner":
        checkObject(ledger.owner, "owner", { sessionId: [isNullableString, "a string or null"], lastSeen: [isNullableString, "a string or null"] }, errors);
        break;
      case "plan":
        checkObject(ledger.plan, "plan", { path: [isString, "a string"], title: [isString, "a string"] }, errors);
        break;
      case "policy":
        checkObject(ledger.policy, "policy", { mode: [isString, "a string"], source: [isString, "a string"] }, errors);
        break;
      case "stage":
        checkObject(ledger.stage, "stage", {
          name: [isString, "a string"], status: [isString, "a string"], runId: [isNullableString, "a string or null"], attempt: [isCount, "a non-negative integer"],
          startedAt: [isNullableTimestamp, "an ISO 8601 timestamp or null"],
        }, errors, { optional: ["startedAt"] });
        break;
      case "stages":
        if (Array.isArray(ledger.stages)) {
          ledger.stages.forEach((s, i) => checkObject(s, `stages.${i}`, { name: [isString, "a string"], status: [isString, "a string"] }, errors, { closed: false }));
        }
        break;
      case "spend":
        checkObject(ledger.spend, "spend", { agents: [isCount, "a non-negative integer"], tokens: [isCount, "a non-negative integer"] }, errors, { closed: false });
        break;
      case "stop":
        checkNullableObject(ledger.stop, "stop", { reason: [isNonEmptyString, "a non-empty string"], seq: [isCount, "a non-negative integer"], code: [isNonEmptyString, "a non-empty string"] }, errors);
        break;
      case "needsHuman":
        checkNullableObject(ledger.needsHuman, "needsHuman", { gate: [isNonEmptyString, "a non-empty string"], reason: [isString, "a string"], seq: [isCount, "a non-negative integer"], shown: [isObject, "an object"] }, errors, { optional: ["shown"] });
        break;
      case "fixes":
        checkObject(ledger.fixes, "fixes", { rollbacks: [Array.isArray, "an array"] }, errors);
        if (isObject(ledger.fixes) && Array.isArray(ledger.fixes.rollbacks)) {
          ledger.fixes.rollbacks.forEach((r, i) => checkObject(r, `fixes.rollbacks.${i}`, {
            key: [isNonEmptyString, "a non-empty string"], kind: [(x) => ROLLBACK_KINDS.includes(x), `one of ${ROLLBACK_KINDS.join(", ")}`],
            ref: [isNullableString, "a string or null"], sha: [isNullableString, "a string or null"], base: [isNullableString, "a string or null"],
          }, errors));
        }
        break;
      case "voidedGates":
        if (Array.isArray(ledger.voidedGates)) {
          ledger.voidedGates.forEach((v, i) => checkObject(v, `voidedGates.${i}`, { gate: [isNonEmptyString, "a non-empty string"], record: [isObject, "an object"], reason: [isString, "a string"] }, errors));
        }
        break;
      case "acceptances":
        if (Array.isArray(ledger.acceptances)) {
          ledger.acceptances.forEach((a, i) => checkObject(a, `acceptances.${i}`, {
            oldSha: [isSha, "64 lowercase hex characters"], newSha: [isSha, "64 lowercase hex characters"], seq: [isCount, "a non-negative integer"],
          }, errors));
        }
        break;
      case "configApproval":
        checkObject(ledger.configApproval, "configApproval", { source: [(x) => x === "human-cli", "human-cli"] }, errors);
        break;
      case "configAcceptances":
        if (Array.isArray(ledger.configAcceptances)) {
          ledger.configAcceptances.forEach((a, i) => checkObject(a, `configAcceptances.${i}`, {
            oldHash: [isSha, "64 lowercase hex characters"], newHash: [isSha, "64 lowercase hex characters"], seq: [isCount, "a non-negative integer"],
          }, errors));
        }
        break;
      default:
        break;
    }
  }
  if (Object.hasOwn(ledger, "kind") && Object.hasOwn(ledger, "taskType") && (ledger.kind === "publish") !== (ledger.taskType === "publish")) {
    errors.push({ path: "taskType", message: `must be "publish" exactly when kind is "publish"` });
  }
  return { valid: errors.length === 0, errors };
}

function describeErrors(errors) {
  return errors.map((e) => `${e.path || "(root)"} ${e.message}`).join("; ");
}

// ---------- locking ----------
// The lock file holds a unique owner token. A stale lock is removed only by the one waiter that holds
// the exclusive `<lock>.takeover` guard, and only after re-checking under that guard that it is still
// stale. A holder confirms it still owns the lock right before the final rename and releases only a
// lock that still holds its token.

class LockLost extends Error {}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function ageMs(path) {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

// A lock from the future never ages, so it counts as stale: clock skew or a touch must not wedge a run.
const isStale = (age, staleMs) => age !== null && (age > staleMs || age < -FUTURE_SLACK_MS);

function readTextOrNull(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function unlinkQuietly(path) {
  try {
    unlinkSync(path);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}

const newToken = () => `${process.pid}.${randomBytes(8).toString("hex")}`;

function createOwned(path, token) {
  const fd = openSync(path, "wx");
  try {
    writeFileSync(fd, token);
  } finally {
    closeSync(fd);
  }
}

function removeIfOwned(path, token) {
  if (readTextOrNull(path) === token) unlinkQuietly(path);
}

// Returns true when something changed and the caller should retry at once.
function clearStaleLock(lock, staleMs) {
  const guard = `${lock}.takeover`;
  const token = newToken();
  try {
    createOwned(guard, token);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    if (isStale(ageMs(guard), staleMs)) {
      unlinkQuietly(guard);
      return true;
    }
    return false;
  }
  try {
    if (isStale(ageMs(lock), staleMs)) unlinkQuietly(lock);
    return true;
  } finally {
    removeIfOwned(guard, token);
  }
}

function acquireLock(lock, token, { staleMs, timeoutMs, deadline }) {
  for (;;) {
    try {
      createOwned(lock, token);
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const age = ageMs(lock);
    if (age === null) continue;
    if (isStale(age, staleMs) && clearStaleLock(lock, staleMs)) continue;
    if (Date.now() >= deadline) {
      throw new Error(`could not take the ledger lock ${lock} within ${timeoutMs}ms (held by a live writer)`);
    }
    sleepSync(5 + Math.floor(Math.random() * 15));
  }
}

// body(assertOwned) runs under the lock. If it finds the lock was lost it throws LockLost through
// assertOwned; the whole body is then retried within the original timeout.
function withLock(path, opts, body) {
  const lock = `${path}.lock`;
  const staleMs = opts.staleMs ?? STALE_LOCK_MS;
  const timeoutMs = opts.timeoutMs ?? LOCK_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const token = newToken();
    acquireLock(lock, token, { staleMs, timeoutMs, deadline });
    try {
      return body(() => {
        if (readTextOrNull(lock) !== token) throw new LockLost();
      });
    } catch (e) {
      if (!(e instanceof LockLost)) throw e;
    } finally {
      removeIfOwned(lock, token);
    }
  }
}

// ---------- read and write ----------

function parseLedgerFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(`cannot read ledger ${path}: ${e.code ?? e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`ledger ${path} is not valid JSON`);
  }
}

export function readLedger(path) {
  const ledger = parseLedgerFile(path);
  if (!isObject(ledger) || ledger.v !== LEDGER_VERSION) {
    throw new Error(`ledger ${path} has unsupported version ${JSON.stringify(isObject(ledger) ? ledger.v : undefined)} (expected ${LEDGER_VERSION})`);
  }
  try {
    assertJsonValue(ledger, "ledger");
  } catch (e) {
    throw new Error(`ledger ${path} is invalid: ${e.message}`);
  }
  if (ledger.sha !== computeSha(ledger)) {
    throw new LedgerShaMismatch(`ledger ${path} sha mismatch: the file was edited outside deterministic code`);
  }
  const { valid, errors } = validateLedger(ledger);
  if (!valid) throw new Error(`ledger ${path} is invalid: ${describeErrors(errors)}`);
  return ledger;
}

// Writes `ledger` as the successor of the disk ledger (diskSeq, 0 when there is none).
function writeLocked(path, ledger, diskSeq, assertOwned) {
  try {
    assertJsonValue(ledger, "ledger");
  } catch (e) {
    throw new Error(`refusing to write ledger ${path}: ${e.message}`);
  }
  const checked = validateLedger(ledger);
  if (!checked.valid) throw new Error(`refusing to write invalid ledger ${path}: ${describeErrors(checked.errors)}`);
  if (ledger.seq !== diskSeq) {
    throw new Error(`refusing to write ledger ${path}: stale seq ${ledger.seq}, the file is at seq ${diskSeq}`);
  }
  const next = { ...ledger, seq: diskSeq + 1 };
  next.sha = computeSha(next);
  const temp = `${path}.tmp.${process.pid}.${randomBytes(6).toString("hex")}`;
  try {
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
    assertOwned();
    renameSync(temp, path);
  } catch (e) {
    unlinkQuietly(temp);
    throw e;
  }
  return next;
}

// Writes without reading first: a new file (input seq 0), or the successor of the ledger on disk.
// The disk ledger must pass its sha, and the input seq must equal the disk seq, so a stale copy or a
// hand edit cannot be re-signed. Prefer updateLedger, which reads under the lock.
export function writeLedger(path, ledger, opts = {}) {
  return withLock(path, opts, (assertOwned) => {
    const diskSeq = existsSync(path) ? readLedger(path).seq : 0;
    return writeLocked(path, ledger, diskSeq, assertOwned);
  });
}

export function updateLedger(path, fn, opts = {}) {
  return withLock(path, opts, (assertOwned) => {
    const disk = readLedger(path);
    const diskSeq = disk.seq;
    return writeLocked(path, fn(disk), diskSeq, assertOwned);
  });
}

function readEdited(path) {
  try {
    const ledger = parseLedgerFile(path);
    assertJsonValue(ledger, "ledger");
    const { valid, errors } = validateLedger(ledger);
    if (!valid) throw new Error(`ledger ${path} is invalid: ${describeErrors(errors)}`);
    return ledger;
  } catch (e) {
    throw new LedgerRefused(`${e.message}. Only a well-formed ledger can be accepted: fix the file by hand first`);
  }
}

// Re-signs a hand-edited ledger and records that it did. The ledger's own sha covers the acceptance, so
// newSha cannot be that sha: it is the sha of the content as edited, before the acceptance went in.
export function acceptLedger(path, opts = {}) {
  return withLock(path, opts, (assertOwned) => {
    const edited = readEdited(path);
    const newSha = computeSha(edited);
    if (edited.sha === newSha) throw new NoHandEdit(`ledger ${path} has no sha mismatch, so there is nothing to accept`);
    const acceptance = { oldSha: edited.sha, newSha, seq: edited.seq + 1 };
    const acceptances = [...(edited.acceptances ?? []), acceptance];
    writeLocked(path, { ...edited, acceptances }, edited.seq, assertOwned);
    return acceptance;
  });
}
