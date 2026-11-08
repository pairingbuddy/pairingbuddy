// Pure rules for a unit (D19): the branch name from the template and the shape of run/unit.json.

export class UnitRefused extends Error {}

// Fills {type} and {slug}; an unknown placeholder is refused by name.
export function renderBranch(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new UnitRefused(`branch_template has unknown placeholder {${name}}`);
    return values[name];
  });
}

export function newUnit({ branch, base, baseSha, configHash, gitConfigHash }) {
  return { unit: null, plan: null, tracer: null, branch, base, baseSha, configHash, gitConfigHash, tasks: [], commits: [] };
}

// The D19 record of one finished task; spend is not measured yet, so it starts empty.
export function newTaskRecord({ ledger, headSha }) {
  const gateSources = Object.fromEntries(Object.entries(ledger.gates ?? {}).map(([gate, entry]) => [gate, entry.source]));
  return {
    title: ledger.task,
    stages: (ledger.stages ?? []).map((stage) => stage.name),
    gateSources,
    headSha,
    reportSummary: null,
    blocking: [],
    attempts: Object.fromEntries((ledger.stages ?? []).map((stage) => [stage.name, stage.attempt])),
    lessons: [],
    spend: null,
  };
}
