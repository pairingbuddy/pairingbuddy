// Safeguards for cli/pb.mjs paths that had no test: how pb gate eval reports a gate a human answered, the argument and
// refusal paths of the pb human verbs, config acceptance in pb human accept, a set of refusal messages, and how pb
// reads gh output it cannot use. Every test drives the real CLI against a temp git repo and pins today's behaviour.
import "./isolated-tmpdir.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { VERBS } from "../../cli/pb.mjs";
import { HUMAN_STOPPED, VERB_CLASSES, humanCommand } from "../../shared-node/verbs.mjs";
import { makeRepo, pb, pbWithEnv } from "./cli-repo-fixture.mjs";
import { publishUnit, unitWithRecordedPr } from "./publishable-unit-fixture.mjs";

const TASK_END = "G:task-end";
const SCENARIOS = "G:scenarios";
const PUBLISH = "G:publish";
const ledgerPath = (repo) => join(repo.dir, ".pairingbuddy", "run", "task", "ledger.json");
const configPath = (repo) => join(repo.dir, ".pairingbuddy", "test-config.json");
const ledgerBytes = (repo) => readFileSync(ledgerPath(repo), "utf8");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// A config_change task whose two stages are done, so G:task-end stands behind code-safety-net.
const safetyNetDone = (over = {}) => ({
  taskType: "config_change",
  stage: { name: "code-safety-net", status: "done", runId: "wf_2", attempt: 1, startedAt: null },
  stages: [{ name: "code-config", status: "done" }, { name: "code-safety-net", status: "done" }],
  ...over,
});

// A publish run whose pr-draft stage is done, so G:publish stands behind it.
const draftDone = (over = {}) => ({
  kind: "publish",
  taskType: "publish",
  stage: { name: "pr-draft", status: "done", runId: "wf_pr", attempt: 1, startedAt: null },
  stages: [{ name: "pr-draft", status: "done" }],
  ...over,
});

function refused(result, code = 1) {
  assert.equal(result.code, code, `exit ${code}: stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(result.stdout, "");
  return result.stderr;
}

function succeeded(result) {
  assert.equal(result.code, 0, `exit 0: stderr ${result.stderr}`);
  return JSON.parse(result.stdout);
}

describe("pb gate eval reports a gate a human answered", () => {
  test("an answered stop is reported with the stop's reason and the approve command, and changes nothing", () => {
    const reason = "the human answered stop at G:task-end";
    const repo = makeRepo({ ledger: safetyNetDone({ gates: { [TASK_END]: { source: "human", answer: "stop" } }, stop: { code: HUMAN_STOPPED, reason, seq: 0 } }) });
    const before = ledgerBytes(repo);

    const output = succeeded(pb(repo, "gate", "eval"));

    assert.deepEqual(output, { ok: true, result: "answered", gate: TASK_END, answer: "stop", reason, humanCommand: humanCommand(repo.dir, `approve ${TASK_END}`) });
    assert.equal(ledgerBytes(repo), before);
  });

  test("an answer that set no stop is reported as the human's answer", () => {
    const repo = makeRepo({ ledger: draftDone({ gates: { [PUBLISH]: { source: "human", answer: "keep-local" } } }) });

    const output = succeeded(pb(repo, "gate", "eval"));

    assert.deepEqual(output, { ok: true, result: "answered", gate: PUBLISH, answer: "keep-local", reason: "the human answered keep-local", humanCommand: humanCommand(repo.dir, `approve ${PUBLISH}`) });
  });

  test("a redo that has not restarted is named in the refusal, with the attempt it restarts at", () => {
    const repo = makeRepo({ ledger: safetyNetDone({
      stage: { name: "code-safety-net", status: "redo", runId: "wf_2", attempt: 1, startedAt: null },
      stages: [{ name: "code-config", status: "done" }, { name: "code-safety-net", status: "redo" }],
    }) });

    const stderr = refused(pb(repo, "gate", "eval"));

    assert.equal(stderr, "pb: no gate is due: the human answered redo, so code-safety-net restarts at attempt 2\n");
  });
});

describe("pb human approve", () => {
  for (const args of [[], [TASK_END, SCENARIOS]]) {
    test(`${args.length} arguments is a usage error`, () => {
      const repo = makeRepo({ ledger: safetyNetDone() });
      assert.equal(refused(pb(repo, "human", "approve", ...args), 2), "pb: usage: pb human approve <gate>\n");
    });
  }

  test("a gate when none is waiting is refused, and the ledger is untouched", () => {
    const repo = makeRepo();
    const before = ledgerBytes(repo);

    assert.equal(refused(pb(repo, "human", "approve", TASK_END)), `pb: gate ${TASK_END} is neither due nor pending. No gate is waiting.\n`);
    assert.equal(ledgerBytes(repo), before);
  });

  test("a gate other than the waiting one is refused, naming the one that waits", () => {
    const repo = makeRepo({ ledger: safetyNetDone() });
    const before = ledgerBytes(repo);

    assert.equal(refused(pb(repo, "human", "approve", SCENARIOS)), `pb: gate ${SCENARIOS} is neither due nor pending. Gate ${TASK_END} is waiting.\n`);
    assert.equal(ledgerBytes(repo), before);
  });
});

describe("pb human abandon", () => {
  test("an argument is a usage error, and nothing is removed", () => {
    const repo = makeRepo();
    const before = ledgerBytes(repo);

    assert.equal(refused(pb(repo, "human", "abandon", "now"), 2), "pb: usage: pb human abandon\n");
    assert.equal(ledgerBytes(repo), before);
  });

  test("with no unit or task open it says there is nothing to abandon", () => {
    const repo = makeRepo({ openTask: false });

    assert.deepEqual(succeeded(pb(repo, "human", "abandon")), { ok: true, result: "nothing-to-abandon", removed: [], message: "nothing to abandon: no unit or task is open" });
  });
});

describe("pb human approve-config", () => {
  test("an argument is a usage error", () => {
    const repo = makeRepo({ configGlobs: [] });
    assert.equal(refused(pb(repo, "human", "approve-config", "yes"), 2), "pb: usage: pb human approve-config\n");
  });

  test("a task that is not a config_change is refused by its type, and the ledger is untouched", () => {
    const repo = makeRepo({ ledger: { taskType: "new_feature" }, configGlobs: [] });
    const before = ledgerBytes(repo);

    assert.equal(refused(pb(repo, "human", "approve-config")), "pb: no approval needed: this task is new_feature, not a config_change\n");
    assert.equal(ledgerBytes(repo), before);
  });

  test("an untyped task is refused as not typed", () => {
    const repo = makeRepo({ ledger: { taskType: null }, configGlobs: [] });

    assert.equal(refused(pb(repo, "human", "approve-config")), "pb: no approval needed: this task is not typed, not a config_change\n");
  });

  test("a config_change with no config_globs records the human's approval", () => {
    const repo = makeRepo({ configGlobs: [] });

    assert.deepEqual(succeeded(pb(repo, "human", "approve-config")), { ok: true, source: "human-cli" });
    assert.deepEqual(repo.ledger().configApproval, { source: "human-cli" });
  });
});

describe("pb human accept", () => {
  const changeConfig = (repo, command) => {
    const config = JSON.parse(readFileSync(configPath(repo), "utf8"));
    config.runners[config.default_runner].command = command;
    const text = JSON.stringify(config);
    writeFileSync(configPath(repo), text);
    return sha256(text);
  };

  test("an argument is a usage error", () => {
    const repo = makeRepo();
    assert.equal(refused(pb(repo, "human", "accept", "all"), 2), "pb: usage: pb human accept [--legacy <unit> --plan <plan.md>]\n");
  });

  test("a changed test-config with no ledger edit pins the new hash and records the acceptance, and nothing else", () => {
    const repo = makeRepo();
    const oldHash = repo.ledger().configHash;
    const newHash = changeConfig(repo, "node other.mjs");
    const { seq } = repo.ledger();

    const output = succeeded(pb(repo, "human", "accept"));

    const accepted = { oldHash, newHash, seq: seq + 1 };
    assert.deepEqual(output, { ok: true, config: accepted });
    assert.equal(repo.ledger().configHash, newHash);
    assert.deepEqual(repo.ledger().configAcceptances, [accepted]);
    assert.equal(repo.ledger().acceptances, undefined, "no ledger acceptance is recorded");
  });

  test("a second change appends its acceptance after the first", () => {
    const repo = makeRepo();
    const firstHash = changeConfig(repo, "node other.mjs");
    const first = succeeded(pb(repo, "human", "accept")).config;
    const secondHash = changeConfig(repo, "node third.mjs");

    const second = succeeded(pb(repo, "human", "accept")).config;

    assert.deepEqual(second, { oldHash: firstHash, newHash: secondHash, seq: first.seq + 1 });
    assert.deepEqual(repo.ledger().configAcceptances, [first, second]);
  });

  test("once accepted, the same config is not accepted again: there is nothing to accept", () => {
    const repo = makeRepo();
    changeConfig(repo, "node other.mjs");
    succeeded(pb(repo, "human", "accept"));
    const before = ledgerBytes(repo);

    assert.equal(refused(pb(repo, "human", "accept")), `pb: nothing to accept: ledger ${ledgerPath(repo)} has no sha mismatch, and test-config.json has not changed\n`);
    assert.equal(ledgerBytes(repo), before);
  });
});

describe("refusal messages", () => {
  test("pb stage report with no report for the stage names the stage, attempt and status", () => {
    const repo = makeRepo();
    assert.equal(refused(pb(repo, "stage", "report")), "pb: no report for code-config at attempt 2: the stage is active\n");
  });

  test("pb stage report before any stage says so", () => {
    const repo = makeRepo({ ledger: { stage: { name: "", status: "", runId: null, attempt: 0, startedAt: null } } });
    assert.equal(refused(pb(repo, "stage", "report")), "pb: no report for (no stage) at attempt 0: the stage is not started\n");
  });

  test("pb publish after keep local refuses while the run is stopped, and keeps the unit and the run", () => {
    const repo = makeRepo({ ledger: draftDone({ gates: { [PUBLISH]: { source: "human", answer: "keep-local" } }, stop: { code: HUMAN_STOPPED, reason: "stopped for the test", seq: 0 } }) });
    const unit = join(repo.dir, ".pairingbuddy", "run", "unit.json");
    writeFileSync(unit, "{}");
    const before = ledgerBytes(repo);

    assert.equal(refused(pb(repo, "publish")), "pb: not published: the run stopped: stopped for the test\n");
    assert.equal(ledgerBytes(repo), before);
    assert.equal(readFileSync(unit, "utf8"), "{}", "the unit is not closed");
  });

  test("pb pr lint outside pr-draft names the current stage", () => {
    const repo = makeRepo();
    writeFileSync(join(repo.dir, ".pairingbuddy", "run", "unit.json"), "{}");
    assert.equal(refused(pb(repo, "pr", "lint")), "pb: the current stage is code-config, not pr-draft, so there is no draft to lint\n");
  });

  test("pb pr lint before any stage names none", () => {
    const repo = makeRepo({ ledger: { stage: { name: "", status: "", runId: null, attempt: 0, startedAt: null } } });
    writeFileSync(join(repo.dir, ".pairingbuddy", "run", "unit.json"), "{}");
    assert.equal(refused(pb(repo, "pr", "lint")), "pb: the current stage is none, not pr-draft, so there is no draft to lint\n");
  });

  test("pb pr lint with no unit open says so", () => {
    const repo = makeRepo({ ledger: draftDone() });
    assert.equal(refused(pb(repo, "pr", "lint")), "pb: no unit is open (run/unit.json is missing), so there is no draft to lint\n");
  });

  const known = Object.keys(VERBS).filter((verb) => !VERB_CLASSES.human.includes(verb));

  test("an unknown verb is a usage error that lists the known verbs but no human verb", () => {
    const repo = makeRepo();
    const stderr = refused(pb(repo, "frobnicate", "now", "please"), 2);

    assert.equal(stderr, `pb: unknown verb: frobnicate now. Known: ${known.join(", ")}\n`);
    assert.ok(known.includes("gate eval") && !known.some((verb) => verb.startsWith("human ")));
  });

  test("no verb at all is named as none", () => {
    const repo = makeRepo();
    assert.equal(refused(pb(repo), 2), `pb: unknown verb: (none). Known: ${known.join(", ")}\n`);
  });
});

describe("gh output pb cannot use", () => {
  test("a recorded PR checked with gh pr view output that is not JSON is refused, quoting the output", () => {
    const unit = unitWithRecordedPr();

    const { result } = publishUnit(unit, { GH_SHIM_VIEW: "this is not json" });

    assert.equal(refused(result), "pb: gh pr view gave output that is not JSON: this is not json\n");
  });

  test("the quoted output is cut at 200 characters", () => {
    const unit = unitWithRecordedPr();
    const long = `x${"y".repeat(300)}`;

    const { result } = publishUnit(unit, { GH_SHIM_VIEW: long });

    assert.equal(refused(result), `pb: gh pr view gave output that is not JSON: ${long.slice(0, 200)}\n`);
  });

  // A doctor-only gh: repo view and the repo answer well, the protection call fails with the given stdout.
  function doctorGh(protectionStdout) {
    const bin = realpathSync(mkdtempSync(join(tmpdir(), "pb-safeguard-gh-")));
    const repoJson = JSON.stringify({ default_branch: "main", squash_merge_commit_title: "PR_TITLE", squash_merge_commit_message: "PR_BODY" });
    writeFileSync(join(bin, "gh"), `#!/bin/sh
case "$*" in
  "repo view"*) echo '{"nameWithOwner":"o/r"}' ;;
  "api repos/o/r/branches/main/protection"*) printf '%s' '${protectionStdout}'; exit 1 ;;
  "api repos/o/r"*) echo '${repoJson}' ;;
  *) exit 1 ;;
esac
`);
    chmodSync(join(bin, "gh"), 0o755);
    return { PATH: `${bin}:${process.env.PATH}` };
  }

  test("a protection answer that is a GitHub error other than not-protected is unreadable", () => {
    const repo = makeRepo();
    const output = succeeded(pbWithEnv(repo, doctorGh('{"message":"Must have admin rights to Repository.","status":"403"}'), "git", "doctor"));
    assert.deepEqual(output, { ok: true, warnings: [], note: "branch protection could not be read: the default branch was not checked." });
  });

  test("a protection failure whose JSON is not a GitHub error makes gh unavailable", () => {
    const repo = makeRepo();
    const output = succeeded(pbWithEnv(repo, doctorGh('{"status":"500"}'), "git", "doctor"));
    assert.deepEqual(output, { ok: true, warnings: [], note: "gh is unavailable: the git settings were not checked." });
  });

  test("a protection failure with no output makes gh unavailable", () => {
    const repo = makeRepo();
    const output = succeeded(pbWithEnv(repo, doctorGh(""), "git", "doctor"));
    assert.deepEqual(output, { ok: true, warnings: [], note: "gh is unavailable: the git settings were not checked." });
  });
});
