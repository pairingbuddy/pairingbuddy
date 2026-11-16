// Scenario report-joins-the-runs-of-a-task: the report's runs are the kept runs of the unit the reported run belongs to,
// oldest first, so a code run and the publish run after it read as one task.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { endedTaskFacts, taskCommitShas, taskRuns } from "../../shared-node/task-runs.mjs";

const UNIT = "feat/order-total abc";
const ledgerOf = (runId, kind, startedAt, commits = []) => ({ runId, kind, stage: { name: "s", status: "done", startedAt }, stages: [{ name: "s", status: "done", startedAt }], commits });
const keptRun = (runId, kind, startedAt, unit = UNIT, extra = {}) => ({ ledger: ledgerOf(runId, kind, startedAt), unit, endedAt: startedAt.replace(":00.", ":59."), calls: [], ...extra });

const CODE = keptRun("code-run", "code", "2026-11-16T10:00:00.000Z");
const PUBLISH = keptRun("publish-run", "publish", "2026-11-16T10:09:00.000Z", UNIT, { prUrl: "https://github.com/o/r/pull/7" });
const OTHER = keptRun("other-run", "code", "2026-11-15T09:00:00.000Z", "fix/other def");

describe("report-joins-the-runs-of-a-task", () => {
  test("an ended publish run joins the kept code run of its unit, oldest first", () => {
    const runs = taskRuns({ ledger: PUBLISH.ledger, kept: [PUBLISH, OTHER, CODE] });

    assert.deepEqual(runs.map((run) => run.ledger.runId), ["code-run", "publish-run"]);
    assert.equal(runs[1].prUrl, "https://github.com/o/r/pull/7", "the kept run brings what pb kept with it");
  });

  test("a live publish run, not kept yet, joins its unit's code run by the unit the pane sees open", () => {
    const live = ledgerOf("publish-run", "publish", "2026-11-16T10:09:00.000Z");
    const calls = [{ input: { pb_key: "pr-draft.lens.claims.r1.a1", findings: [] } }];

    const runs = taskRuns({ ledger: live, kept: [CODE, OTHER], unitKey: UNIT, calls });

    assert.deepEqual(runs.map((run) => run.ledger.runId), ["code-run", "publish-run"]);
    assert.equal(runs[1].calls, calls, "the live run's returns are the session's");
  });

  test("with no ledger left to poll, the newest kept run is the one reported", () => {
    const runs = taskRuns({ ledger: undefined, kept: [CODE, OTHER, PUBLISH] });

    assert.deepEqual(runs.map((run) => run.ledger.runId), ["code-run", "publish-run"]);
  });

  test("a run that names no unit is reported alone", () => {
    const loose = keptRun("loose-run", "code", "2026-11-16T11:00:00.000Z", null);

    assert.deepEqual(taskRuns({ ledger: loose.ledger, kept: [loose, keptRun("other-loose", "code", "2026-11-16T12:00:00.000Z", null)] }).map((run) => run.ledger.runId), ["loose-run"]);
  });

  test("the task's commits are every run's, in run order, each once", () => {
    const runs = [{ ledger: ledgerOf("a", "code", "2026-11-16T10:00:00.000Z", ["s1", "s2"]) }, { ledger: ledgerOf("b", "code", "2026-11-16T10:05:00.000Z", ["s2", "s3"]) }];

    assert.deepEqual(taskCommitShas(runs), ["s1", "s2", "s3"]);
  });
});

// Time a question waited on the human is no working time: an ended task's facts carry its runs' waits, so SPENT leaves them out.
describe("an ended task's waits on the human", () => {
  const waitedRun = (run, askedAt, answeredAt) => ({ ...run, ledger: { ...run.ledger, gates: { "G:x": { source: "human", answer: "approve", askedAt, answeredAt } } } });

  test("sum every run's answered waits", () => {
    const runs = [waitedRun(CODE, "2026-11-16T10:00:10.000Z", "2026-11-16T10:00:40.000Z"), waitedRun(PUBLISH, "2026-11-16T10:09:00.000Z", "2026-11-16T14:09:00.000Z")];

    assert.equal(endedTaskFacts(runs).waited, 30 + 4 * 3600);
  });

  test("are none for runs kept before the stamps", () => {
    assert.equal(endedTaskFacts([CODE, PUBLISH]).waited, 0);
  });
});
