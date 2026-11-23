// Scenario spent-agents: SPENT counts the whole task's agents. The ledger keeps what every closed stage attempt spent, so a
// reload, which empties the session's spawns, takes nothing from the count; the session adds only the stage running now.
import { test } from "node:test";
import assert from "node:assert/strict";

import { glance } from "../../shared-node/glance.mjs";

const RUN_START = "2026-11-22T21:07:07.658Z";
const ATTEMPT_START = "2026-11-23T19:01:24.437Z";
const later = (iso, seconds) => new Date(Date.parse(iso) + seconds * 1000).toISOString();
const spawn = (startedAt, item = "code") => ({ kind: "workflow_agent", name: `pb1 code-safety-net - lens ${item} r1`, startedAt });
const LIVE = {
  seq: 40,
  stage: { name: "code-safety-net", status: "active", startedAt: ATTEMPT_START, attempt: 6 },
  stages: [{ name: "intake", status: "done", attempt: 1, startedAt: RUN_START, spend: { agents: 193, tokens: 0, tokensKnown: false } }],
  spend: { agents: 193, tokens: 0, tokensKnown: false },
  stop: null,
  needsHuman: null,
};
const agentsOf = (ledger, spawns) => glance({ ledger, spawns, tests: [], now: Date.parse(later(ATTEMPT_START, 600)), leaveOutUnknown: true }).rows.spent.split(" · ")[0];

test("spent-agents: after a reload the closed attempts' agents stand and the running attempt's are added", () => {
  const spawns = [spawn(later(ATTEMPT_START, 5)), spawn(later(ATTEMPT_START, 6), "tests")];

  assert.equal(agentsOf(LIVE, spawns), "195 agents");
});

test("spent-agents: a session that saw the closed attempts counts their agents once, from the ledger", () => {
  const earlier = [{ kind: "workflow_agent", name: "pb1 intake - runner - r1", startedAt: RUN_START }, spawn(later(ATTEMPT_START, -600))];
  const spawns = [...earlier, spawn(later(ATTEMPT_START, 5))];

  assert.equal(agentsOf(LIVE, spawns), "194 agents");
});

test("spent-agents: once the attempt closes its agents are the ledger's, not counted again from the session", () => {
  const failed = { ...LIVE, stage: { ...LIVE.stage, status: "failed" }, spend: { ...LIVE.spend, agents: 195 } };
  const spawns = [spawn(later(ATTEMPT_START, 5)), spawn(later(ATTEMPT_START, 6), "tests")];

  assert.equal(agentsOf(failed, spawns), "195 agents");
});

test("spent-agents: a spawn of another stage counts as that stage's, even with no start stamped", () => {
  const spawns = [{ kind: "workflow_agent", name: "pb1 intake - runner - r1" }, { kind: "Agent", name: "classify the task" }, spawn(undefined)];

  assert.equal(agentsOf(LIVE, spawns), "194 agents");
});
