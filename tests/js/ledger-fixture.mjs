// Shared builder for a fully valid ledger. Tests override the fields they care about inline.
export const ZERO_SHA = "0".repeat(64);

export function baseLedger({ task = "Task 20" } = {}) {
  return {
    v: 1,
    seq: 0,
    sha: ZERO_SHA,
    kind: "code",
    taskType: "config_change",
    owner: { sessionId: null, lastSeen: null },
    task,
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

// Intake is the first stage of every task type, gated by G:type. A run past it has intake done and G:type passed.
export const INTAKE_DONE = { name: "intake", status: "done" };
const G_TYPE_PASSED = { source: "auto" };

// Puts a done intake in front of the given stages.
export const afterIntake = (stages = []) => [INTAKE_DONE, ...stages];

// Adds the passed G:type to the given gates.
export const withTypePassed = (gates = {}) => ({ "G:type": G_TYPE_PASSED, ...gates });

// The whole ledger past intake: a done intake first in its stages and G:type passed. A ledger that already starts with intake keeps its own.
export function withIntake(ledger) {
  const stages = ledger.stages ?? [];
  return { ...ledger, stages: stages[0]?.name === "intake" ? stages : afterIntake(stages), gates: withTypePassed(ledger.gates) };
}

// The ledger's stages without the intake entry every run starts with, for tests that look at the stage after it.
export const workStages = (ledger) => ledger.stages.filter(({ name }) => name !== "intake");
