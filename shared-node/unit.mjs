// Pure rules for a unit (D19): the branch name from the template and the shape of run/unit.json.

export class UnitRefused extends Error {}

// Fills {type}, {slug} and {key} when the unit has one; an unknown placeholder is refused by name.
export function renderBranch(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    if (name === "key" && !Object.hasOwn(values, name)) throw new UnitRefused("branch_template needs a key ({key}), and none was given. Pass --key <key> to pb unit open, or give the plan a **Key:** line under its title");
    if (!Object.hasOwn(values, name)) throw new UnitRefused(`branch_template has unknown placeholder {${name}}`);
    return values[name];
  });
}

export function newUnit({ branch, base, baseSha, configHash, gitConfigHash }) {
  return { unit: null, plan: null, tracer: null, branch, base, baseSha, configHash, gitConfigHash, tasks: [], commits: [] };
}

// The D19 record of one finished task; spend is not measured yet, so it starts empty.
// The title is the plan box label when the task came from a plan, so publish evidence and
// `pb plan next` can match it; otherwise it is the run's task text.
export function newTaskRecord({ ledger, headSha, lessons }) {
  const gateSources = Object.fromEntries(Object.entries(ledger.gates).map(([gate, entry]) => [gate, entry.source]));
  return {
    title: ledger.plan?.title || ledger.task,
    stages: ledger.stages.map((stage) => stage.name),
    gateSources,
    lenses: ledger.lenses,
    headSha,
    reportSummary: null,
    blocking: [],
    attempts: Object.fromEntries(ledger.stages.map((stage) => [stage.name, stage.attempt])),
    lessons,
    spend: null,
    fullSuite: ledger.tests?.full === undefined ? null : { passed: ledger.tests.full.passed, head: ledger.tests.full.head },
  };
}
