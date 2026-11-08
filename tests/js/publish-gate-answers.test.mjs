// G:publish, the continue-class gate at the end of a publish unit: how the human's answer is read from the real tap
// (or typed as pb human approve), what the approval is bound to, and what keep local and redo leave behind. What the
// gate shows and when it asks lives in publish-gate-eval.test.mjs. The setup is publishRepo in publish-fixture.mjs.
import "./isolated-tmpdir.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isPassed } from "../../shared-node/gates.mjs";
import { nextAttempt } from "../../shared-node/stages.mjs";
import { updateLedger } from "../../shared-node/ledger.mjs";
import { env, pb } from "./cli-repo-fixture.mjs";
import {
  BAD_TITLE, CLEAN_BODY, CLEAN_TITLE, GATE, REFUSED,
  approvedThroughTap, commitMore, evalGate, git, lintOf, publishRepo, reworded, setPolicyThroughGate, unitFile,
} from "./publish-fixture.mjs";
import { recordedAnswer, runTap, sha256 } from "./tap-fixture.mjs";

const ledgerPathOf = (runDir) => join(runDir, "task", "ledger.json");
const prBody = (runDir) => join(runDir, "pr-body.md");
const gitConfigPath = (repo) => join(repo.dir, ".pairingbuddy", "git-config.json");

describe("publish-gate-choices", () => {
  test("a publish answer read from the tap records G:publish as a human approval with its binding", () => {
    const { repo } = publishRepo();
    const { question } = evalGate(repo);

    runTap(repo, recordedAnswer(repo, question, "publish"));

    const ledger = repo.ledger();
    assert.deepEqual(ledger.gates[GATE], {
      source: "human", answer: "approve", headSha: git(repo, "rev-parse", "HEAD"), bodyHash: sha256(CLEAN_BODY), titleHash: sha256(CLEAN_TITLE), labels: [], base: "main", target: "main",
    });
    assert.equal(isPassed(ledger, GATE), true);
    assert.equal(ledger.needsHuman, null);
  });

  test("redo clears the G:publish record, re-runs pr-draft at the next attempt and appends the human's note to human-guidance.json", () => {
    const { repo } = publishRepo();
    const { question } = evalGate(repo);

    runTap(repo, recordedAnswer(repo, question, "redo", { notes: "Say what the button does for a reader" }));

    const ledger = repo.ledger();
    assert.equal(Object.hasOwn(ledger.gates, GATE), false);
    assert.equal(ledger.stage.name, "pr-draft");
    assert.equal(ledger.stage.status, "redo");
    assert.equal(nextAttempt(ledger, "pr-draft"), 2);
    const guidance = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "human-guidance.json"), "utf8")).guidance;
    assert.equal(guidance.length, 1);
    assert.equal(guidance[0].feedback, "Say what the button does for a reader");
    assert.equal(guidance[0].context, `redo at ${GATE}`);
  });

  // The model-written dialog case lives here, through the tap, which is what must not take it as the human's answer.
  describe("an answer that is not the human's leaves the gate unrecorded", () => {
    const cases = [
      { name: "a label the question does not offer", dialog: (question) => ({ shown: question, answer: "approve" }) },
      { name: "a reworded dialog the CLI did not emit", dialog: (question) => ({ shown: reworded(question), answer: "publish" }) },
      {
        name: "the generic approve, redo, stop dialog",
        dialog: (question) => ({
          shown: { ...question, options: [{ label: "approve", description: "Approve this gate and let the run continue." }, { label: "redo", description: "Redo the stage before this gate." }, { label: "stop", description: "Stop here." }] },
          answer: "approve",
        }),
      },
    ];
    for (const { name, dialog } of cases) {
      test(name, () => {
        const { repo } = publishRepo();
        const { question } = evalGate(repo);
        const { shown, answer } = dialog(question);

        runTap(repo, recordedAnswer(repo, shown, answer));

        const ledger = repo.ledger();
        assert.equal(Object.hasOwn(ledger.gates, GATE), false, "nothing is recorded");
        assert.equal(ledger.needsHuman?.gate, GATE, "the gate still waits");
        assert.equal(existsSync(join(repo.dir, ".pairingbuddy", "human-guidance.json")), false);
      });
    }
  });
});

describe("publish-binding", () => {
  test("the ledger gate record holds headSha, bodyHash (sha256 of run/pr-body.md), base and target (pr.base_branch when set)", () => {
    const { repo } = publishRepo();
    writeFileSync(gitConfigPath(repo), JSON.stringify({ pr: { base_branch: "develop" } }));

    approvedThroughTap(repo);

    const record = repo.ledger().gates[GATE];
    assert.equal(record.headSha, git(repo, "rev-parse", "HEAD"));
    assert.equal(record.bodyHash, sha256(CLEAN_BODY));
    assert.equal(record.base, "main");
    assert.equal(record.target, "develop");
  });

  test("pb human approve G:publish records the same binding with source human-cli", () => {
    const { repo } = publishRepo();
    evalGate(repo);

    const approved = pb(repo, "human", "approve", GATE);

    assert.equal(approved.code, 0, approved.stderr);
    assert.deepEqual(repo.ledger().gates[GATE], {
      source: "human-cli", answer: "approve", headSha: git(repo, "rev-parse", "HEAD"), bodyHash: sha256(CLEAN_BODY), titleHash: sha256(CLEAN_TITLE), labels: [], base: "main", target: "main",
    });
  });

  test("a commit after approval moves HEAD off the bound SHA: G:publish no longer counts as passed and gate eval asks again, naming the bound and current SHA", () => {
    const { repo } = publishRepo();
    approvedThroughTap(repo);
    const bound = git(repo, "rev-parse", "HEAD");
    commitMore(repo);
    const current = git(repo, "rev-parse", "HEAD");

    const asked = evalGate(repo);

    assert.equal(asked.result, "needs-human");
    assert.equal(asked.gate, GATE);
    assert.ok(asked.reason.includes(bound.slice(0, 7)), `the reason names the bound SHA: ${asked.reason}`);
    assert.ok(asked.reason.includes(current.slice(0, 7)), `the reason names the current SHA: ${asked.reason}`);
    assert.equal(isPassed(repo.ledger(), GATE), false);
  });

  test("a body edit after approval, with HEAD unchanged, voids it: G:publish is not passed and gate eval asks again, naming the body", () => {
    const { repo, runDir } = publishRepo();
    approvedThroughTap(repo);
    const approval = repo.ledger().gates[GATE];
    writeFileSync(prBody(runDir), `${CLEAN_BODY}\nAn edit after the approval.\n`);

    const asked = evalGate(repo);

    assert.equal(asked.result, "needs-human");
    assert.equal(asked.gate, GATE);
    assert.equal(asked.reason, "the G:publish approval no longer holds: run/pr-body.md changed");
    assert.equal(isPassed(repo.ledger(), GATE), false);
    assert.deepEqual(repo.ledger().voidedGates.map(({ record }) => record), [approval]);
  });

  test("a voided G:publish asks with the void reason under auto policy, and its record moves to voidedGates", () => {
    const { repo } = publishRepo();
    approvedThroughTap(repo);
    const approval = repo.ledger().gates[GATE];
    const bound = git(repo, "rev-parse", "HEAD");
    setPolicyThroughGate(repo, "auto");
    commitMore(repo);
    const current = git(repo, "rev-parse", "HEAD");

    const asked = evalGate(repo);

    assert.equal(asked.result, "needs-human");
    assert.equal(asked.gate, GATE);
    assert.equal(asked.reason, `the G:publish approval no longer holds: HEAD moved from ${bound.slice(0, 7)} to ${current.slice(0, 7)}`);
    assert.equal(Object.hasOwn(repo.ledger().gates, GATE), false, "the voided record is not kept as a gate");
    assert.deepEqual(repo.ledger().voidedGates, [{ gate: GATE, record: approval, reason: asked.reason }]);
  });

  test("with HEAD and body unchanged the approval stands: no gate is due and the record is untouched", () => {
    const { repo } = publishRepo();
    approvedThroughTap(repo);
    const before = repo.ledger().gates[GATE];

    const again = pb(repo, "gate", "eval");

    assert.equal(again.code, REFUSED, "G:publish was the last gate, so none is due");
    assert.match(again.stderr, /no gate is due/);
    assert.deepEqual(repo.ledger().gates[GATE], before);
    assert.equal(repo.ledger().needsHuman, null);
  });
});

describe("publish-void-audit", () => {
  test("a voided approval is moved to voidedGates with its reason, in the same write that asks again", () => {
    const { repo } = publishRepo();
    approvedThroughTap(repo);
    const approval = repo.ledger().gates[GATE];
    commitMore(repo);

    const asked = evalGate(repo);

    const ledger = repo.ledger();
    assert.equal(Object.hasOwn(ledger.gates, GATE), false);
    assert.equal(ledger.needsHuman.gate, GATE);
    assert.deepEqual(ledger.voidedGates, [{ gate: GATE, record: approval, reason: asked.reason }]);
    assert.doesNotMatch(asked.reason, /undefine/);
    assert.match(asked.reason, /HEAD moved from/);
    assert.doesNotMatch(asked.reason, /changed/, "only HEAD moved");
  });

  test("a body-only change names the body, not HEAD", () => {
    const { repo, runDir } = publishRepo();
    approvedThroughTap(repo);
    writeFileSync(prBody(runDir), `${CLEAN_BODY}\nA later edit.\n`);

    const asked = evalGate(repo);

    assert.match(asked.reason, /run\/pr-body\.md changed/);
    assert.doesNotMatch(asked.reason, /HEAD moved/);
  });

  test("an approval with no binding says so instead of printing undefined", () => {
    const { repo, runDir } = publishRepo();
    // A bare approval cannot come from the tap or pb human approve, which always bind, so it is written to the ledger.
    updateLedger(ledgerPathOf(runDir), (ledger) => ({ ...ledger, gates: { ...ledger.gates, [GATE]: { source: "human", answer: "approve" } } }));

    const asked = evalGate(repo);

    assert.match(asked.reason, /carries no binding/);
    assert.doesNotMatch(asked.reason, /undefine/);
  });
});

describe("publish-body-edit", () => {
  test("after an edit, approval records the edited body's hash and run/pr-lint.json holds the new bodyHash", () => {
    const { repo, runDir } = publishRepo();
    const edited = `${CLEAN_BODY}\nThe button sits above the table.\n`;
    writeFileSync(prBody(runDir), edited);

    approvedThroughTap(repo);

    assert.equal(repo.ledger().gates[GATE].bodyHash, sha256(edited));
    assert.equal(lintOf(runDir).bodyHash, sha256(edited));
    assert.equal(lintOf(runDir).ok, true);
  });

  test("with run/pr-body.md missing, approval is refused with a message naming the file", () => {
    const { repo, runDir } = publishRepo();
    evalGate(repo);
    rmSync(prBody(runDir));

    const refused = pb(repo, "human", "approve", GATE);

    assert.equal(refused.code, REFUSED);
    assert.match(refused.stderr, /pr-body\.md/);
    assert.equal(Object.hasOwn(repo.ledger().gates, GATE), false);
  });
});

describe("publish-failed-lint", () => {
  test("a human approval over a failed lint is accepted and the binding records that the lint failed", () => {
    const { repo } = publishRepo({ title: BAD_TITLE });

    approvedThroughTap(repo);

    const record = repo.ledger().gates[GATE];
    assert.equal(record.source, "human");
    assert.equal(record.answer, "approve");
    assert.equal(record.lintOk, false);
    assert.ok(record.lintFailures.some(({ rule }) => rule === "title-form"), "the failures are kept");
    assert.equal(repo.ledger().needsHuman, null);
  });
});

// A gh stand-in on PATH that appends its arguments to a file, so a test can see whether gh was called at all.
function ghShim() {
  const dir = join(process.env.TMPDIR, `pb-gh-shim-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const calls = join(dir, "calls.txt");
  writeFileSync(join(dir, "gh"), `#!/bin/sh\necho "$@" >> "${calls}"\n`, { mode: 0o755 });
  return { env: { PATH: `${dir}:${process.env.PATH}` }, calls: () => (existsSync(calls) ? readFileSync(calls, "utf8") : "") };
}

// "keep local" read from the tap records gates["G:publish"] = { source: "human", answer: "keep-local" } (no binding, no
// stop) and removes run/unit.json; commits, branch and refs/pairingbuddy/ refs are left alone.
function keepLocalThroughTap(repo, shim = ghShim()) {
  const { question } = evalGate(repo);
  runTap(repo, recordedAnswer(repo, question, "keep local"), shim.env);
  return shim;
}

describe("publish-keep-local", () => {
  test("no unit is open afterwards, the branch tip and commits since baseSha are unchanged and refs/pairingbuddy/ refs survive", () => {
    const { repo, recorded } = publishRepo({ commits: 2 });
    const { baseSha } = JSON.parse(readFileSync(unitFile(repo), "utf8"));
    git(repo, "update-ref", "refs/pairingbuddy/checkpoint", recorded[0]);
    const tip = git(repo, "rev-parse", "HEAD");
    const branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD");

    keepLocalThroughTap(repo);

    assert.equal(existsSync(unitFile(repo)), false, "no unit is open");
    assert.equal(git(repo, "rev-parse", branch), tip, "the branch tip is unchanged");
    assert.deepEqual(git(repo, "rev-list", "--reverse", `${baseSha}..HEAD`).split("\n"), recorded, "the commits since baseSha are unchanged");
    assert.equal(git(repo, "rev-parse", "refs/pairingbuddy/checkpoint"), recorded[0], "the pairingbuddy ref survives");
  });

  // Nothing pushes or calls gh yet, so the remote and gh checks guard the publish stage that will. That stage will also
  // write a "PR: " line (Task 71); its negative check for keep local belongs where that line is written, not here.
  test("the bare remote has no ref for the branch and the gh shim records no call", () => {
    const { repo } = publishRepo();
    const branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD");

    const shim = keepLocalThroughTap(repo);

    assert.equal(repo.ledger().gates[GATE]?.answer, "keep-local", "keep local was applied");
    assert.equal(execFileSync("git", ["ls-remote", "--heads", repo.remoteDir, branch], { env: env(), encoding: "utf8" }).trim(), "", "nothing was pushed");
    assert.equal(shim.calls(), "", "gh was never called");
  });

  test("the unit's pr-body.md and pr-lint.json go with it, so a later unit cannot pick them up, and the task stays", () => {
    const { repo, runDir } = publishRepo();

    keepLocalThroughTap(repo);

    assert.equal(existsSync(prBody(runDir)), false);
    assert.equal(existsSync(join(runDir, "pr-lint.json")), false);
    assert.equal(existsSync(ledgerPathOf(runDir)), true, "the task is not removed");
  });

  test("the ledger records the keep-local answer and sets no stop code", () => {
    const { repo } = publishRepo();

    keepLocalThroughTap(repo);

    const ledger = repo.ledger();
    assert.deepEqual(ledger.gates[GATE], { source: "human", answer: "keep-local" });
    assert.equal(ledger.stop, null, "no stop code");
    assert.equal(ledger.needsHuman, null);
  });
});

describe("publish-unlisted-commits", () => {
  test("the gate still asks normally and can be approved with an unlisted commit present", () => {
    const { repo } = publishRepo();
    commitMore(repo, "hand-made");

    const asked = evalGate(repo);
    runTap(repo, recordedAnswer(repo, asked.question, "publish"));

    assert.equal(asked.result, "needs-human");
    assert.equal(asked.gate, GATE);
    assert.equal(repo.ledger().gates[GATE].answer, "approve");
    assert.equal(repo.ledger().gates[GATE].headSha, git(repo, "rev-parse", "HEAD"));
    assert.equal(repo.ledger().needsHuman, null);
  });
});

describe("publish-shown-head", () => {
  test("a commit between the question and the tap answer records no approval, keeps the gate asking and says why", () => {
    const { repo } = publishRepo();
    const { question } = evalGate(repo);
    const shownSha = git(repo, "rev-parse", "HEAD");
    commitMore(repo);

    const out = runTap(repo, recordedAnswer(repo, question, "publish"), {}, { prints: true });

    const ledger = repo.ledger();
    assert.equal(Object.hasOwn(ledger.gates, GATE), false, "no approval is recorded");
    assert.equal(ledger.needsHuman.gate, GATE);
    assert.match(ledger.needsHuman.reason, /HEAD moved since the question/);
    assert.ok(ledger.needsHuman.reason.includes(shownSha.slice(0, 7)));
    const said = JSON.parse(out).hookSpecificOutput;
    assert.equal(said.hookEventName, "PostToolUse");
    assert.match(said.additionalContext, /HEAD moved since the question/);
    assert.match(evalGate(repo).reason, /HEAD moved since the question/, "gate eval keeps reporting it");
  });

  test("a commit between the question and pb human approve G:publish is refused and records nothing", () => {
    const { repo } = publishRepo();
    evalGate(repo);
    commitMore(repo);

    const refused = pb(repo, "human", "approve", GATE);

    assert.equal(refused.code, REFUSED);
    assert.match(refused.stderr, /HEAD moved since the question/);
    assert.equal(Object.hasOwn(repo.ledger().gates, GATE), false);
    assert.equal(repo.ledger().needsHuman.gate, GATE);
  });

  test("an edit to the body between the question and the answer still binds, at its answer-time hash (D20)", () => {
    const { repo, runDir } = publishRepo();
    const { question } = evalGate(repo);
    const edited = `${CLEAN_BODY}\nOne more line about the export button.\n`;
    writeFileSync(prBody(runDir), edited);

    runTap(repo, recordedAnswer(repo, question, "publish"));

    assert.equal(repo.ledger().gates[GATE].bodyHash, sha256(edited));
  });
});

describe("publish-tap-refusals", () => {
  test("a binding failure leaves needsHuman set with the reason on it and the hook says so; no unit.json is a refusal, not a crash", () => {
    const { repo } = publishRepo();
    const { question } = evalGate(repo);
    rmSync(unitFile(repo));

    const out = runTap(repo, recordedAnswer(repo, question, "publish"), {}, { prints: true });

    assert.equal(Object.hasOwn(repo.ledger().gates, GATE), false);
    assert.match(repo.ledger().needsHuman.reason, /the publish answer could not be bound: .*run\/unit\.json/);
    assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /run\/unit\.json/);
  });

  test("a missing git-config.json is not bootstrapped by the tap: the answer is refused and the file stays missing", () => {
    const { repo } = publishRepo();
    const { question } = evalGate(repo);
    rmSync(gitConfigPath(repo), { force: true });

    const out = runTap(repo, recordedAnswer(repo, question, "publish"), {}, { prints: true });

    assert.equal(existsSync(gitConfigPath(repo)), false, "the hook did not create it");
    assert.equal(Object.hasOwn(repo.ledger().gates, GATE), false);
    assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /git-config\.json is missing/);
  });
});
