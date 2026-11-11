import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { makeRepo } from "./cli-repo-fixture.mjs";
import { pbFrom, spikePlugin } from "./spike-plugin-fixture.mjs";

// Scenario spike-state-verb: pb spike state reports unit progress from the ledger.
// Real tests run on temp repos only.

const U1 = { id: "u1", name: "Probe", description: "Does the probe work?", execution: { language: "node", run_command: "node probe.mjs", working_directory: "spike/u1" } };
const U2 = { id: "u2", name: "Second", description: "Does the second probe work?", execution: { language: "node", run_command: "node second.mjs", working_directory: "spike/u2" } };

const SPIKE = { goal: "Learn X", code_location: "spike", exploration_mode: "questions", doc_path: "docs/spikes/learn-x.md", units: [U1, U2] };
const ACTIVE_STAGE = { name: "code-spike-unit", status: "active", runId: "wf_1", attempt: 1, startedAt: null };

function spikeStateIn(plugin, { taskType = "spike", stage = ACTIVE_STAGE, explored = [] } = {}) {
  const repo = makeRepo({ ledger: { taskType, stage, stages: [{ name: "code-spike-unit", status: "active", explored }] } });
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "spike.json"), JSON.stringify(SPIKE));
  return pbFrom(plugin, repo, "spike", "state");
}

test("spike-state-prints-next-unit", (t) => {
  const plugin = spikePlugin(t);

  const r = spikeStateIn(plugin, { explored: ["u1"] });

  assert.equal(r.code, 0, `spike state succeeds, stdout ${r.stdout}, stderr ${r.stderr}`);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, taskType: "spike", spike: ".pairingbuddy/run/task/spike.json", units: ["u1", "u2"], explored: ["u1"], next: U2 }, "state lists the unit ids, the explored ids and the first unexplored unit in full");
});

test("spike-state-refuses-when-all-explored", (t) => {
  const plugin = spikePlugin(t);

  const r = spikeStateIn(plugin, { explored: ["u1", "u2"] });

  assert.equal(r.code, 1, `spike state refuses with exit 1, stdout ${r.stdout}, stderr ${r.stderr}`);
  assert.match(r.stderr, /every unit is explored/, "the refusal names that every unit is explored, not the catch-all");
});

test("spike-state-refuses-non-spike-or-no-stage", async (t) => {
  const plugin = spikePlugin(t);

  await t.test("a non-spike task with an active stage is refused as not a spike task", () => {
    const r = spikeStateIn(plugin, { taskType: "refactoring" });

    assert.equal(r.code, 1, `refused with exit 1, stdout ${r.stdout}, stderr ${r.stderr}`);
    assert.match(r.stderr, /spike tasks only, and this task is refactoring/, "the refusal names that the verb is for spike tasks only");
  });

  await t.test("a spike task with no active stage is refused as having nothing to report on", () => {
    const r = spikeStateIn(plugin, { stage: { ...ACTIVE_STAGE, status: "done" } });

    assert.equal(r.code, 1, `refused with exit 1, stdout ${r.stdout}, stderr ${r.stderr}`);
    assert.match(r.stderr, /no stage is active, so there is nothing to report on/, "the refusal names the missing active stage");
  });
});

test("spike-state-extra-argument-is-a-usage-error", (t) => {
  const plugin = spikePlugin(t);
  const repo = makeRepo({ ledger: { taskType: "spike", stage: ACTIVE_STAGE, stages: [{ name: "code-spike-unit", status: "active", explored: [] }] } });
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "spike.json"), JSON.stringify(SPIKE));

  const r = pbFrom(plugin, repo, "spike", "state", "extra");

  assert.notEqual(r.code, 0, `an extra argument is refused, stdout ${r.stdout}`);
  assert.match(r.stderr, /usage: pb spike state/, "the usage line is printed");
});
