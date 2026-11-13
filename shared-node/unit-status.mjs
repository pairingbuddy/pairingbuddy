// Pure D18 base-status rule behind `pb unit status`. No I/O: the caller fetches and passes everything in.
function rebaseRecipe({ remote, base, from, branch }) {
  return [
    `git rebase --onto ${remote}/${base} ${from} ${branch}`,
    "If the branch was already pushed, the force push is yours to do.",
    "Then run pb unit status again.",
  ].join("\n");
}

export class UnitStatusRefused extends Error {}

export function refuse(reason) {
  throw new UnitStatusRefused(`${reason}, so a human decides what happens to this unit.`);
}

export function unitStatus({ unit, remote, baseTip, dependencyState, unstackedBase, unstackedTip, headContains }) {
  if (unit.stackedOn) {
    if (dependencyState === "CLOSED") refuse(`${unit.stackedOn.unit}'s PR was closed without merging`);
    if (dependencyState !== "OPEN" && dependencyState !== "MERGED") {
      refuse(`${unit.stackedOn.unit}'s PR state is unknown (${String(dependencyState)})`);
    }
  }
  const from = unit.baseSha;
  const rebaseNeeded = (status, base, to) => ({
    status,
    base,
    from,
    to,
    recipe: rebaseRecipe({ remote, base, from, branch: unit.branch }),
  });
  if (dependencyState === "MERGED") {
    return headContains(unstackedTip)
      ? { status: "reconciled", base: unstackedBase, baseSha: unstackedTip, unstack: true }
      : rebaseNeeded("merged", unstackedBase, unstackedTip);
  }
  if (baseTip === null) {
    refuse(`${unit.base} is gone from the remote`);
  }
  if (baseTip === unit.baseSha) return { status: "current" };
  if (headContains(baseTip)) return { status: "reconciled", base: unit.base, baseSha: baseTip, unstack: false };
  return rebaseNeeded("moved", unit.base, baseTip);
}
