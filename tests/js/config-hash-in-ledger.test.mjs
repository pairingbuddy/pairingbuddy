import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { updateLedger, validateLedger } from "../../shared-node/ledger.mjs";
import { makeRepo, pb } from "./cli-repo-fixture.mjs";

// Scenario: config-hash-in-ledger (CLI level).

test("run-open-records-git-config-hash", () => {
  const repo = makeRepo({ openTask: false });
  const gitConfigPath = join(repo.dir, ".pairingbuddy", "git-config.json");
  assert.equal(existsSync(gitConfigPath), false, "the repo starts with no git-config.json");

  const opened = pb(repo, "run", "open", "--kind", "code");

  assert.equal(opened.code, 0, `open succeeds: ${opened.stderr}`);
  assert.equal(existsSync(gitConfigPath), true, "open bootstrapped git-config.json");
  const expectedHash = createHash("sha256").update(readFileSync(gitConfigPath)).digest("hex");
  const ledger = repo.ledger();
  assert.match(ledger.gitConfigHash, /^[0-9a-f]{64}$/, "gitConfigHash is 64 lowercase hex characters");
  assert.equal(ledger.gitConfigHash, expectedHash, "gitConfigHash is the sha256 of the bootstrapped file bytes");
  assert.deepEqual(validateLedger(ledger).errors, [], "the ledger with the new field validates");
});

// A run opened through the CLI whose last stage is done, so G:task-end is due and `pb gate eval` checks the run.
function openRunAtTaskEnd() {
  const repo = makeRepo({ openTask: false });
  assert.equal(pb(repo, "run", "open", "--kind", "code").code, 0, "open succeeds");
  const done = (name) => ({ name, status: "done" });
  updateLedger(join(repo.dir, ".pairingbuddy", "run", "task", "ledger.json"), (ledger) => ({
    ...ledger,
    taskType: "config_change",
    policy: { mode: "auto", source: "hook" },
    stage: { name: "code-safety-net", status: "done", runId: "wf_1", attempt: 1, startedAt: null },
    stages: [done("code-config"), done("code-safety-net")],
  }));
  return repo;
}

test("git-config-edit-detected-at-next-check", () => {
  const edited = openRunAtTaskEnd();
  writeFileSync(join(edited.dir, ".pairingbuddy", "git-config.json"), '{"remote":"upstream"}\n');
  const unchanged = openRunAtTaskEnd();

  const stopped = pb(edited, "gate", "eval");
  const passed = pb(unchanged, "gate", "eval");

  assert.equal(stopped.code, 0, `gate eval exits 0: ${stopped.stderr}`);
  const stop = JSON.parse(stopped.stdout);
  assert.equal(stop.result, "needs-human", "the edited git-config.json makes the gate ask");
  assert.equal(stop.gate, "G:task-end", "the stop is on the due gate");
  assert.match(stop.reason, /git-config hash changed/, "the reason names the git-config hash change");
  assert.equal(passed.code, 0, `gate eval exits 0: ${passed.stderr}`);
  assert.equal(JSON.parse(passed.stdout).result, "auto-pass", "an unchanged git-config.json does not stop the gate");
});
