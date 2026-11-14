// Placeholders for shared-node/lens-round.mjs: lensRound (the round's fold) and lensLines (the pane's plain lines).
// Each block names one test to write. implement-tests replaces each block with a real node:test test.

import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

import * as lensRoundModule from "../../shared-node/lens-round.mjs";

const { lensRound, lensLines } = lensRoundModule;
import { buildLabel } from "../../shared-node/labels.mjs";
import { buildKey } from "../../shared-node/keys.mjs";
import { plainName } from "../../shared-node/plain-names.mjs";
import { MAX_FIX_UNDOS } from "../../shared-node/limits.mjs";
import contract from "../../shared-node/stages-contract.mjs";

const REVIEW_STAGE = "code-safety-net";

function ledgerFor({ stage = REVIEW_STAGE, attempt = 1, status = "active", startedAt = null, rollbacks = [], stages = [], stop = null } = {}) {
  return { v: 1, stage: { name: stage, status, runId: "run-1", attempt, startedAt }, stages, fixes: { rollbacks }, stop };
}

function attemptCapStop() {
  return { reason: `attempt-cap: stage ${REVIEW_STAGE} rolled back ${MAX_FIX_UNDOS} fix attempts, its cap of ${MAX_FIX_UNDOS}`, seq: 7, code: "attempt-cap" };
}

function spawnFor({ stage = REVIEW_STAGE, role = "lens", item, round = 1, ...rest }) {
  return { kind: "workflow_agent", name: buildLabel({ stage, phase: null, role, item, round }), ...rest };
}

function callFor({ stage = REVIEW_STAGE, role = "lens", item, round = 1, attempt = 1, agentId, ...fields }) {
  return { agentId, input: { pb_key: buildKey({ stage, role, item, round, attempt }), ...fields } };
}

// scenario lens-round-visibility: lensRound returns a round only while a review round runs, or when it stopped at the attempt cap
test("no-round-without-ledger-or-during-tdd", () => {
  const lensSpawn = spawnFor({ item: "code" });
  const lensCall = callFor({ item: "code", findings: [] });

  const noLedger = lensRound({ ledger: undefined, calls: [lensCall], spawns: [lensSpawn], contract });
  const duringTdd = lensRound({ ledger: ledgerFor({ stage: "code-tdd" }), calls: [], spawns: [spawnFor({ stage: "code-tdd", role: "implement-tests", item: "t1" })], contract });
  const noLensSeen = lensRound({ ledger: ledgerFor(), calls: [], spawns: [], contract });
  const otherAttemptOnly = lensRound({ ledger: ledgerFor({ attempt: 2 }), calls: [callFor({ item: "code", attempt: 1, findings: [] })], spawns: [], contract });

  assert.equal(noLedger, undefined, "no ledger shows no round");
  assert.equal(duringTdd, undefined, "a TDD stage shows no round");
  assert.equal(noLensSeen, undefined, "a review stage with no lens spawn or return shows no round");
  assert.equal(otherAttemptOnly, undefined, "a lens return from another attempt does not count");
});
test("round-shown-with-plain-stage-name", () => {
  const ledger = ledgerFor();
  const spawns = [spawnFor({ item: "code" })];

  const round = lensRound({ ledger, calls: [], spawns, contract });

  assert.notEqual(round, undefined, "an active review stage with a lens spawn shows a round");
  assert.equal(round.stage, plainName(REVIEW_STAGE), "the stage is shown by its plain name");
  assert.equal(round.cap, MAX_FIX_UNDOS, "the cap comes from MAX_FIX_UNDOS");
  assert.equal(round.stopped, false, "a round with no stop is not stopped");
});
test("round-shown-when-stopped-at-attempt-cap", () => {
  const ledger = ledgerFor({ stop: attemptCapStop() });

  const round = lensRound({ ledger, calls: [], spawns: [], contract });

  assert.notEqual(round, undefined, "a run stopped at the attempt cap still shows its round with no spawns");
  assert.equal(round.stopped, true, "the round says it stopped");
  assert.equal(round.stage, plainName(REVIEW_STAGE), "the stage is shown by its plain name");
});
test("malformed-or-other-attempt-calls-ignored", () => {
  const ledger = ledgerFor({ attempt: 2 });
  const validCall = callFor({ item: "code", attempt: 2, findings: [] });
  const ignoredCalls = [
    { agentId: "a1", input: {} },
    { agentId: "a2", input: { pb_key: "not a key", findings: [{}] } },
    { agentId: "a3", input: { pb_key: 42, findings: [{}] } },
    { agentId: "a4" },
    callFor({ item: "tests", attempt: 1, findings: [] }),
    callFor({ stage: "code-tdd", item: "corpus-misalignment", attempt: 2, findings: [] }),
  ];

  const onlyIgnored = lensRound({ ledger, calls: ignoredCalls, spawns: [], contract });
  const withValid = lensRound({ ledger, calls: [...ignoredCalls, validCall], spawns: [], contract });

  assert.equal(onlyIgnored, undefined, "malformed, other-stage and other-attempt returns alone show no round");
  assert.notEqual(withValid, undefined, "a valid lens return for this stage and attempt shows the round with no lens spawn");
  assert.deepEqual(withValid.lenses.map((lens) => lens.name), [plainName("code")], "only the valid return adds a lens");
});

// scenario lens-states: each lens seen shows running, returned with its finding count, or uncovered
test("lens-running-when-spawned-without-return", () => {
  const spawns = [spawnFor({ item: "code" })];

  const round = lensRound({ ledger: ledgerFor(), calls: [], spawns, contract });

  assert.deepEqual(
    round.lenses.map((lens) => ({ name: lens.name, state: lens.state })),
    [{ name: plainName("code"), state: "running" }],
    "a lens with a spawn and no return is running, shown by its plain name",
  );
});
test("lens-returned-with-found-count", () => {
  const spawns = [spawnFor({ item: "code" }), spawnFor({ item: "tests" })];
  const calls = [callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "one" }, { where: "b.mjs:2", claim: "two" }, { where: "c.mjs:3", claim: "three" }] })];

  const round = lensRound({ ledger: ledgerFor(), calls, spawns, contract });

  assert.deepEqual(
    round.lenses.map((lens) => ({ name: lens.name, state: lens.state })),
    [
      { name: plainName("code"), state: "returned" },
      { name: plainName("tests"), state: "running" },
    ],
    "a lens that was spawned and returned appears once, returned, next to the still-running lens",
  );
  assert.equal(round.lenses[0].found, 3, "a returned lens reports found equal to its findings length");
});
test("lens-uncovered-on-return-without-findings", () => {
  const spawns = [spawnFor({ item: "code" })];
  const calls = [callFor({ item: "code" })];

  const round = lensRound({ ledger: ledgerFor(), calls, spawns, contract });

  assert.deepEqual(
    round.lenses.map((lens) => ({ name: lens.name, state: lens.state })),
    [{ name: plainName("code"), state: "uncovered" }],
    "a lens return with no findings array leaves the lens uncovered",
  );
});
test("lens-uncovered-when-spawn-finished-without-return", () => {
  const spawns = [spawnFor({ item: "code", finished: true })];

  const round = lensRound({ ledger: ledgerFor(), calls: [], spawns, contract });

  assert.deepEqual(
    round.lenses.map((lens) => ({ name: lens.name, state: lens.state })),
    [{ name: plainName("code"), state: "uncovered" }],
    "a lens spawn that finished with no return is uncovered",
  );
});
// scenario lens-states: no remaining tests

// scenario finding-verdicts: each finding joins its refuter verdict by finding id, no text parsing
test("findings-get-lens-position-ids-and-unchallenged", () => {
  const spawns = [spawnFor({ item: "code" }), spawnFor({ item: "tests" })];
  const calls = [
    callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "first code claim" }, { where: "b.mjs:2", claim: "second code claim" }] }),
    callFor({ item: "tests", findings: [{ where: "c.test.mjs:3", claim: "first tests claim" }] }),
  ];

  const round = lensRound({ ledger: ledgerFor(), calls, spawns, contract });

  assert.deepEqual(
    round.findings.map(({ id, lens, where, claim, verdict }) => ({ id, lens, where, claim, verdict })),
    [
      { id: "code-1", lens: plainName("code"), where: "a.mjs:1", claim: "first code claim", verdict: "unchallenged" },
      { id: "code-2", lens: plainName("code"), where: "b.mjs:2", claim: "second code claim", verdict: "unchallenged" },
      { id: "tests-1", lens: plainName("tests"), where: "c.test.mjs:3", claim: "first tests claim", verdict: "unchallenged" },
    ],
    "ids are <lens>-<n>, 1-based per lens, and findings with no refuter are unchallenged",
  );
});
test("refuter-survives-marks-stands", () => {
  const spawns = [spawnFor({ item: "code" })];
  const calls = [
    callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "first code claim" }, { where: "b.mjs:2", claim: "second code claim" }] }),
    callFor({ role: "refuter", item: "code-1", finding_id: "code-1", verdict: "survives" }),
  ];

  const round = lensRound({ ledger: ledgerFor(), calls, spawns, contract });

  assert.deepEqual(
    round.findings.map(({ id, verdict }) => ({ id, verdict })),
    [
      { id: "code-1", verdict: "stands" },
      { id: "code-2", verdict: "unchallenged" },
    ],
    "a 'survives' refuter return marks only its own finding as standing",
  );
});
test("refuter-refuted-marks-knocked-down", () => {
  const spawns = [spawnFor({ item: "code" })];
  const calls = [
    callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "first code claim" }, { where: "b.mjs:2", claim: "second code claim" }] }),
    callFor({ role: "refuter", item: "code-2", finding_id: "code-2", verdict: "refuted" }),
  ];

  const round = lensRound({ ledger: ledgerFor(), calls, spawns, contract });

  assert.deepEqual(
    round.findings.map(({ id, verdict }) => ({ id, verdict })),
    [
      { id: "code-1", verdict: "unchallenged" },
      { id: "code-2", verdict: "knocked-down" },
    ],
    "a 'refuted' refuter return marks only its own finding as knocked down",
  );
});
test("refuter-spawned-without-return-is-challenging", () => {
  const spawns = [spawnFor({ item: "code" }), spawnFor({ role: "refuter", item: "code-1" })];
  const calls = [callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "first code claim" }, { where: "b.mjs:2", claim: "second code claim" }] })];

  const round = lensRound({ ledger: ledgerFor(), calls, spawns, contract });

  assert.deepEqual(
    round.findings.map(({ id, verdict }) => ({ id, verdict })),
    [
      { id: "code-1", verdict: "challenging" },
      { id: "code-2", verdict: "unchallenged" },
    ],
    "a refuter spawned for a finding id with no return marks only that finding as challenging",
  );
});
test("refuter-return-with-mismatched-finding-id-not-counted", () => {
  const spawns = [spawnFor({ item: "code" })];
  const calls = [
    callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "first code claim" }, { where: "b.mjs:2", claim: "second code claim" }] }),
    callFor({ role: "refuter", item: "code-1", finding_id: "code-2", verdict: "refuted" }),
  ];

  const round = lensRound({ ledger: ledgerFor(), calls, spawns, contract });

  assert.deepEqual(
    round.findings.map(({ id, verdict }) => ({ id, verdict })),
    [
      { id: "code-1", verdict: "unchallenged" },
      { id: "code-2", verdict: "unchallenged" },
    ],
    "a refuter return whose finding_id differs from its key item counts for neither finding",
  );
});
test("counts-sum-verdicts", () => {
  const spawns = [spawnFor({ item: "code" }), spawnFor({ item: "tests" }), spawnFor({ role: "refuter", item: "code-3" })];
  const calls = [
    callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "one" }, { where: "b.mjs:2", claim: "two" }, { where: "c.mjs:3", claim: "three" }] }),
    callFor({ item: "tests", findings: [{ where: "a.test.mjs:1", claim: "four" }, { where: "b.test.mjs:2", claim: "five" }] }),
    callFor({ role: "refuter", item: "code-1", finding_id: "code-1", verdict: "survives" }),
    callFor({ role: "refuter", item: "code-2", finding_id: "code-2", verdict: "refuted" }),
    callFor({ role: "refuter", item: "tests-2", finding_id: "tests-2", verdict: "survives" }),
  ];

  const round = lensRound({ ledger: ledgerFor(), calls, spawns, contract });

  assert.deepEqual(
    round.counts,
    { found: 5, stands: 2, knockedDown: 1, challenging: 1, unchallenged: 1, fixed: 0, fixing: 0, fixUndone: 0 },
    "counts tally every finding across both lenses by its verdict, and stands, knockedDown, challenging, unchallenged, fixed, fixing and fixUndone sum to found",
  );
});

// scenario fix-outcomes: fixes per group and round show fixing, checking, kept or undone with a plain reason
test("fix-fixing-then-checking", () => {
  const lensSpawn = spawnFor({ item: "code" });
  const fixSpawn = spawnFor({ role: "fix", item: "g1", round: 2 });
  const checkerSpawn = spawnFor({ role: "course-checker", item: "g1", round: 2 });

  const fixing = lensRound({ ledger: ledgerFor(), calls: [], spawns: [lensSpawn, fixSpawn], contract });
  const checking = lensRound({ ledger: ledgerFor(), calls: [], spawns: [lensSpawn, fixSpawn, checkerSpawn], contract });

  assert.deepEqual(
    fixing.fixes.map(({ group, round, outcome }) => ({ group, round, outcome })),
    [{ group: "g1", round: 2, outcome: "fixing" }],
    "a fix spawn with no return is fixing",
  );
  assert.deepEqual(
    checking.fixes.map(({ group, round, outcome }) => ({ group, round, outcome })),
    [{ group: "g1", round: 2, outcome: "checking" }],
    "a course checker spawned for the fix with no return makes it checking",
  );
});
//   (remaining fix-outcomes tests below, not yet written)
test("fix-kept-on-better-verdict", () => {
  const spawns = [spawnFor({ item: "code" }), spawnFor({ role: "fix", item: "g1", round: 2 }), spawnFor({ role: "course-checker", item: "g1", round: 2 })];
  const fixesFor = (verdict, mistake, whatWentWrong) => {
    const checkerCall = callFor({ role: "course-checker", item: "g1", round: 2, finding_id: "code-1", verdict, mistake, what_went_wrong: whatWentWrong });
    return lensRound({ ledger: ledgerFor(), calls: [checkerCall], spawns, contract }).fixes.map(({ group, round, outcome, why }) => ({ group, round, outcome, why }));
  };

  const better = fixesFor("better", "none", "");
  const wrongDirection = fixesFor("wrong-direction", "missed-finding", "the fix left the reported finding in place");
  const brokeSomething = fixesFor("broke-something", "new-defect", "the fix introduced a failing edge case");

  assert.deepEqual(better, [{ group: "g1", round: 2, outcome: "kept", why: "the check said it is better" }], "a 'better' verdict keeps the fix");
  assert.deepEqual(wrongDirection, [{ group: "g1", round: 2, outcome: "undoing", why: "the check said it went the wrong way" }], "a 'wrong-direction' verdict starts undoing the fix");
  assert.deepEqual(brokeSomething, [{ group: "g1", round: 2, outcome: "undoing", why: "the check said it broke something" }], "a 'broke-something' verdict starts undoing the fix");
});
test("fix-kept-when-returned-and-later-group-exists", () => {
  const lensSpawn = spawnFor({ item: "code" });
  const fixReturn = (item, round) => callFor({ role: "fix", item, round, ambiguity: "none", commit_subject: "fix it", approach: "change the code", files_changed: ["a.mjs"] });
  const outcomesOf = (shown) => shown.fixes.map(({ group, round, outcome }) => ({ group, round, outcome }));

  const alone = lensRound({ ledger: ledgerFor(), calls: [fixReturn("g1", 2)], spawns: [lensSpawn], contract });
  const laterBySpawn = lensRound({ ledger: ledgerFor(), calls: [fixReturn("g1", 2)], spawns: [lensSpawn, spawnFor({ role: "fix", item: "g2", round: 3 })], contract });
  const laterByReturn = lensRound({ ledger: ledgerFor(), calls: [fixReturn("g1", 2), fixReturn("g2", 3)], spawns: [lensSpawn], contract });
  const sameRound = lensRound({ ledger: ledgerFor(), calls: [fixReturn("g1", 2)], spawns: [lensSpawn, spawnFor({ role: "fix", item: "g2", round: 2 })], contract });

  assert.deepEqual(outcomesOf(alone), [{ group: "g1", round: 2, outcome: "fixing" }], "a fix known only from its return, with no later fix, stays fixing");
  assert.deepEqual(
    outcomesOf(laterBySpawn),
    [{ group: "g1", round: 2, outcome: "kept" }, { group: "g2", round: 3, outcome: "fixing" }],
    "a returned fix with a later-round fix seen by spawn is kept, and the later fix with no return is fixing",
  );
  assert.deepEqual(
    outcomesOf(laterByReturn),
    [{ group: "g1", round: 2, outcome: "kept" }, { group: "g2", round: 3, outcome: "fixing" }],
    "fixes known only from returns are listed, the earlier one kept because a later fix was seen by return",
  );
  assert.deepEqual(
    outcomesOf(sameRound).find(({ group }) => group === "g1"),
    { group: "g1", round: 2, outcome: "fixing" },
    "another group in the same round is not a later fix",
  );
});
test("fix-undone-by-rollback-kinds", () => {
  const rollbackFor = ({ stage = REVIEW_STAGE, item, round, kind }) => ({ key: buildKey({ stage, role: "fix", item, round, attempt: 1 }), kind, ref: "refs/pb/x", sha: "abc123", base: "def456" });
  const rollbacks = [
    rollbackFor({ item: "g1", round: 2, kind: "red" }),
    rollbackFor({ item: "g2", round: 3, kind: "repeated" }),
    rollbackFor({ item: "g3", round: 4, kind: "commit" }),
    rollbackFor({ item: "g4", round: 5, kind: "artifact" }),
    rollbackFor({ item: "g5", round: 6, kind: "artifact" }),
    rollbackFor({ item: "g6", round: 7, kind: "red" }),
    rollbackFor({ stage: "code-tdd", item: "g9", round: 2, kind: "red" }),
  ];
  const spawns = [spawnFor({ item: "code" }), spawnFor({ role: "fix", item: "g3", round: 4 })];
  const calls = [callFor({ role: "course-checker", item: "g3", round: 4, finding_id: "code-1", verdict: "wrong-direction", mistake: "missed-finding", what_went_wrong: "left it in place" }),
    callFor({ role: "course-checker", item: "g5", round: 6, finding_id: "code-2", verdict: "broke-something", mistake: "missed-finding", what_went_wrong: "broke a neighbour" }),
    callFor({ role: "course-checker", item: "g6", round: 7, finding_id: "code-3", verdict: "better" }),
  ];

  const shown = lensRound({ ledger: ledgerFor({ rollbacks }), calls, spawns, contract });

  assert.deepEqual(
    shown.fixes.slice(0, 5).map(({ group, round, outcome, why }) => (why === undefined ? { group, round, outcome } : { group, round, outcome, why })),
    [
      { group: "g1", round: 2, outcome: "undone", why: "the tests went red" },
      { group: "g2", round: 3, outcome: "undone", why: "it repeated an approach already undone" },
      { group: "g3", round: 4, outcome: "undone", why: "the check said it went the wrong way" },
      { group: "g4", round: 5, outcome: "undone" },
      { group: "g5", round: 6, outcome: "undone", why: "the check said it broke something" },
    ],
    "a rollback alone lists its fix as undone, with the reason from its kind, or the checker verdict text; with neither it has no reason, so the pane never prints 'undone: undone'",
  );
  const redAfterBetter = shown.fixes.find(({ group }) => group === "g6");
  assert.deepEqual(
    { outcome: redAfterBetter.outcome, why: redAfterBetter.why },
    { outcome: "undone", why: "the tests went red" },
    "a rollback kind with its own reason beats the checker's 'better' text",
  );
  assert.equal(shown.undone, 6, "undone counts only this stage's rollbacks, not another stage's");
});
// scenario spend-against-caps: spend shows agents against the stage max and output tokens, never dollars
// scenario lens-lines: lensLines turns a round into plain, width-fitted pane lines
test("lines-truncate-and-fold-to-columns", () => {
  const longClaim = "the loop never stops when the queue is empty and the caller keeps waiting for more work";
  const findings = [
    { where: "a.mjs:1", claim: longClaim },
    { where: "b.mjs:2", claim: "second claim" },
    { where: "c.mjs:3", claim: "third claim" },
    { where: "d.mjs:4", claim: "fourth claim" },
    { where: "e.mjs:5", claim: "fifth claim" },
  ];
  const spawns = [spawnFor({ item: "code" }), spawnFor({ role: "refuter", item: "code-3" })];
  const calls = [
    callFor({ item: "code", findings }),
    callFor({ role: "refuter", item: "code-1", finding_id: "code-1", verdict: "survives" }),
    callFor({ role: "refuter", item: "code-2", finding_id: "code-2", verdict: "refuted" }),
  ];
  const round = lensRound({ ledger: ledgerFor(), calls, spawns, contract });

  const wide = lensLines(round, 200);
  const narrow = lensLines(round, 60);
  const uncut = lensLines(round, 0);

  const findingStart = wide.findIndex(({ text }) => text.startsWith("  to fix · "));
  assert.notEqual(findingStart, -1, "the finding lines are shown");
  assert.deepEqual(
    wide.slice(findingStart, findingStart + 4),
    [
      { text: `  to fix · ${longClaim} · a.mjs:1` },
      { text: "  not a real problem · second claim · b.mjs:2" },
      { text: "  checking · third claim · c.mjs:3" },
      { text: "  + 2 more", tone: "dim" },
    ],
    "only the first 3 findings show, each as what happens to it, the point, then where, then a dim '+ n more' for the rest",
  );
  assert.equal(narrow.every(({ text }) => text.length <= 60), true, "at 60 columns no line is longer than 60");
  const cut = narrow.filter(({ text }) => text.endsWith("…"));
  assert.deepEqual(
    cut.map(({ text }) => text),
    [`  to fix · ${longClaim} · a.mjs:1`.slice(0, 59) + "…"],
    "a finding too long for the width stays one line, cut to 60 characters ending with an ellipsis, and short lines are left whole",
  );
  assert.deepEqual(uncut, wide, "columns 0 cuts nothing");
  const findingsAt = narrow.findIndex(({ text }) => text.includes(" issues found"));
  assert.notEqual(findingsAt, -1, "the issues summary is shown");
  assert.deepEqual(
    narrow.slice(findingsAt, findingsAt + 2),
    [{ text: "5 issues found · 3 to fix · 1 checking" }, { text: "  1 not a real problem" }],
    "the summary says what happens to the issues (those not challenged and the upheld one are to fix), folded to the width",
  );
});
test("finding-line-names-a-run-file-without-the-run-folder", () => {
  const calls = [callFor({ item: "code", findings: [{ where: ".pairingbuddy/run/pr-body.md (Verification section, lines 13-15)", claim: "The Verification section reports a check that did not run" }] })];
  const round = lensRound({ ledger: ledgerFor(), calls, spawns: [spawnFor({ item: "code" })], contract });

  const lines = lensLines(round, 200);

  assert.ok(
    lines.some(({ text }) => text === "  to fix · The Verification section reports a check that did not run · pr-body.md (Verification section, lines 13-15)"),
    `a run file is named without .pairingbuddy/run/, since it is not the user's code: ${JSON.stringify(lines)}`,
  );
});
test("lines-contain-no-internal-ids", () => {
  const agentConfig = readFileSync(new URL("../../contracts/agent-config.yaml", import.meta.url), "utf8");
  const agentsBlock = agentConfig.split(/^agents:\s*$/m)[1].split(/^\S/m)[0];
  const agentIds = [...agentsBlock.matchAll(/^ {2}([a-z][a-z-]*):\s*$/gm)].map((match) => match[1]);
  assert.ok(agentIds.includes("identify-test-issues"), "the scrape found a known agent id");
  assert.ok(agentIds.length >= 30, `the scrape found the agents (found ${agentIds.length})`);
  const rollbacks = [{ key: buildKey({ stage: REVIEW_STAGE, role: "fix", item: "g1", round: 2, attempt: 1 }), kind: "red", ref: "refs/pb/x", sha: "abc123", base: "def456" }];
  const fixReturn = (item, round) => callFor({ role: "fix", item, round, ambiguity: "none", commit_subject: "fix it", approach: "change the code", files_changed: ["a.mjs"] });
  const spawns = [
    spawnFor({ item: "code" }),
    spawnFor({ item: "made-up-lens" }),
    spawnFor({ item: "corpus-misalignment", finished: true }),
    spawnFor({ role: "refuter", item: "code-3" }),
    spawnFor({ role: "fix", item: "g3", round: 4 }),
    spawnFor({ role: "course-checker", item: "g3", round: 4 }),
    spawnFor({ role: "runner", item: "run" }),
  ];
  const calls = [
    callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "first" }, { where: "b.mjs:2", claim: "second" }, { where: "c.mjs:3", claim: "third" }] }),
    callFor({ item: "made-up-lens", findings: [{ where: "d.mjs:4", claim: "fourth" }] }),
    callFor({ role: "refuter", item: "code-1", finding_id: "code-1", verdict: "survives" }),
    callFor({ role: "refuter", item: "code-2", finding_id: "code-2", verdict: "refuted" }),
    fixReturn("g1", 2),
    fixReturn("g2", 3),
    callFor({ role: "course-checker", item: "g2", round: 3, finding_id: "code-1", verdict: "better" }),
  ];
  const round = lensRound({ ledger: ledgerFor({ rollbacks, stop: attemptCapStop() }), calls, spawns, contract });
  const gateIds = Object.values(contract.taskTypes).flatMap((type) => Object.keys(type.gates ?? {}));
  const forbidden = [
    new RegExp(REVIEW_STAGE),
    /\bG:[a-z-]+/,
    ...gateIds.map((gate) => new RegExp(gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
    /\b(refuter|course-checker|runner|synthesizer)\b/,
    /[:/|]lens\b|\blens[:/|]/,
    ...agentIds.filter((id) => id.includes("-")).map((id) => new RegExp(`\\b${id}\\b`)),
    /\bg\d+\b/,
    /\b[a-z]+(-[a-z]+)*-\d+\b/,
    /corpus-misalignment/,
    /undefined/,
    /null/,
  ];

  const lines = lensLines(round, 200);

  assert.ok(lines.length > 0, "the round produces lines");
  for (const { text } of lines) {
    for (const pattern of forbidden) {
      assert.equal(pattern.test(text), false, `line "${text}" must not match ${pattern}`);
    }
  }
  assert.ok(lines.some(({ text }) => text.startsWith("  fixed")) && lines.some(({ text }) => text.startsWith("  not a real problem")), "the refuter- and fix-driven finding states render");
  assert.ok(lines.some(({ text }) => text.includes("made up lens")), "a lens with no plain name shows its raw name with spaces");
});
test("spawns-before-stage-start-not-shown", () => {
  const startedAt = "2026-01-01T10:00:00.000Z";
  const before = "2026-01-01T09:59:59.000Z";
  const after = "2026-01-01T10:00:01.000Z";
  const spawns = [
    spawnFor({ item: "tests", startedAt: before }),
    spawnFor({ item: "code", startedAt: after }),
    spawnFor({ item: "docs", startedAt }),
    spawnFor({ item: "notes" }),
    spawnFor({ role: "refuter", item: "code-1", startedAt: before }),
    spawnFor({ role: "fix", item: "g1", round: 2, startedAt: before }),
    spawnFor({ role: "fix", item: "g2", round: 3, startedAt: after }),
  ];
  const calls = [callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "first" }] })];

  const round = lensRound({ ledger: ledgerFor({ startedAt }), calls, spawns, contract });

  assert.deepEqual(
    round.lenses.map(({ name }) => name),
    ["the code", "docs", "notes"],
    "a lens spawned before the stage started is not shown; one spawned exactly at the start, after it, or with no startedAt, is",
  );
  assert.equal(round.findings[0].verdict, "unchallenged", "a refuter spawned before the stage started does not make the finding challenging");
  assert.deepEqual(
    round.fixes.map(({ group }) => group),
    ["g2"],
    "a fix spawned before the stage started is not shown",
  );
});
test("spawns-compare-as-instants-not-text", () => {
  const startedAt = "2026-01-01T10:00:00Z";
  const spawns = [spawnFor({ item: "code", startedAt: "2026-01-01T10:00:00.500Z" })];

  const round = lensRound({ ledger: ledgerFor({ startedAt }), calls: [], spawns, contract });

  assert.deepEqual(
    round?.lenses.map(({ name }) => name),
    ["the code"],
    "a spawn half a second after a start written with no fraction counts as after the start",
  );
});
test("odd-lens-returns-never-throw", () => {
  const findings = [null, { claim: "only a claim" }, "a string", 7, { where: "b.mjs:2" }];
  const calls = [
    callFor({ item: "code", findings }),
    callFor({ item: "bad_item", findings: [{ where: "c.mjs:3", claim: "dropped" }] }),
  ];

  const round = lensRound({ ledger: ledgerFor(), calls, spawns: [], contract });
  const lines = lensLines(round, 200);

  assert.deepEqual(
    round.findings.map(({ id }) => id),
    ["code-2", "code-5"],
    "null, string and number entries are skipped, the ids stay by position in the lens's findings array, and a return whose item cannot form a finding id adds none",
  );
  assert.deepEqual(
    round.lenses.map(({ found }) => found),
    [2, 0],
    "each lens's found equals the findings it shows: 2 for the code lens, 0 for the one that shows none",
  );
  assert.ok(lines.some(({ text }) => text.startsWith("the code 2 · ")), "the lenses line reads the code lens with 2");
  assert.deepEqual(
    round.findings.map(({ where, claim }) => ({ where, claim })),
    [{ where: undefined, claim: "only a claim" }, { where: "b.mjs:2", claim: undefined }],
    "the findings with a part missing still show the part they have",
  );
  assert.ok(lines.some(({ text }) => text === "  to fix · only a claim"), "a finding no refuter challenged is to fix, and with no where its line leaves the where out");
  assert.ok(lines.some(({ text }) => text === "  to fix · b.mjs:2"), "a finding with no claim leaves the claim out of its line");
});

// scenario lens-round-visibility: a lens return the mod saw before the stage started belongs to an earlier run
test("calls-before-stage-start-not-shown", () => {
  const ledger = ledgerFor({ startedAt: "2026-11-04T08:19:00.000Z" });
  const seenAt = (call, at) => ({ ...call, at });
  const earlier = seenAt(callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "old" }] }), "2026-11-04T08:18:00.000Z");
  const atStart = seenAt(callFor({ item: "tests", findings: [] }), "2026-11-04T08:19:00.000Z");
  const later = seenAt(callFor({ item: "types", findings: [] }), "2026-11-04T08:21:00.000Z");
  const undated = callFor({ item: "docs", findings: [] });

  const onlyEarlier = lensRound({ ledger, calls: [earlier], spawns: [], contract });
  const mixed = lensRound({ ledger, calls: [earlier, atStart, later, undated], spawns: [], contract });

  assert.equal(onlyEarlier, undefined, "a return from before the stage start shows no round");
  assert.deepEqual(
    mixed.lenses.map((lens) => lens.name).sort(),
    [plainName("tests"), "types", "docs"].sort(),
    "returns at or after the start, and returns with no time, count; the earlier one does not",
  );
  assert.equal(mixed.counts.found, 0, "the earlier return's finding is not counted");
});

// scenario lens-round-robustness: a partial ledger never throws
test("partial-ledgers-never-throw", () => {
  const lensCall = callFor({ item: "code", findings: [] });
  const noStage = { v: 1, stages: [], fixes: { rollbacks: [] }, stop: null };
  const emptyStageStopped = { v: 1, stage: {}, stages: [], fixes: { rollbacks: [] }, stop: attemptCapStop() };
  const stagesNotArray = { ...ledgerFor(), stages: "none" };
  const rollbacksNotArray = { ...ledgerFor(), fixes: { rollbacks: "none" } };
  const rollbacksWithNull = { ...ledgerFor(), fixes: { rollbacks: [null] } };
  const tokensNotNumber = ledgerFor({ stages: [{ name: REVIEW_STAGE, attempt: 1, spend: { tokens: "many", tokensKnown: true } }] });
  const spawns = [spawnFor({ item: "code" })];
  const ledgers = { noStage, emptyStageStopped, stagesNotArray, rollbacksNotArray, rollbacksWithNull, tokensNotNumber };

  for (const [name, ledger] of Object.entries(ledgers)) {
    assert.doesNotThrow(() => lensLines(lensRound({ ledger, calls: [lensCall], spawns, contract })), `${name}: lensRound and lensLines never throw`);
  }

  assert.equal(lensRound({ ledger: noStage, calls: [lensCall], spawns, contract }), undefined, "no stage shows no round");
  assert.deepEqual(lensLines(lensRound({ ledger: noStage, calls: [lensCall], spawns, contract })), [], "no round gives no lines");
  assert.doesNotThrow(() => lensRound({ ledger: emptyStageStopped, calls: [], spawns: [], contract }), "an empty stage with an attempt-cap stop does not throw");
  assert.notEqual(lensRound({ ledger: stagesNotArray, calls: [], spawns, contract }), undefined, "stages that is not an array still shows the round");
  assert.equal(lensRound({ ledger: rollbacksNotArray, calls: [], spawns, contract }).undone, 0, "rollbacks that is not an array counts none");
  assert.equal(lensRound({ ledger: rollbacksWithNull, calls: [], spawns, contract }).undone, 0, "a null rollback is skipped");
});

// Late safeguards: edge behaviours that pin the fold and the lines against small changes.
const rollbackAt = ({ item, round, kind, attempt = 1 }) => ({ key: buildKey({ stage: REVIEW_STAGE, role: "fix", item, round, attempt }), kind, ref: "refs/pb/x", sha: "abc123", base: "def456" });
const checkerCall = ({ item, round, verdict }) => callFor({ role: "course-checker", item, round, finding_id: "code-1", verdict });
const fixSpawn = (item, round) => spawnFor({ role: "fix", item, round });
const shownFixes = (round) => round.fixes.map(({ group, round: at, outcome, why }) => ({ group, round: at, outcome, why }));

test("lens-fold-ignores-odd-input-and-other-stop-codes", () => {
  const startedAt = "2026-01-01T10:00:00.000Z";
  const stepFailed = { reason: "step-failed: a step failed", seq: 3, code: "step-failed" };

  const nonArray = lensRound({ ledger: ledgerFor(), calls: [callFor({ item: "code", findings: "oops" })], spawns: [], contract });
  const unknownVerdict = lensRound({
    ledger: ledgerFor(),
    calls: [callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "one" }] }), callFor({ role: "refuter", item: "code-1", finding_id: "code-1", verdict: "maybe" })],
    spawns: [spawnFor({ role: "refuter", item: "code-1" })],
    contract,
  });
  const nullStart = lensRound({ ledger: ledgerFor({ startedAt: null }), calls: [], spawns: [spawnFor({ item: "code", startedAt })], contract });
  const nullStage = lensRound({ ledger: { stage: null }, calls: [], spawns: [spawnFor({ item: "code" })], contract });
  const otherStop = lensRound({ ledger: ledgerFor({ stop: stepFailed }), calls: [], spawns: [spawnFor({ item: "code" })], contract });
  const otherStopOnly = lensRound({ ledger: ledgerFor({ stop: stepFailed }), calls: [], spawns: [], contract });

  assert.deepEqual(nonArray.lenses, [{ name: plainName("code"), state: "uncovered" }], "a lens whose findings are not an array is uncovered, and does not throw");
  assert.equal(unknownVerdict.findings[0].verdict, "challenging", "an unknown refuter verdict leaves the finding being challenged while a refuter is spawned");
  assert.deepEqual(nullStart.lenses.map(({ name }) => name), [plainName("code")], "a ledger stage with no start time still counts a spawn that has one");
  assert.equal(nullStage, undefined, "a ledger whose stage is null shows no round and does not throw");
  assert.equal(otherStop.stopped, false, "a stop with another code is not the attempt cap");
  assert.equal(otherStopOnly, undefined, "a stop with another code does not show a round with nothing else seen");
});

test("fix-outcomes-pick-the-right-fix-and-reason", () => {
  const artifactBetter = lensRound({ ledger: ledgerFor({ rollbacks: [rollbackAt({ item: "g1", round: 2, kind: "artifact" })] }), calls: [checkerCall({ item: "g1", round: 2, verdict: "better" })], spawns: [spawnFor({ item: "code" })], contract });
  const redWrong = lensRound({ ledger: ledgerFor({ rollbacks: [rollbackAt({ item: "g1", round: 2, kind: "red" })] }), calls: [checkerCall({ item: "g1", round: 2, verdict: "wrong-direction" })], spawns: [spawnFor({ item: "code" })], contract });
  const twoGroups = lensRound({ ledger: ledgerFor(), calls: [checkerCall({ item: "g1", round: 2, verdict: "better" })], spawns: [spawnFor({ item: "code" }), fixSpawn("g1", 2), fixSpawn("g2", 2)], contract });
  const unknownCheck = lensRound({ ledger: ledgerFor(), calls: [checkerCall({ item: "g1", round: 2, verdict: "unsure" })], spawns: [spawnFor({ item: "code" }), fixSpawn("g1", 2), spawnFor({ role: "course-checker", item: "g1", round: 2 })], contract });
  const neverReturned = lensRound({ ledger: ledgerFor(), calls: [], spawns: [spawnFor({ item: "code" }), fixSpawn("g1", 2), fixSpawn("g2", 3)], contract });

  assert.deepEqual(shownFixes(artifactBetter), [{ group: "g1", round: 2, outcome: "undone", why: undefined }], "a rollback kind with no reason and a 'better' check gives no reason");
  assert.deepEqual(shownFixes(redWrong), [{ group: "g1", round: 2, outcome: "undone", why: "the tests went red" }], "a red rollback keeps its own reason over the checker's");
  assert.deepEqual(shownFixes(twoGroups), [{ group: "g1", round: 2, outcome: "kept", why: "the check said it is better" }, { group: "g2", round: 2, outcome: "fixing", why: undefined }], "a verdict for one group does not decide another group in the same round");
  assert.deepEqual(shownFixes(unknownCheck), [{ group: "g1", round: 2, outcome: "checking", why: undefined }], "an unknown checker verdict with a checker spawned leaves the fix being checked");
  assert.deepEqual(shownFixes(neverReturned), [{ group: "g1", round: 2, outcome: "fixing", why: undefined }, { group: "g2", round: 3, outcome: "fixing", why: undefined }], "a fix that never returned stays fixing even when a later round exists");
});

test("rollback-from-an-earlier-attempt-counts-as-undone-only", () => {
  const ledger = ledgerFor({ attempt: 2, rollbacks: [rollbackAt({ item: "g1", round: 2, kind: "red", attempt: 1 })] });
  const spawns = [spawnFor({ item: "code" }), fixSpawn("g1", 2)];

  const round = lensRound({ ledger, calls: [], spawns, contract });

  assert.deepEqual(shownFixes(round), [{ group: "g1", round: 2, outcome: "fixing", why: undefined }], "a rollback of an earlier attempt does not undo this attempt's fix");
  assert.equal(round.undone, 1, "the stage's rollbacks are still counted");

  const rollbackOnly = lensRound({ ledger, calls: [], spawns: [spawnFor({ item: "code" })], contract });
  assert.deepEqual(rollbackOnly.fixes, [], "a rollback from an earlier attempt adds no fix to this attempt");
});

test("lines-word-short-lists", () => {
  const threeFindings = [{ where: "a.mjs:1", claim: "one" }, { where: "b.mjs:2", claim: "two" }, { where: "c.mjs:3", claim: "three" }];
  const three = lensRound({ ledger: ledgerFor(), calls: [callFor({ item: "code", findings: threeFindings })], spawns: [], contract });
  const bothUncovered = lensRound({ ledger: ledgerFor(), calls: [], spawns: [spawnFor({ item: "code", finished: true }), spawnFor({ item: "tests", finished: true })], contract });
  const emptyReturn = lensRound({ ledger: ledgerFor(), calls: [callFor({ item: "code", findings: [] })], spawns: [], contract });

  const texts = (round) => lensLines(round, 200).map(({ text }) => text);

  assert.equal(texts(three).some((text) => text.includes("more")), false, "exactly 3 findings show no '+ n more' line");
  assert.equal(texts(three).filter((text) => text.startsWith("  ") && text.includes(".mjs")).length, 3, "all 3 findings are shown");
  assert.equal(texts(bothUncovered)[0], "the code not covered · the tests not covered", "each uncovered lens says so on the lens line");
  assert.deepEqual(texts(emptyReturn), ["the code 0", "no issues found"], "a lens that returned no findings shows a count of 0 and no finding lines");
});

test("lines-fit-exactly-at-the-column-edge", () => {
  const twoLenses = lensRound({ ledger: ledgerFor(), calls: [callFor({ item: "code", findings: [] }), callFor({ item: "tests", findings: [] })], spawns: [], contract });
  const findings = [{ where: "a.mjs:1", claim: "one" }, { where: "b.mjs:2", claim: "two" }];
  const calls = [
    callFor({ item: "code", findings }),
    callFor({ role: "refuter", item: "code-1", finding_id: "code-1", verdict: "survives" }),
    callFor({ role: "refuter", item: "code-2", finding_id: "code-2", verdict: "refuted" }),
  ];
  const summaryRound = lensRound({ ledger: ledgerFor(), calls, spawns: [], contract });

  const lensEdge = lensLines(twoLenses, 13).slice(0, 2);
  const summaryEdge = lensLines(summaryRound, 25);
  const summaryAt = summaryEdge.findIndex(({ text }) => text.includes(" issues found"));

  assert.deepEqual(lensEdge.map(({ text }) => text), ["the code 0", "  the tests 0"], "a continuation row exactly as long as the columns is not cut");
  assert.deepEqual(
    summaryEdge.slice(summaryAt, summaryAt + 2).map(({ text }) => text),
    ["2 issues found · 1 to fix", "  1 not a real problem"],
    "a join that lands exactly on the columns stays on one row",
  );
});

test("findings-say-fixed-when-a-kept-fix-answered-their-lens", () => {
  const calls = [
    callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "first code claim" }, { where: "b.mjs:2", claim: "second code claim" }] }),
    callFor({ role: "refuter", item: "code-2", finding_id: "code-2", verdict: "refuted" }),
    callFor({ role: "fix", item: "g1", round: 2, ambiguity: "none", commit_subject: "fix it", approach: "change the code", files_changed: ["a.mjs"] }),
    callFor({ role: "course-checker", item: "g1", round: 2, finding_id: "code-1", verdict: "better" }),
  ];
  const round = lensRound({ ledger: ledgerFor(), calls, spawns: [spawnFor({ item: "code" })], contract });

  const lines = lensLines(round, 200).map(({ text }) => text);

  assert.ok(lines.includes("2 issues found · 1 fixed · 1 not a real problem"), `the summary counts the fixed issue: ${JSON.stringify(lines)}`);
  assert.ok(lines.includes("  fixed · first code claim · a.mjs:1"), "the issue whose lens a kept fix answered reads fixed");
  assert.ok(lines.includes("  not a real problem · second code claim · b.mjs:2"), "a refuted issue is not a real problem, never fixed");
});

test("findings-say-fix-undone-when-their-lens-fix-was-rolled-back", () => {
  const calls = [
    callFor({ item: "tests", findings: [{ where: "c.test.mjs:3", claim: "the test checks nothing" }] }),
    callFor({ role: "fix", item: "g1", round: 2, ambiguity: "none", commit_subject: "fix it", approach: "change the test", files_changed: ["c.test.mjs"] }),
    callFor({ role: "course-checker", item: "g1", round: 2, finding_id: "tests-1", verdict: "wrong-direction" }),
  ];
  const ledger = ledgerFor({ rollbacks: [rollbackAt({ item: "g1", round: 2, kind: "course" })] });
  const round = lensRound({ ledger, calls, spawns: [spawnFor({ item: "tests" })], contract });

  const lines = lensLines(round, 200).map(({ text }) => text);

  assert.ok(lines.includes("  to fix · the test checks nothing · c.test.mjs:3"), `the issue whose fix was undone is to fix again: ${JSON.stringify(lines)}`);
  assert.ok(lines.includes("1 issue found · 1 to fix"), "an issue whose fix was undone counts as to fix");
});

// scenario finding-words: each finding and the summary read checking, to fix, fixing, fixed, not a real problem or left as is
test("findings-read-checking-to-fix-and-not-a-real-problem", () => {
  const spawns = [spawnFor({ item: "code" }), spawnFor({ role: "refuter", item: "code-3" })];
  const calls = [
    callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "one" }, { where: "b.mjs:2", claim: "two" }, { where: "c.mjs:3", claim: "three" }, { where: "d.mjs:4", claim: "four" }] }),
    callFor({ role: "refuter", item: "code-1", finding_id: "code-1", verdict: "survives" }),
    callFor({ role: "refuter", item: "code-2", finding_id: "code-2", verdict: "refuted" }),
  ];
  const round = lensRound({ ledger: ledgerFor(), calls, spawns, contract });

  const lines = lensLines(round, 200).map(({ text }) => text);

  assert.ok(lines.includes("4 issues found · 2 to fix · 1 checking · 1 not a real problem"), `the summary counts the plain words: ${JSON.stringify(lines)}`);
  assert.ok(lines.includes("  to fix · one · a.mjs:1"), "an upheld finding with no fix tried reads 'to fix'");
  assert.ok(lines.includes("  not a real problem · two · b.mjs:2"), "a knocked-down finding reads 'not a real problem'");
  assert.ok(lines.includes("  checking · three · c.mjs:3"), "a finding a refuter is on reads 'checking'");
});

test("findings-still-open-when-the-round-ended-read-left-as-is", () => {
  const calls = [
    callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "one" }, { where: "b.mjs:2", claim: "two" }] }),
    callFor({ role: "refuter", item: "code-2", finding_id: "code-2", verdict: "refuted" }),
  ];
  const round = lensRound({ ledger: ledgerFor({ status: "done" }), calls, spawns: [spawnFor({ item: "code" })], contract });

  const lines = lensLines(round, 200).map(({ text }) => text);

  assert.ok(lines.includes("2 issues found · 1 left as is · 1 not a real problem"), `the summary counts the open finding as left as is: ${JSON.stringify(lines)}`);
  assert.ok(lines.includes("  left as is · one · a.mjs:1"), "a finding still open when the stage is no longer active reads 'left as is'");
});

test("findings-still-open-when-the-run-ended-read-left-as-is-though-the-last-ledger-was-active", () => {
  const calls = [callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "one" }] })];
  const round = lensRound({ ledger: ledgerFor(), calls, spawns: [spawnFor({ item: "code" })], ended: true });

  assert.deepEqual(round.findings.map(({ word }) => word), ["left as is"], "an ended run's last snapshot still says active, yet its round is over");
});

test("findings-whose-fix-group-is-being-fixed-read-fixing", () => {
  const spawns = [spawnFor({ item: "code" }), spawnFor({ item: "tests" }), spawnFor({ role: "fix", item: "g2", round: 3 })];
  const calls = [
    callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "one" }] }),
    callFor({ item: "tests", findings: [{ where: "a.test.mjs:1", claim: "two" }] }),
    callFor({ role: "fix", item: "g1", round: 2, ambiguity: "none", commit_subject: "fix it", approach: "change the code", files_changed: ["a.mjs"] }),
    callFor({ role: "course-checker", item: "g1", round: 2, finding_id: "code-1", verdict: "better" }),
  ];
  const round = lensRound({ ledger: ledgerFor(), calls, spawns, contract });

  const lines = lensLines(round, 200).map(({ text }) => text);

  assert.ok(lines.includes("2 issues found · 1 fixed · 1 fixing"), `the summary counts the finding being fixed: ${JSON.stringify(lines)}`);
  assert.ok(lines.includes("  fixing · two · a.test.mjs:1"), "the second lens's findings are fix group g2, and its fix has no return yet");
});

// scenario quick-review: a cycle's light review is one lens on a test; it reads by a plain lens name, never the test's
test("a-cycle-light-review-reads-quick-review-for-the-latest-test-only", () => {
  const stage = "code-tdd";
  const reviewOf = (item) => ({ kind: "workflow_agent", name: buildLabel({ stage, phase: "REFACTOR", role: "lens", item, round: 1 }) });
  const spawns = [reviewOf("order-total-sums-line-totals"), reviewOf("empty-order-totals-zero")];
  const calls = [
    callFor({ stage, item: "order-total-sums-line-totals", findings: [{ where: "a.mjs:1", claim: "old", focus: "code-smell" }] }),
    callFor({ stage, item: "empty-order-totals-zero", findings: [{ where: "b.mjs:2", claim: "new", focus: "code-smell" }] }),
  ];
  const round = lensRound({ ledger: ledgerFor({ stage }), calls, spawns, contract });

  const lines = lensLines(round, 200).map(({ text }) => text);

  assert.deepEqual(round.lenses.map(({ name, found }) => ({ name, found })), [{ name: plainName("light-review"), found: 1 }], "only the latest test's review shows, under the light review's plain name");
  assert.equal(plainName("light-review"), "quick review", "the light review's plain name");
  assert.equal(lines.some((text) => text.includes("order total") || text.includes("empty order")), false, `no line names a test: ${JSON.stringify(lines)}`);
  assert.deepEqual(round.findings.map(({ claim }) => claim), ["new"], "only the latest test's findings show");
});

test("a-quick-review-finding-reads-fixing-then-fixed-by-its-sides-fixer-and-left-as-is-once-the-next-test-starts", () => {
  const stage = "code-tdd";
  const label = (role, item, phase = "REFACTOR") => buildLabel({ stage, phase, role, item, round: 1 });
  const spawn = (role, item, rest = {}) => ({ kind: "workflow_agent", name: label(role, item, rest.phase), ...rest });
  const calls = [callFor({ stage, item: "t1", findings: [{ where: "a.test.mjs:1", claim: "weak assert", focus: "test-quality" }, { where: "a.mjs:1", claim: "long function", focus: "code-smell" }, { where: "b.mjs:1", claim: "odd name", focus: "naming-and-domain" }] })];
  const fixing = [spawn("lens", "t1", { finished: true }), spawn("refactor-tests", "t1", { finished: true }), spawn("refactor-code", "t1")];
  const movedOn = [...fixing, spawn("implement-tests", "t2", { phase: "RED" })];

  const wordsOf = (spawns) => lensRound({ ledger: ledgerFor({ stage }), calls, spawns, contract }).findings.map(({ claim, word }) => `${word} · ${claim}`);

  assert.deepEqual(wordsOf(fixing), ["fixed · weak assert", "fixing · long function", "fixing · odd name"], "a test finding goes to the tests fixer and a code finding to the code fixer; a finished fixer fixed it");
  assert.deepEqual(wordsOf(movedOn), ["fixed · weak assert", "left as is · long function", "left as is · odd name"], "once the next test starts, the cycle's review has ended");
});

// scenario review-row: the REVIEW row is one line of lenses with their counts, one summary line, then one line per finding
test("review-lines-are-the-lenses-the-summary-and-the-findings-only", () => {
  const rollbacks = [rollbackAt({ item: "g1", round: 2, kind: "red" })];
  const spawns = [spawnFor({ item: "code" }), spawnFor({ item: "tests" }), spawnFor({ item: "necessity" }), spawnFor({ item: "corpus-misalignment", finished: true }), spawnFor({ role: "fix", item: "g1", round: 3 })];
  const calls = [
    callFor({ item: "code", findings: [{ where: "a.mjs:1", claim: "one" }] }),
    callFor({ item: "tests", findings: [] }),
  ];
  const round = lensRound({ ledger: ledgerFor({ rollbacks, stop: attemptCapStop() }), calls, spawns, contract });
  const quiet = lensRound({ ledger: ledgerFor(), calls: [callFor({ item: "code", findings: [] })], spawns: [spawnFor({ item: "code" })], contract });

  assert.deepEqual(
    lensLines(round, 200),
    [
      { text: "the code 1 · the tests 0 · needed or not … · docs and plan not covered", tone: "warning" },
      { text: "1 issue found · 1 fixing" },
      { text: "  fixing · one · a.mjs:1", whole: true },
    ].map(({ whole, ...line }) => line),
    "no header, fixes block, stopped line or agent count: a running lens reads '…', an uncovered one 'not covered' and puts the line in warning tone",
  );
  assert.deepEqual(lensLines(quiet, 200), [{ text: "the code 0" }, { text: "no issues found" }], "a round with no findings says so");
});
