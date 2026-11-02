import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { LOCK_TIMEOUT_MS, STALE_LOCK_MS, readLedger, updateLedger, validateLedger, writeLedger } from "../../shared-node/ledger.mjs";

const run = promisify(execFile);
const LEDGER_MODULE = new URL("../../shared-node/ledger.mjs", import.meta.url).href;
const ZERO_SHA = "0".repeat(64);

// API under test:
//   writeLedger(path, ledger, opts): validates, refuses when the disk ledger fails its sha or the input
//     seq differs from the disk seq (0 for a new file), sets seq to the on-disk seq + 1,
//     fills sha, writes through a temp file in the same directory plus rename under <path>.lock,
//     and returns the ledger as written.
//   updateLedger(path, fn, opts): takes the lock, reads the current ledger, applies fn (returns the
//     new ledger) and writes, all under one lock.
//   readLedger(path): parses, checks version, then sha, and returns the ledger.
//   validateLedger(ledger): { valid, errors: [{ path, message }] }.
//   opts: { staleMs, timeoutMs }.

function baseLedger() {
  return {
    v: 1,
    seq: 0,
    sha: ZERO_SHA,
    kind: "code",
    taskType: "config_change",
    owner: { sessionId: null, lastSeen: null },
    task: "Task 20",
    plan: { path: "docs/plans/p.md", title: "Plan" },
    configHash: "a".repeat(64),
    policy: { mode: "default", source: "constant" },
    stage: { name: "intake", status: "active", runId: "r1", attempt: 1 },
    stages: [{ name: "intake", status: "done" }],
    gates: {},
    tests: {},
    commits: [],
    retries: {},
    spend: { agents: 0, tokens: 0 },
    stop: null,
    needsHuman: null,
  };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function expectedSha(ledger) {
  const { sha, ...content } = ledger;
  return createHash("sha256").update(canonical(content)).digest("hex");
}

function inTempDir(body) {
  const dir = mkdtempSync(join(tmpdir(), "pb-ledger-"));
  try {
    return body(dir, join(dir, "ledger.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function inTempDirAsync(body) {
  const dir = mkdtempSync(join(tmpdir(), "pb-ledger-"));
  try {
    return await body(dir, join(dir, "ledger.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ledger-integrity
test("write-then-read-round-trip", () => {
  inTempDir((_dir, path) => {
    const written = writeLedger(path, baseLedger());

    const read = readLedger(path);

    assert.deepEqual(read, written, "readLedger returns what writeLedger wrote");
    assert.equal(read.sha, expectedSha(read), "sha is filled with the canonical content hash");
    assert.notEqual(read.sha, ZERO_SHA, "the placeholder sha is replaced");
    assert.equal(read.task, "Task 20", "content fields are unchanged");
  });
});

test("seq-increments-each-write", () => {
  inTempDir((_dir, path) => {
    const first = writeLedger(path, baseLedger());
    const second = writeLedger(path, readLedger(path));
    const third = writeLedger(path, readLedger(path));

    assert.deepEqual([first.seq, second.seq, third.seq], [1, 2, 3], "seq goes up by one per write");
    assert.equal(readLedger(path).seq, 3, "the file holds the last seq");
  });
});

test("write-refuses-stale-seq", () => {
  inTempDir((_dir, path) => {
    writeLedger(path, baseLedger());
    const stale = readLedger(path);
    writeLedger(path, readLedger(path));
    const before = readFileSync(path, "utf8");

    assert.throws(() => writeLedger(path, { ...stale, task: "from a stale copy" }), /seq/i, "the error names the seq conflict");
    assert.throws(() => writeLedger(path, baseLedger()), /seq/i, "a fresh seq 0 ledger cannot overwrite an existing file");

    assert.equal(readFileSync(path, "utf8"), before, "the file on disk is unchanged");
  });
});

test("write-refuses-to-re-sign-a-hand-edit", () => {
  inTempDir((_dir, path) => {
    const written = writeLedger(path, baseLedger());
    const edited = { ...JSON.parse(readFileSync(path, "utf8")), task: "edited by hand" };
    writeFileSync(path, JSON.stringify(edited, null, 2));
    const before = readFileSync(path, "utf8");

    assert.throws(() => writeLedger(path, written), /sha/i, "the disk ledger fails its sha, so the write is refused");

    assert.equal(readFileSync(path, "utf8"), before, "the hand edit is neither hidden nor re-signed");
  });
});

test("update-passes-on-a-signed-disk-ledger", () => {
  inTempDir((_dir, path) => {
    writeLedger(path, baseLedger());

    const updated = updateLedger(path, (l) => ({ ...l, task: "updated" }));

    assert.equal(updated.seq, 2, "updateLedger reads under the lock, so its seq matches the disk");
    assert.equal(readLedger(path).task, "updated", "the update is on disk");
  });
});

test("hand-edit-sha-mismatch", () => {
  inTempDir((_dir, path) => {
    writeLedger(path, baseLedger());
    const edited = JSON.parse(readFileSync(path, "utf8"));
    edited.task = "edited by hand";
    writeFileSync(path, JSON.stringify(edited, null, 2));

    assert.throws(() => readLedger(path), /sha/i, "readLedger names the SHA mismatch");
  });
});

test("sha-ignores-key-order", () => {
  inTempDir((dir, path) => {
    const a = baseLedger();
    a.stages = [{ name: "intake", status: "done" }];
    const reordered = Object.fromEntries(Object.entries(baseLedger()).reverse());
    reordered.stage = Object.fromEntries(Object.entries(reordered.stage).reverse());
    reordered.stages = reordered.stages.map((s) => Object.fromEntries(Object.entries(s).reverse()));
    const otherPath = join(dir, "other.json");

    const shaA = writeLedger(path, a).sha;
    const shaB = writeLedger(otherPath, reordered).sha;

    assert.equal(shaB, shaA, "reordered keys give the same sha");
    assert.equal(shaA, expectedSha(readLedger(path)), "sha is over canonical JSON with sorted keys, without the sha field");
  });
});

test("corrupted-json-rejected", () => {
  inTempDir((_dir, path) => {
    writeFileSync(path, "{ this is not json");

    assert.throws(() => readLedger(path), (e) => e instanceof Error && e.message.includes("ledger.json") && !/at position|Unexpected token/.test(e.message), "message names the file and is not a raw parser error");
  });
});

test("unsupported-version-rejected", () => {
  inTempDir((_dir, path) => {
    writeFileSync(path, JSON.stringify({ ...baseLedger(), v: 2 }));

    assert.throws(() => readLedger(path), /version.*2|2.*version/is, "message names the unsupported version");
  });
});

test("write-leaves-no-temp-or-lock", () => {
  inTempDir((dir, path) => {
    writeLedger(path, baseLedger());
    writeLedger(path, readLedger(path));

    assert.deepEqual(readdirSync(dir), ["ledger.json"], "only the ledger remains in the run directory");
  });
});

test("write-replaces-the-file-atomically", () => {
  inTempDir((_dir, path) => {
    writeLedger(path, baseLedger());
    const before = readFileSync(path, "utf8");
    const fd = openSync(path, "r");
    try {
      writeLedger(path, { ...readLedger(path), task: "replaced" });
      const buffer = Buffer.alloc(before.length + 100);
      const n = readSync(fd, buffer, 0, buffer.length, 0);

      assert.equal(buffer.subarray(0, n).toString(), before, "a reader holding the old file still sees the old bytes (temp file plus rename)");
    } finally {
      closeSync(fd);
    }
  });
});

test("lock-defaults-are-the-recorded-decisions", () => {
  assert.equal(STALE_LOCK_MS, 30_000, "a lock older than 30 seconds is stale");
  assert.equal(LOCK_TIMEOUT_MS, 5_000, "lock acquisition gives up after 5 seconds");
});

// ledger-concurrent-writes
test("parallel-child-processes-no-lost-update", async () => {
  await inTempDirAsync(async (_dir, path) => {
    const children = 6;
    const incrementsEach = 20;
    writeLedger(path, baseLedger());
    const script = `
      import { updateLedger } from ${JSON.stringify(LEDGER_MODULE)};
      const [path, count] = process.argv.slice(1);
      for (let i = 0; i < Number(count); i++) {
        updateLedger(path, (l) => ({ ...l, spend: { ...l.spend, agents: l.spend.agents + 1 } }), { timeoutMs: 60000 });
      }
    `;

    await Promise.all(
      Array.from({ length: children }, () =>
        run(process.execPath, ["--input-type=module", "-e", script, path, String(incrementsEach)]),
      ),
    );

    const final = readLedger(path);
    const total = children * incrementsEach;
    assert.equal(final.spend.agents, total, "no increment was lost");
    assert.equal(final.seq, 1 + total, "seq advanced once per write");
    assert.equal(final.sha, expectedSha(final), "final sha is valid");
  });
});

function ageLock(file, seconds) {
  const old = new Date(Date.now() - seconds * 1000);
  utimesSync(file, old, old);
}

test("stale-lock-recovered", () => {
  inTempDir((dir, path) => {
    writeLedger(path, baseLedger());
    const lock = `${path}.lock`;
    writeFileSync(lock, "dead writer");
    ageLock(lock, 5);

    const written = writeLedger(path, readLedger(path), { staleMs: 1000, timeoutMs: 2000 });

    assert.equal(written.seq, 2, "a lock 5s old is stale under a 1s staleMs option");
    assert.deepEqual(readdirSync(dir), ["ledger.json"], "the stale lock is gone");
  });
});

test("lock-with-a-future-mtime-counts-as-stale", () => {
  inTempDir((dir, path) => {
    writeLedger(path, baseLedger());
    const lock = `${path}.lock`;
    writeFileSync(lock, "clock skew");
    ageLock(lock, -3600);

    const written = writeLedger(path, readLedger(path), { timeoutMs: 2000 });

    assert.equal(written.seq, 2, "a lock from the future cannot hold the ledger");
    assert.deepEqual(readdirSync(dir), ["ledger.json"], "the lock is gone");
  });
});

test("takeover-guard-with-a-future-mtime-counts-as-stale", () => {
  inTempDir((dir, path) => {
    writeLedger(path, baseLedger());
    const lock = `${path}.lock`;
    writeFileSync(lock, "dead writer");
    ageLock(lock, 3600);
    writeFileSync(`${lock}.takeover`, "clock skew");
    ageLock(`${lock}.takeover`, -3600);

    const written = writeLedger(path, readLedger(path), { timeoutMs: 2000 });

    assert.equal(written.seq, 2);
    assert.deepEqual(readdirSync(dir), ["ledger.json"]);
  });
});

test("lock-a-moment-ahead-of-the-clock-is-still-a-live-writer", () => {
  inTempDir((_dir, path) => {
    writeLedger(path, baseLedger());
    writeFileSync(`${path}.lock`, "live writer");
    ageLock(`${path}.lock`, -0.2);

    assert.throws(() => writeLedger(path, readLedger(path), { timeoutMs: 100 }), /within 100ms/, "file timestamps can run a tick ahead of Date.now()");
  });
});

test("fresh-lock-is-not-stale-under-the-option", () => {
  inTempDir((_dir, path) => {
    writeLedger(path, baseLedger());
    writeFileSync(`${path}.lock`, "live writer");
    ageLock(`${path}.lock`, 5);

    assert.throws(() => writeLedger(path, readLedger(path), { staleMs: 60_000, timeoutMs: 200 }), /within 200ms/, "a lock younger than staleMs is respected");
  });
});

test("live-lock-times-out", () => {
  inTempDir((_dir, path) => {
    writeLedger(path, baseLedger());
    const before = readFileSync(path, "utf8");
    writeFileSync(`${path}.lock`, "live writer");
    const started = Date.now();

    assert.throws(
      () => writeLedger(path, readLedger(path), { staleMs: 60_000, timeoutMs: 300 }),
      (e) => /within 300ms/.test(e.message) && !/EEXIST/.test(e.message),
      "a clean error that states the timeout and is not a raw EEXIST",
    );

    assert.ok(Date.now() - started < 2000, "the timeoutMs option is honoured, not the 5s default");
    assert.equal(readFileSync(path, "utf8"), before, "the ledger is unchanged");
  });
});

test("lock-is-released-when-the-update-callback-throws", () => {
  inTempDir((dir, path) => {
    writeLedger(path, baseLedger());

    assert.throws(() => updateLedger(path, () => { throw new Error("boom"); }), /boom/, "the callback error propagates");

    assert.deepEqual(readdirSync(dir), ["ledger.json"], "no lock is left behind");
  });
});

test("takeover-guard-older-than-the-stale-limit-is-removed", () => {
  inTempDir((dir, path) => {
    writeLedger(path, baseLedger());
    for (const file of [`${path}.lock`, `${path}.lock.takeover`]) {
      writeFileSync(file, "dead writer");
      ageLock(file, 120);
    }

    const written = writeLedger(path, readLedger(path), { staleMs: 30_000, timeoutMs: 2000 });

    assert.equal(written.seq, 2, "the write succeeded");
    assert.deepEqual(readdirSync(dir), ["ledger.json"], "the dead takeover guard and the stale lock are both gone");
  });
});

test("fresh-takeover-guard-blocks-removing-a-stale-lock", () => {
  inTempDir((_dir, path) => {
    writeLedger(path, baseLedger());
    writeFileSync(`${path}.lock`, "dead writer");
    ageLock(`${path}.lock`, 120);
    writeFileSync(`${path}.lock.takeover`, "another waiter mid-takeover");

    assert.throws(() => writeLedger(path, readLedger(path), { staleMs: 30_000, timeoutMs: 300 }), /within 300ms/, "a waiter does not bypass a live takeover guard");

    assert.ok(existsSync(`${path}.lock`), "the lock was left for the guard holder to decide");
  });
});

test("holder-that-lost-its-lock-writes-nothing-and-leaves-the-new-lock", () => {
  inTempDir((_dir, path) => {
    writeLedger(path, baseLedger());
    const before = readFileSync(path, "utf8");
    const lock = `${path}.lock`;
    const lostLock = (l) => {
      writeFileSync(lock, "another writer's token");
      return { ...l, spend: { ...l.spend, agents: l.spend.agents + 1 } };
    };

    assert.throws(() => updateLedger(path, lostLock, { staleMs: 60_000, timeoutMs: 300 }), /within 300ms/, "the holder aborts and its retry times out cleanly");

    assert.equal(readFileSync(path, "utf8"), before, "nothing was written without the lock");
    assert.equal(readFileSync(lock, "utf8"), "another writer's token", "release removed only a lock it owned");
  });
});

// Child processes run these scripts against the real module.
const INCREMENT_SCRIPT = `
  import { updateLedger } from ${JSON.stringify(LEDGER_MODULE)};
  const [path, startAt, count, staleMs] = process.argv.slice(1);
  while (Date.now() < Number(startAt));
  for (let i = 0; i < Number(count); i++) {
    updateLedger(path, (l) => ({ ...l, spend: { ...l.spend, agents: l.spend.agents + 1 } }), { timeoutMs: 30000, staleMs: Number(staleMs) });
  }
`;

const SLOW_HOLDER_SCRIPT = `
  import { writeFileSync } from "node:fs";
  import { updateLedger } from ${JSON.stringify(LEDGER_MODULE)};
  const [path, heldMarker, holdMs] = process.argv.slice(1);
  let first = true;
  updateLedger(path, (l) => {
    if (first) {
      first = false;
      writeFileSync(heldMarker, "held");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(holdMs));
    }
    return { ...l, spend: { ...l.spend, agents: l.spend.agents + 1 } };
  }, { timeoutMs: 30000, staleMs: 200 });
`;

const spawnNode = (script, ...args) => run(process.execPath, ["--input-type=module", "-e", script, ...args]);

test("eight-children-racing-over-a-stale-lock-lose-no-update", async () => {
  const rounds = 8;
  const children = 8;
  const incrementsEach = 3;
  for (let round = 0; round < rounds; round++) {
    await inTempDirAsync(async (_dir, path) => {
      writeLedger(path, baseLedger());
      writeFileSync(`${path}.lock`, "dead writer");
      ageLock(`${path}.lock`, 120);
      const startAt = Date.now() + 300;

      await Promise.all(Array.from({ length: children }, () => spawnNode(INCREMENT_SCRIPT, path, String(startAt), String(incrementsEach), "30000")));

      const final = readLedger(path);
      const total = children * incrementsEach;
      assert.equal(final.spend.agents, total, `round ${round}: no increment was lost`);
      assert.equal(final.seq, 1 + total, `round ${round}: seq advanced once per write`);
    });
  }
});

test("holder-overrunning-staleMs-does-not-overwrite-the-new-owner", async () => {
  for (let round = 0; round < 5; round++) {
    await inTempDirAsync(async (dir, path) => {
      writeLedger(path, baseLedger());
      const marker = join(dir, "held.marker");
      const slow = spawnNode(SLOW_HOLDER_SCRIPT, path, marker, "700");
      while (!existsSync(marker)) await new Promise((resolve) => setTimeout(resolve, 5));

      const fast = spawnNode(INCREMENT_SCRIPT, path, "0", "1", "200");
      await Promise.all([slow, fast]);

      const final = readLedger(path);
      assert.equal(final.spend.agents, 2, `round ${round}: the takeover writer's commit survives and the overrunning holder retried on top of it`);
      assert.deepEqual(readdirSync(dir).filter((f) => f !== "held.marker"), ["ledger.json"], `round ${round}: no lock or guard is left behind`);
    });
  }
});

// ledger-validation
test("write-refuses-invalid-ledger", () => {
  inTempDir((_dir, path) => {
    writeLedger(path, baseLedger());
    const before = readFileSync(path, "utf8");
    const invalid = { ...readLedger(path), needsHuman: { gate: "", reason: "x", seq: 1 } };

    assert.throws(() => writeLedger(path, invalid), /needsHuman\.gate/, "the error names the failing field path");

    assert.equal(readFileSync(path, "utf8"), before, "the file on disk is unchanged");
    assert.equal(validateLedger(invalid).valid, false, "validateLedger agrees the ledger is invalid");
  });
});

test("update-refuses-an-invalid-ledger-from-the-callback", () => {
  inTempDir((dir, path) => {
    writeLedger(path, baseLedger());
    const before = readFileSync(path, "utf8");

    assert.throws(() => updateLedger(path, (l) => ({ ...l, kind: "bogus" })), /kind/, "the error names the failing field");

    assert.equal(readFileSync(path, "utf8"), before, "the file on disk is unchanged");
    assert.deepEqual(readdirSync(dir), ["ledger.json"], "no lock is left behind");
  });
});

test("read-rejects-a-correctly-signed-invalid-ledger", () => {
  inTempDir((_dir, path) => {
    const invalid = { ...baseLedger(), kind: "bogus" };
    invalid.sha = expectedSha(invalid);
    writeFileSync(path, JSON.stringify(invalid, null, 2));

    assert.throws(() => readLedger(path), /kind/, "readLedger validates after the sha check");
  });
});

// ledger-canonical-json
const NON_JSON_VALUES = {
  "undefined-in-object": { x: undefined },
  "undefined-in-array": [undefined],
  "date": new Date(0),
  "map": new Map(),
  "nan": { x: NaN },
  "infinity": { x: Infinity },
  "negative-infinity": { x: -Infinity },
};

for (const [name, value] of Object.entries(NON_JSON_VALUES)) {
  test(`write-rejects-non-json-value-${name}`, () => {
    inTempDir((_dir, path) => {
      writeLedger(path, baseLedger());
      const before = readFileSync(path, "utf8");

      assert.throws(() => writeLedger(path, { ...readLedger(path), gates: { g: value } }), Error, "rejected before hashing");

      assert.equal(readFileSync(path, "utf8"), before, "the file is unchanged");
      assert.equal(readLedger(path).seq, 1, "the run is not bricked: the ledger still reads");
    });
  });
}

test("read-rejects-a-non-finite-number-parsed-from-disk", () => {
  inTempDir((_dir, path) => {
    const ledger = { ...baseLedger(), gates: { x: null } };
    ledger.sha = expectedSha(ledger);
    const text = JSON.stringify(ledger, null, 2).replace('"x": null', '"x": 1e999');
    writeFileSync(path, text);

    assert.throws(() => readLedger(path), /finite|non-finite|infinity/i, "1e999 is Infinity, which canonicalizes like null and must not pass the sha");
  });
});

function pauseSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

test("lock-acquisition-does-not-leak-file-descriptors", () => {
  inTempDir((_dir, path) => {
    writeLedger(path, baseLedger());
    const openBefore = readdirSync("/dev/fd").length;

    for (let i = 0; i < 20; i++) writeLedger(path, readLedger(path));

    assert.ok(readdirSync("/dev/fd").length - openBefore <= 1, "twenty locked writes leave no descriptor open");
  });
});

test("takeover-guard-staleness-follows-the-staleMs-option", () => {
  inTempDir((dir, path) => {
    writeLedger(path, baseLedger());
    for (const file of [`${path}.lock`, `${path}.lock.takeover`]) {
      writeFileSync(file, "dead writer");
      ageLock(file, 5);
    }

    const written = writeLedger(path, readLedger(path), { staleMs: 1000, timeoutMs: 2000 });

    assert.equal(written.seq, 2, "a guard 5s old is dead under a 1s staleMs option, not only under the 30s default");
    assert.deepEqual(readdirSync(dir), ["ledger.json"], "the dead guard and the stale lock are both gone");
  });
});

test("waiter-takes-the-lock-soon-after-it-is-released", async () => {
  await inTempDirAsync(async (_dir, path) => {
    writeLedger(path, baseLedger());
    const lock = `${path}.lock`;
    writeFileSync(lock, "live writer");
    const releaser = spawn(process.execPath, ["-e", `setTimeout(() => require("node:fs").unlinkSync(process.argv[1]), 150)`, lock]);
    const exited = new Promise((resolve) => releaser.on("exit", resolve));
    const started = Date.now();

    const written = writeLedger(path, readLedger(path), { staleMs: 60_000, timeoutMs: 5000 });
    const waited = Date.now() - started;
    await exited;

    assert.equal(written.seq, 2, "the waiter wrote once the lock was released");
    assert.ok(waited < 450, `the waiter polls every few milliseconds, not every half second (waited ${waited}ms)`);
  });
});

test("one-timeout-covers-the-retry-after-a-lost-lock", () => {
  inTempDir((_dir, path) => {
    writeLedger(path, baseLedger());
    const lock = `${path}.lock`;
    const slowThenLose = (l) => {
      pauseSync(300);
      writeFileSync(lock, "another writer's token");
      return l;
    };
    const started = Date.now();

    assert.throws(() => updateLedger(path, slowThenLose, { staleMs: 60_000, timeoutMs: 500 }), /within 500ms/, "the retry gives up");

    assert.ok(Date.now() - started < 700, "the 500ms budget counts from the first attempt, it is not restarted for the retry");
  });
});

test("a-lock-that-cannot-be-read-is-an-error-not-a-lost-lock", () => {
  inTempDir((_dir, path) => {
    writeLedger(path, baseLedger());
    const lock = `${path}.lock`;
    const swapLockForDirectory = (l) => {
      rmSync(lock);
      mkdirSync(lock);
      return l;
    };

    assert.throws(() => updateLedger(path, swapLockForDirectory, { staleMs: 60_000, timeoutMs: 300 }), /EISDIR/, "reading the lock failed for a reason other than it being gone");
  });
});

test("a-stale-lock-that-cannot-be-removed-fails-instead-of-spinning", async () => {
  await inTempDirAsync(async (_dir, path) => {
    writeLedger(path, baseLedger());
    mkdirSync(`${path}.lock`);
    ageLock(`${path}.lock`, 120);
    const script = `
      import { writeLedger } from ${JSON.stringify(LEDGER_MODULE)};
      writeLedger(process.argv[1], {}, { staleMs: 30000, timeoutMs: 1000 });
    `;

    await assert.rejects(
      run(process.execPath, ["--input-type=module", "-e", script, path], { timeout: 8000 }),
      (e) => !e.killed && /EPERM|EISDIR/.test(e.stderr),
      "the unlink error surfaces and the waiter does not loop forever",
    );
  });
});
