// The pure D18 stacking rule: given a unit, its dependency and the PR lines, it decides where the unit branches from.
// It does no I/O.
const NEXT_UNIT_GATE = "G:next-unit";
const STACK_DEPTH_REASON = "stack-depth";
const KNOWN_PR_STATES = new Set(["OPEN", "MERGED", "CLOSED"]);

export class StackRefused extends Error {}

function refuseClosed(dependency) {
  throw new StackRefused(
    `${dependency.unit}: its PR was closed without merging, so its code is in no base and no open branch; a human decides`,
  );
}

function refuseUnknownState(dependency) {
  throw new StackRefused(`${dependency.unit}: its PR state is unknown, so where to stack is unclear; a human decides`);
}

function findUnit(units, name) {
  return units.find((candidate) => candidate.unit === name);
}

function dependencyOf(units, unit) {
  return findUnit(units, unit.dependsOn);
}

// The units a unit depends on, nearest first, following each Depends on to the end of the chain.
export function dependencyChainOf(units, unitName) {
  const chain = [];
  for (let dependency = findUnit(units, unitName); (dependency = dependencyOf(units, dependency)); ) {
    chain.push(dependency);
  }
  return chain;
}

function prOf(prs, dependency) {
  return prs?.[dependency?.pr];
}

// The dependency to stack on: only when its PR is OPEN. No dependency, no PR line or MERGED means base (null).
function openDependency(units, current, prs) {
  const dependency = dependencyOf(units, current);
  const state = prOf(prs, dependency)?.state;
  if (dependency?.pr && !KNOWN_PR_STATES.has(state)) refuseUnknownState(dependency);
  if (state === "CLOSED") refuseClosed(dependency);
  return state === "OPEN" ? dependency : null;
}

function depthOf(units, prs, current) {
  const dependency = openDependency(units, current, prs);
  return dependency ? 1 + depthOf(units, prs, dependency) : 0;
}

export function stackFor({ units, unit, prs, stackDepth }) {
  const dependency = openDependency(units, findUnit(units, unit), prs);
  if (!dependency) return { base: true };
  const depth = 1 + depthOf(units, prs, dependency);
  if (depth > stackDepth) {
    return { stop: { gate: NEXT_UNIT_GATE, reason: STACK_DEPTH_REASON, unit, depth, cap: stackDepth } };
  }
  const branch = prOf(prs, dependency).headRefName;
  return { stackOn: { unit: dependency.unit, pr: dependency.pr, branch, depth } };
}
