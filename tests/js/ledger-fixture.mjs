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
