import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
  copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { buildKey } from "../../shared-node/keys.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const TAP = join(ROOT, "hooks", "tap.mjs");
const PAYLOADS = join(ROOT, "tests", "probes", "fixtures", "payloads");
const fixture = (name) => JSON.parse(readFileSync(join(PAYLOADS, name), "utf8"));

// Reason words asserted in tap-errors.log (lowercase match):
//   "bad key"           - pb_key that keys.mjs cannot parse (includes traversal)
//   "stage mismatch"    - key stage differs from ledger.stage.name
//   "attempt mismatch"  - key attempt differs from ledger.stage.attempt
//   "workflow mismatch" - Workflow name or args.attempt does not belong to the current stage
//   "agent mismatch"    - the payload's agent_type is not pairingbuddy:<the key's role>
const STAGE = "build";
const ATTEMPT = 2;

function makeLedger(stage = { name: STAGE, status: "active", runId: null, attempt: ATTEMPT }) {
  return {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "config_change",
    owner: { sessionId: null, lastSeen: null }, task: "Task 21",
    plan: { path: "docs/plans/p.md", title: "Plan" }, configHash: "a".repeat(64),
    policy: { mode: "default", source: "constant" }, stage, stages: [{ name: STAGE, status: "active" }],
    gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 },
    stop: null, needsHuman: null,
  };
}

function makeRepo({ ledger = makeLedger(), git = true } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tap-")));
  if (git) execFileSync("git", ["init", "-q"], { cwd: dir });
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  if (ledger) {
    mkdirSync(taskDir, { recursive: true });
    writeLedger(join(taskDir, "ledger.json"), ledger);
  }
  return {
    dir,
    taskDir,
    ledgerPath: join(taskDir, "ledger.json"),
    artifact: (key) => join(taskDir, "artifacts", `${key}.json`),
    errorLog: () => {
      const p = join(taskDir, "tap-errors.log");
      return existsSync(p) ? readFileSync(p, "utf8").toLowerCase() : null;
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function listAll(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) out.push(join(e.parentPath ?? e.path, e.name));
  }
  return out.sort();
}

// Every run must keep stderr empty: the tap never prints.
function runTap(stdin, script = TAP) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (stderr !== "") reject(new Error(`tap wrote to stderr: ${stderr}`));
      else resolve({ code, stdout, stderr });
    });
    child.stdin.end(typeof stdin === "string" ? stdin : JSON.stringify(stdin));
  });
}

// The agent is the one the key names unless a test says otherwise: only that agent's return counts.
function structured(cwd, pbKey, extra = {}, agentType = `pairingbuddy:${String(pbKey).split(".")[1]}`) {
  const payload = fixture("posttooluse-structuredoutput.json");
  payload.cwd = cwd;
  payload.agent_type = agentType;
  payload.tool_input = pbKey === undefined ? { ...extra } : { pb_key: pbKey, ...extra };
  return payload;
}

function workflow(cwd, { name = `pairingbuddy:${STAGE}`, attempt = ATTEMPT, runId } = {}) {
  const payload = fixture("posttooluse-workflow.json");
  payload.cwd = cwd;
  payload.tool_input = { ...payload.tool_input, name, args: { attempt } };
  if (runId === null) delete payload.tool_response.runId;
  else if (runId !== undefined) payload.tool_response.runId = runId;
  return payload;
}

function makeCommittedRepo() {
  const repo = makeRepo();
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: repo.dir, stdio: "ignore" });
  writeFileSync(join(repo.dir, "f.txt"), "x");
  git("add", "f.txt");
  git("commit", "-q", "-m", "init");
  return { repo, git };
}

const key = (over = {}) => buildKey({ stage: STAGE, role: "worker", item: "t1", round: 1, attempt: ATTEMPT, ...over });

async function withRepo(opts, fn) {
  const repo = makeRepo(opts);
  try {
    await fn(repo);
  } finally {
    repo.cleanup();
  }
}

test("valid key writes artifact containing the agent's return", () =>
  withRepo({}, async (repo) => {
    const k = key();
    const res = await runTap(structured(repo.dir, k, { answer: 42 }));

    assert.equal(res.code, 0);
    assert.equal(res.stdout, "", "stdout must be empty");
    assert.equal(JSON.parse(readFileSync(repo.artifact(k), "utf8")).answer, 42);
  }));

for (const [name, agentType] of [
  ["a plain agent", "general-purpose"],
  ["a plain workflow agent", "workflow-subagent"],
  ["another pipeline agent", "pairingbuddy:other"],
  ["the bare role", "worker"],
  ["another plugin's agent of that name", "pbprobe:worker"],
]) {
  test(`${name} cannot file a return under the role's key`, () =>
    withRepo({}, async (repo) => {
      const k = key();

      const res = await runTap(structured(repo.dir, k, { answer: 42 }, agentType));

      assert.equal(res.code, 0);
      assert.equal(existsSync(repo.artifact(k)), false);
      assert.match(repo.errorLog(), /agent mismatch/);
      assert.ok(repo.errorLog().includes(agentType), "the log names who sent it");
    }));
}

test("a return with no agent fields is not filed", () =>
  withRepo({}, async (repo) => {
    const k = key();
    const payload = structured(repo.dir, k, { answer: 42 });
    delete payload.agent_id;
    delete payload.agent_type;

    const res = await runTap(payload);

    assert.equal(res.code, 0);
    assert.equal(existsSync(repo.artifact(k)), false);
    assert.match(repo.errorLog(), /agent mismatch/);
  }));

test("parallel same-type fan-out leaves every artifact intact", () =>
  withRepo({}, async (repo) => {
    const keys = Array.from({ length: 10 }, (_, i) => key({ item: `t${i}` }));

    const results = await Promise.all(
      keys.map((k, i) => runTap(structured(repo.dir, k, { answer: i, filler: "x".repeat(50_000) }))),
    );

    results.forEach((r) => {
      assert.equal(r.code, 0);
      assert.equal(r.stdout, "", "stdout must be empty");
    });
    keys.forEach((k, i) => {
      const art = JSON.parse(readFileSync(repo.artifact(k), "utf8"));
      assert.equal(art.pb_key, k);
      assert.equal(art.answer, i);
      assert.equal(art.filler.length, 50_000);
    });
    const names = readdirSync(join(repo.taskDir, "artifacts")).sort();
    assert.deepEqual(names, keys.map((k) => `${k}.json`).sort(), "no stray temp files");
  }));

test("subdirectory cwd resolves to the repo toplevel", () =>
  withRepo({}, async (repo) => {
    const sub = join(repo.dir, "deep", "er");
    mkdirSync(sub, { recursive: true });
    const k = key();

    const res = await runTap(structured(sub, k, { answer: 1 }));

    assert.equal(res.code, 0);
    assert.equal(JSON.parse(readFileSync(repo.artifact(k), "utf8")).answer, 1);
    assert.equal(existsSync(join(sub, ".pairingbuddy")), false);
  }));

test("a git repo nested inside a run writes to the run above it", () =>
  withRepo({}, async (repo) => {
    const nested = join(repo.dir, "vendor", "lib");
    mkdirSync(nested, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: nested });
    const k = key();

    const res = await runTap(structured(nested, k, { answer: 3 }));

    assert.equal(res.code, 0);
    assert.equal(JSON.parse(readFileSync(repo.artifact(k), "utf8")).answer, 3);
    assert.equal(existsSync(join(nested, ".pairingbuddy")), false);
  }));

test("a run outside any git repo is still found", () =>
  withRepo({ git: false }, async (repo) => {
    const k = key();

    const res = await runTap(structured(repo.dir, k, { answer: 4 }));

    assert.equal(res.code, 0);
    assert.equal(JSON.parse(readFileSync(repo.artifact(k), "utf8")).answer, 4);
  }));

test("linked worktree writes to its own run state only", async () => {
  const { repo, git } = makeCommittedRepo();
  const wt = join(repo.dir, "..", `${repo.dir.split("/").pop()}-wt`);
  try {
    git("worktree", "add", "-q", wt);
    const wtTask = join(wt, ".pairingbuddy", "run", "task");
    mkdirSync(wtTask, { recursive: true });
    writeLedger(join(wtTask, "ledger.json"), makeLedger());
    const k = key();

    const res = await runTap(structured(wt, k, { answer: 7 }));

    assert.equal(res.code, 0);
    assert.equal(JSON.parse(readFileSync(join(wtTask, "artifacts", `${k}.json`), "utf8")).answer, 7);
    assert.equal(existsSync(repo.artifact(k)), false, "main checkout must not receive the worktree's return");
  } finally {
    repo.cleanup();
    rmSync(wt, { recursive: true, force: true });
  }
});

test("corrupt ledger is logged, exits 0 and prints nothing", () =>
  withRepo({}, async (repo) => {
    writeFileSync(repo.ledgerPath, "{ not json");

    for (const payload of [structured(repo.dir, key()), workflow(repo.dir)]) {
      const res = await runTap(payload);
      assert.equal(res.code, 0);
      assert.equal(res.stdout, "");
    }

    assert.match(repo.errorLog(), /error:/);
  }));

test("missing shared-node modules still exit 0 silently", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tap-pkg-")));
  try {
    mkdirSync(join(dir, "hooks"));
    copyFileSync(TAP, join(dir, "hooks", "tap.mjs"));

    const res = await runTap(structured(dir, key()), join(dir, "hooks", "tap.mjs"));

    assert.equal(res.code, 0);
    assert.equal(res.stdout, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("return larger than a pipe buffer is stored byte for byte", () =>
  withRepo({}, async (repo) => {
    const k = key();
    const big = "ab".repeat(512 * 1024);

    const res = await runTap(structured(repo.dir, k, { blob: big }));

    assert.equal(res.code, 0);
    assert.equal(JSON.parse(readFileSync(repo.artifact(k), "utf8")).blob, big);
  }));

test("an existing artifact is replaced by rename, not rewritten in place", () =>
  withRepo({}, async (repo) => {
    const k = key();
    mkdirSync(join(repo.taskDir, "artifacts"), { recursive: true });
    writeFileSync(repo.artifact(k), '{"old":true}');
    const alias = join(repo.dir, "alias.json");
    linkSync(repo.artifact(k), alias);

    const res = await runTap(structured(repo.dir, k, { answer: 1 }));

    assert.equal(res.code, 0);
    assert.equal(readFileSync(alias, "utf8"), '{"old":true}', "the old inode keeps its bytes");
    assert.equal(JSON.parse(readFileSync(repo.artifact(k), "utf8")).answer, 1);
  }));

test("parallel returns on one key leave one valid artifact and no temp files", () =>
  withRepo({}, async (repo) => {
    const k = key();

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => runTap(structured(repo.dir, k, { answer: i, filler: "x".repeat(200_000) }))),
    );

    results.forEach((r) => assert.equal(r.code, 0));
    const art = JSON.parse(readFileSync(repo.artifact(k), "utf8"));
    assert.equal(art.filler.length, 200_000);
    assert.deepEqual(readdirSync(join(repo.taskDir, "artifacts")), [`${k}.json`]);
  }));

test("bad key is ignored and logged", () =>
  withRepo({}, async (repo) => {
    const before = listAll(repo.dir).filter((f) => !f.endsWith("tap-errors.log"));

    const res = await runTap(structured(repo.dir, "not-a-key"));

    assert.equal(res.code, 0);
    assert.equal(res.stdout, "");
    assert.deepEqual(listAll(repo.dir).filter((f) => !f.endsWith("tap-errors.log")), before);
    assert.match(repo.errorLog(), /bad key/);
  }));

test("traversal key writes nothing inside or outside artifacts", () =>
  withRepo({}, async (repo) => {
    const parent = join(repo.dir, "..");
    const beforeRepo = listAll(repo.dir).filter((f) => !f.endsWith("tap-errors.log"));

    for (const bad of ["../../escape", `../../../escape.${key()}`, `${STAGE}.worker../../x.r1.a${ATTEMPT}`]) {
      const res = await runTap(structured(repo.dir, bad));
      assert.equal(res.code, 0);
      assert.equal(res.stdout, "");
    }

    assert.deepEqual(listAll(repo.dir).filter((f) => !f.endsWith("tap-errors.log")), beforeRepo);
    assert.equal(existsSync(join(parent, "escape.json")), false);
    assert.equal(existsSync(join(repo.taskDir, "escape.json")), false);
    assert.match(repo.errorLog(), /bad key/);
  }));

test("wrong stage is ignored and logged", () =>
  withRepo({}, async (repo) => {
    const k = key({ stage: "other" });

    const res = await runTap(structured(repo.dir, k));

    assert.equal(res.code, 0);
    assert.equal(res.stdout, "");
    assert.equal(existsSync(repo.artifact(k)), false);
    assert.match(repo.errorLog(), /stage mismatch/);
  }));

test("stale attempt is ignored and logged", () =>
  withRepo({}, async (repo) => {
    const k = key({ attempt: ATTEMPT - 1 });

    const res = await runTap(structured(repo.dir, k));

    assert.equal(res.code, 0);
    assert.equal(res.stdout, "");
    assert.equal(existsSync(repo.artifact(k)), false);
    assert.match(repo.errorLog(), /attempt mismatch/);
  }));

test("future attempt is ignored and logged", () =>
  withRepo({}, async (repo) => {
    const k = key({ attempt: ATTEMPT + 1 });

    const res = await runTap(structured(repo.dir, k));

    assert.equal(res.code, 0);
    assert.equal(res.stdout, "");
    assert.equal(existsSync(repo.artifact(k)), false);
    assert.match(repo.errorLog(), /attempt mismatch/);
  }));

test("missing pb_key is ignored", () =>
  withRepo({}, async (repo) => {
    const res = await runTap(structured(repo.dir, undefined, { answer: 1 }));

    assert.equal(res.code, 0);
    assert.equal(res.stdout, "");
    assert.equal(existsSync(join(repo.taskDir, "artifacts")) ? readdirSync(join(repo.taskDir, "artifacts")).length : 0, 0);
  }));

test("empty and non-JSON stdin exit clean", () =>
  withRepo({}, async (repo) => {
    const before = listAll(repo.dir).filter((f) => !f.endsWith("tap-errors.log"));

    for (const input of ["", "not json {"]) {
      const res = await runTap(input);
      assert.equal(res.code, 0);
      assert.equal(res.stdout, "");
    }

    assert.deepEqual(listAll(repo.dir).filter((f) => !f.endsWith("tap-errors.log")), before);
  }));

test("workflow payload stores runId and leaves other fields intact", () =>
  withRepo({}, async (repo) => {
    const before = readLedger(repo.ledgerPath);

    const res = await runTap(workflow(repo.dir));

    assert.equal(res.code, 0);
    assert.equal(res.stdout, "");
    const after = readLedger(repo.ledgerPath);
    assert.equal(after.stage.runId, "wf_e86eab30-6a7");
    assert.deepEqual({ ...after.stage, runId: null }, { ...before.stage, runId: null });
    const { seq: _s, sha: _h, stage: _st, ...restAfter } = after;
    const { seq: _s2, sha: _h2, stage: _st2, ...restBefore } = before;
    assert.deepEqual(restAfter, restBefore);
  }));

test("workflow for another name or attempt leaves runId alone and is logged", () =>
  withRepo({ ledger: makeLedger({ name: STAGE, status: "active", runId: "wf_real", attempt: ATTEMPT }) }, async (repo) => {
    for (const payload of [
      workflow(repo.dir, { name: "someone-else:thing" }),
      workflow(repo.dir, { name: `pairingbuddy:other` }),
      workflow(repo.dir, { attempt: ATTEMPT - 1 }),
      workflow(repo.dir, { attempt: ATTEMPT + 1 }),
    ]) {
      const res = await runTap(payload);
      assert.equal(res.code, 0);
      assert.equal(res.stdout, "");
    }

    assert.equal(readLedger(repo.ledgerPath).stage.runId, "wf_real");
    assert.match(repo.errorLog(), /workflow mismatch/);
  }));

test("workflow response without a runId leaves the ledger byte-for-byte unchanged", () =>
  withRepo({}, async (repo) => {
    const before = readFileSync(repo.ledgerPath);

    const res = await runTap(workflow(repo.dir, { runId: null }));

    assert.equal(res.code, 0);
    assert.equal(res.stdout, "");
    assert.deepEqual(readFileSync(repo.ledgerPath), before);
  }));

test("workflow tap and other ledger writers in parallel all land", () =>
  withRepo({}, async (repo) => {
    const ledgerUrl = new URL("../../shared-node/ledger.mjs", import.meta.url).href;
    const writerScript = `import { updateLedger } from ${JSON.stringify(ledgerUrl)};
      updateLedger(${JSON.stringify(repo.ledgerPath)}, (l) => ({ ...l, spend: { ...l.spend, agents: l.spend.agents + 1 } }));`;
    const writer = () => new Promise((resolve, reject) => {
      const c = spawn("node", ["--input-type=module", "-e", writerScript], { stdio: "ignore" });
      c.on("error", reject);
      c.on("close", resolve);
    });
    const N = 8;

    const runs = await Promise.all([
      ...Array.from({ length: N }, writer),
      ...Array.from({ length: N }, (_, i) => runTap(workflow(repo.dir, { runId: `wf_${i}` }))),
    ]);

    runs.slice(0, N).forEach((code) => assert.equal(code, 0));
    runs.slice(N).forEach((r) => assert.equal(r.code, 0));
    const after = readLedger(repo.ledgerPath);
    assert.equal(after.spend.agents, N, "no writer update was lost");
    assert.match(after.stage.runId, /^wf_\d$/);
  }));

test("workflow without a stage leaves the ledger byte-for-byte unchanged", () =>
  withRepo({ ledger: makeLedger({ name: "", status: "", runId: null, attempt: 0 }) }, async (repo) => {
    const before = readFileSync(repo.ledgerPath);

    const res = await runTap(workflow(repo.dir));

    assert.equal(res.code, 0);
    assert.equal(res.stdout, "");
    assert.deepEqual(readFileSync(repo.ledgerPath), before);
  }));

test("no ledger in a git repo is inert", () =>
  withRepo({ ledger: null }, async (repo) => {
    const before = listAll(repo.dir);

    for (const payload of [structured(repo.dir, key()), workflow(repo.dir)]) {
      const res = await runTap(payload);
      assert.equal(res.code, 0);
      assert.equal(res.stdout, "");
    }

    assert.deepEqual(listAll(repo.dir), before);
    assert.equal(existsSync(join(repo.dir, ".pairingbuddy")), false);
  }));

test("outside any git repo is inert", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tap-nogit-")));
  try {
    for (const payload of [structured(dir, key()), workflow(dir)]) {
      const res = await runTap(payload);
      assert.equal(res.code, 0);
      assert.equal(res.stdout, "");
    }

    assert.deepEqual(listAll(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no error log is created without run state", () =>
  withRepo({ ledger: null }, async (repo) => {
    const res = await runTap(structured(repo.dir, "not-a-key"));

    assert.equal(res.code, 0);
    assert.equal(res.stdout, "");
    assert.equal(repo.errorLog(), null);
    assert.equal(existsSync(join(repo.dir, ".pairingbuddy")), false);
  }));

test("tap is registered on PostToolUse alongside the existing hooks", () => {
  const hooks = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8")).hooks.PostToolUse;

  const entry = hooks.find((e) => e.matcher === "StructuredOutput|Workflow");
  const commands = hooks.flatMap((e) => e.hooks.map((h) => h.command));

  assert.ok(entry, "PostToolUse entry with matcher StructuredOutput|Workflow");
  assert.deepEqual(entry.hooks, [{ type: "command", command: "node ${CLAUDE_PLUGIN_ROOT}/hooks/tap.mjs" }], "synchronous: no async flag");
  assert.ok(commands.some((c) => c.includes("guardian.mjs")));
  assert.ok(commands.some((c) => c.includes("solo-progress.mjs")));
});

test("tap is listed in the hook registry test", () => {
  const registry = readFileSync(join(ROOT, "tests", "test_hook_registration.py"), "utf8");

  assert.match(registry, /tap\.mjs/);
});
