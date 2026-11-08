// G:publish, the continue-class gate at the end of a publish unit: what pb gate eval decides and shows, driven through
// the real CLI in a temp git repo. How the human's answer is recorded and bound lives in publish-gate-answers.test.mjs.
// The setup is publishRepo in publish-fixture.mjs: a unit with commits, the draft the tap would have filed, and a
// ledger whose pr-draft stage is done, with the policy recorded by the gate hook.
import "./isolated-tmpdir.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isGateQuestionCall } from "../../shared-node/gates.mjs";
import { loadStages } from "../../shared-node/stages.mjs";
import { updateLedger } from "../../shared-node/ledger.mjs";
import { pb, ROOT } from "./cli-repo-fixture.mjs";
import {
  BAD_TITLE, CLEAN_BODY, COORDINATION, DRAFT_KEY, GATE, HYPE_BODY, REFUSED,
  commitMore, evalGate, git, lintOf, publishRepo, unitFile,
} from "./publish-fixture.mjs";
import { sha256 } from "./tap-fixture.mjs";

const LENS_REASON = /no lens record yet/;
const HUMAN_ONLY_REASON = "G:publish is approved by a human, never by the auto policy";
// A safety-net lens record is ledger.lenses["safety-net"], and any non-empty object stands for it. Nothing writes real
// lens records yet; when the task that does lands, seed this from its writer instead.
const LENS_RECORD = { "safety-net": { lenses: ["correctness"], status: "done" } };

const ledgerPathOf = (runDir) => join(runDir, "task", "ledger.json");

describe("publish-gate-contract", () => {
  test("stages.json gives the pr-draft node the gate G:publish with class continue, and the contract loads", () => {
    const contract = loadStages(ROOT);

    const type = Object.values(contract.taskTypes).find((graph) => graph.nodes.some((node) => node.name === "pr-draft"));

    assert.ok(type, "some task type has a pr-draft node");
    assert.equal(type.nodes.find((node) => node.name === "pr-draft").gate, GATE);
    assert.equal(type.gates[GATE].class, "continue");
  });

  test("G:publish is due when pr-draft is done and has no record", () => {
    const { repo } = publishRepo();

    const asked = evalGate(repo);

    assert.equal(asked.gate, GATE);
    assert.equal(asked.result, "needs-human");
  });

  test("G:publish is not due while pr-draft is running", () => {
    const { repo } = publishRepo({ stageStatus: "active" });

    const early = pb(repo, "gate", "eval");

    assert.equal(early.code, REFUSED, "no gate is due while pr-draft runs");
    assert.match(early.stderr, /no gate is due/);
  });

  test("a unit with no commits past baseSha has no G:publish and skips publish (D19)", () => {
    const { repo } = publishRepo({ commits: 0 });
    assert.equal(git(repo, "rev-parse", "HEAD"), JSON.parse(readFileSync(unitFile(repo), "utf8")).baseSha, "HEAD is the unit's baseSha");

    const result = pb(repo, "gate", "eval");

    assert.equal(result.code, 0, `skipping is a normal outcome, not a failure: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.result, "skip");
    assert.match(output.reason, /no commits/);
    assert.equal(Object.hasOwn(repo.ledger().gates, GATE), false);
    assert.equal(repo.ledger().needsHuman, null);
  });
});

describe("publish-gate-shown", () => {
  test("the result carries the draft artifact's title, the body from run/pr-body.md, the lint ok and failures, and the coordination text apart from the body", () => {
    const { repo, lint } = publishRepo({ title: BAD_TITLE });

    const { shown } = evalGate(repo);

    assert.equal(shown.title, BAD_TITLE);
    assert.equal(shown.body, CLEAN_BODY);
    assert.equal(shown.lint.ok, false);
    assert.ok(shown.lint.failures.some(({ rule }) => rule === "title-form"), "the lint failures are shown");
    assert.deepEqual(shown.lint.failures, lint.failures);
    assert.equal(shown.coordination, COORDINATION);
    assert.ok(!shown.body.includes(COORDINATION), "the coordination text is not part of the body");
  });

  test("a null coordination is shown as no comment", () => {
    const { repo } = publishRepo({ coordination: null });

    const { shown } = evalGate(repo);

    assert.equal(shown.coordination, "no comment");
  });

  test("the result carries the unit's commits, the base branch and the current HEAD SHA", () => {
    const { repo, recorded } = publishRepo({ commits: 2 });

    const { shown } = evalGate(repo);

    assert.deepEqual(shown.commits.map(({ sha, subject, inUnit }) => ({ sha, subject, inUnit })), [
      { sha: recorded[0], subject: "feat: add export 1", inUnit: true },
      { sha: recorded[1], subject: "feat: add export 2", inUnit: true },
    ]);
    assert.equal(shown.base, "main");
    assert.equal(shown.headSha, git(repo, "rev-parse", "HEAD"));
  });

  test("the result carries the full-suite test command from test-config.json", () => {
    const { repo } = publishRepo();
    const config = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "test-config.json"), "utf8"));

    const { shown } = evalGate(repo);

    assert.equal(shown.testCommand, config.runners[config.default_runner].command);
  });

  test("the G:publish question carries the CLI's own text and header and passes isGateQuestionCall", () => {
    const { repo } = publishRepo();

    const { question } = evalGate(repo);

    assert.equal(question.question, `Approve ${GATE}?`);
    assert.equal(question.header, `PB gate: ${GATE}`);
    assert.equal(isGateQuestionCall(GATE, [question]), true);
  });

  test("the question offers exactly publish, keep local and redo", () => {
    const { repo } = publishRepo();

    const { question } = evalGate(repo);

    assert.deepEqual(question.options.map(({ label }) => label), ["publish", "keep local", "redo"]);
    assert.equal(question.multiSelect, false);
  });

  test("gate eval stores the shown HEAD, base and target on needsHuman", () => {
    const { repo } = publishRepo();

    const asked = evalGate(repo);

    assert.deepEqual(repo.ledger().needsHuman.shown, { headSha: git(repo, "rev-parse", "HEAD"), base: "main", target: "main" });
    assert.equal(asked.shown.headSha, repo.ledger().needsHuman.shown.headSha);
  });
});

describe("publish-unlisted-commits", () => {
  // publishRepo seeds unit.commits (see there for why), then one commit is made by hand and so is not in the record.
  test("a hand-made commit on the unit branch appears flagged as not in the unit record, and recorded commits are not flagged", () => {
    const { repo, recorded } = publishRepo({ commits: 2 });
    commitMore(repo, "hand-made");
    const handMade = git(repo, "rev-parse", "HEAD");

    const { shown } = evalGate(repo);

    assert.deepEqual(shown.commits.map(({ sha, inUnit }) => ({ sha, inUnit })), [
      { sha: recorded[0], inUnit: true },
      { sha: recorded[1], inUnit: true },
      { sha: handMade, inUnit: false },
    ]);
  });
});

describe("publish-lint", () => {
  for (const mode of ["auto", "default", "acceptEdits", "bypassPermissions"]) {
    test(`ok false in pr-lint.json gives needs-human naming the lint failure under ${mode}`, () => {
      const { repo } = publishRepo({ title: BAD_TITLE, mode });

      const asked = evalGate(repo);

      assert.equal(asked.result, "needs-human");
      assert.equal(asked.gate, GATE);
      assert.match(asked.reason, /lint/i, "the reason names the lint");
      assert.match(asked.reason, /title-form/, "the reason names the failing rule");
    });
  }

  test("with no run/pr-lint.json the gate asks and says the lint has not run", () => {
    const { repo, runDir } = publishRepo({ mode: "auto" });
    rmSync(join(runDir, "pr-lint.json"));

    const asked = evalGate(repo);

    assert.equal(asked.result, "needs-human");
    assert.match(asked.reason, /lint.*not.*run/i);
    assert.equal(asked.shown.lint.ok, false);
  });

  test("an edit that breaks a lint rule leaves the gate asking with the new failures shown", () => {
    const { repo, runDir } = publishRepo();
    writeFileSync(join(runDir, "pr-body.md"), HYPE_BODY);
    assert.equal(pb(repo, "pr", "lint").code, 0);

    const asked = evalGate(repo);

    assert.equal(asked.result, "needs-human");
    assert.equal(asked.shown.lint.ok, false);
    assert.ok(asked.shown.lint.failures.some(({ rule }) => rule === "hype"), "the new hype failure is shown");
    assert.equal(asked.shown.body, HYPE_BODY);
  });

  test("a pr-lint.json whose bodyHash differs from the current body is stale, not the lint result", () => {
    const { repo, runDir } = publishRepo({ mode: "auto" });
    writeFileSync(join(runDir, "pr-body.md"), `${CLEAN_BODY}\nEdited after the lint ran.\n`);
    assert.equal(lintOf(runDir).ok, true, "the lint on disk still says ok");
    assert.notEqual(lintOf(runDir).bodyHash, sha256(readFileSync(join(runDir, "pr-body.md"), "utf8")), "it was made for another body");

    const asked = evalGate(repo);

    assert.equal(asked.result, "needs-human");
    assert.equal(asked.shown.lint.ok, false, "a lint for another body shows as not ok");
    assert.match(asked.reason, /stale/);
  });
});

describe("publish-auto-mode", () => {
  test("under auto with a passing lint, gate eval returns needs-human with the reason no lens record yet", () => {
    const { repo, lint } = publishRepo({ mode: "auto" });
    assert.equal(lint.ok, true);

    const asked = evalGate(repo);

    assert.equal(asked.result, "needs-human");
    assert.equal(asked.gate, GATE);
    assert.match(asked.reason, LENS_REASON);
    assert.equal(repo.ledger().needsHuman?.gate, GATE);
  });

  test("no G:publish record is written under auto: the gate asks and records nothing", () => {
    const { repo } = publishRepo({ mode: "auto" });

    evalGate(repo);

    assert.equal(Object.hasOwn(repo.ledger().gates, GATE), false);
    assert.equal(repo.ledger().needsHuman.gate, GATE);
  });

  test("with a lens record for the safety net seeded and the lint passing at the body hash, the lens reason disappears and the human-only reason stays", () => {
    const { repo, runDir, lint } = publishRepo({ mode: "auto" });
    assert.equal(lint.bodyHash, sha256(CLEAN_BODY));
    updateLedger(ledgerPathOf(runDir), (ledger) => ({ ...ledger, lenses: LENS_RECORD }));

    const asked = evalGate(repo);

    assert.equal(asked.result, "needs-human");
    assert.doesNotMatch(asked.reason, LENS_REASON);
    assert.equal(asked.reason, HUMAN_ONLY_REASON);
    assert.equal(Object.hasOwn(repo.ledger().gates, GATE), false, "auto never writes the publish approval itself");
  });
});

describe("publish-gate-refusals", () => {
  test("G:publish due with run/unit.json missing refuses, naming the file", () => {
    const { repo } = publishRepo();
    rmSync(unitFile(repo));

    const refused = pb(repo, "gate", "eval");

    assert.equal(refused.code, REFUSED);
    assert.match(refused.stderr, /run\/unit\.json/);
    assert.equal(Object.hasOwn(repo.ledger().gates, GATE), false);
  });

  test("G:publish due with the current draft artifact missing refuses, naming the pb_key", () => {
    const { repo, runDir } = publishRepo();
    rmSync(join(runDir, "task", "artifacts", `${DRAFT_KEY}.json`));

    const refused = pb(repo, "gate", "eval");

    assert.equal(refused.code, REFUSED);
    assert.ok(refused.stderr.includes(DRAFT_KEY), `the refusal names the pb_key: ${refused.stderr}`);
    assert.equal(Object.hasOwn(repo.ledger().gates, GATE), false);
  });

  test("a recorded stop gives its own reason at G:publish", () => {
    const { repo, runDir } = publishRepo();
    // The stop is patched into the ledger: the only way to record one is to answer stop at a gate, and G:publish has
    // no stop option. seq has to advance by one, as every ledger write does.
    updateLedger(ledgerPathOf(runDir), (ledger) => ({ ...ledger, stop: { code: "HUMAN_STOPPED", reason: "the human answered stop earlier", seq: ledger.seq + 1 } }));

    const asked = evalGate(repo);

    assert.equal(asked.result, "needs-human");
    assert.equal(asked.gate, GATE);
    assert.match(asked.reason, /the run stopped: the human answered stop earlier/);
  });

  test("a changed config hash stops the evaluation itself", () => {
    const { repo } = publishRepo();
    const configPath = join(repo.dir, ".pairingbuddy", "test-config.json");
    writeFileSync(configPath, `${readFileSync(configPath, "utf8")}\n`);

    const refused = pb(repo, "gate", "eval");

    assert.equal(refused.code, REFUSED);
    assert.match(refused.stderr, /config hash changed/);
    assert.equal(Object.hasOwn(repo.ledger().gates, GATE), false);
  });

  test("a missing pr-body.md at gate eval is a refusal that leaves needsHuman unset", () => {
    const { repo, runDir } = publishRepo();
    rmSync(join(runDir, "pr-body.md"));

    const refused = pb(repo, "gate", "eval");

    assert.equal(refused.code, REFUSED);
    assert.match(refused.stderr, /run\/pr-body\.md/);
    assert.doesNotMatch(refused.stderr, /unexpected failure/);
    assert.equal(repo.ledger().needsHuman, null);
  });

  test("a test-config with no default runner is a refusal, not a crash", () => {
    const { repo, runDir } = publishRepo();
    const path = join(repo.dir, ".pairingbuddy", "test-config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...config, default_runner: "nope" }));
    updateLedger(ledgerPathOf(runDir), (ledger) => ({ ...ledger, configHash: sha256(readFileSync(path, "utf8")) }));

    const refused = pb(repo, "gate", "eval");

    assert.equal(refused.code, REFUSED);
    assert.match(refused.stderr, /default runner/);
    assert.doesNotMatch(refused.stderr, /unexpected failure/);
  });

  test("a baseSha git no longer knows makes pb pr lint refuse with git's words, not a raw error", () => {
    const { repo } = publishRepo();
    const unitPath = unitFile(repo);
    writeFileSync(unitPath, JSON.stringify({ ...JSON.parse(readFileSync(unitPath, "utf8")), baseSha: "0".repeat(40) }));

    const refused = pb(repo, "pr", "lint");

    assert.equal(refused.code, REFUSED);
    assert.match(refused.stderr, /git diff --numstat/);
    assert.doesNotMatch(refused.stderr, /unexpected failure/);
  });
});
