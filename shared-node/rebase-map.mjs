import { refuse } from "./unit-status.mjs";

// The first unused range commit with the same patch-id.
function findByPatchId(commit, range, used) {
  if (commit.patchId === null) return undefined;
  return range.find((candidate) => !used.has(candidate.sha) && candidate.patchId === commit.patchId);
}

// Pure remap of a unit's recorded commits onto the commits of a rebased range. No I/O.
export function remapCommits({ recorded, range, merges = [] }) {
  if (merges.length > 0) {
    refuse(`The rebased range contains a merge (${merges.join(", ")}); rebase instead of merging`);
  }
  const mapping = {};
  const used = new Set();
  // Pass 1: a recorded sha still in the range maps to itself, before patch-id matching can take it.
  for (const commit of recorded) {
    if (range.some((candidate) => candidate.sha === commit.sha)) {
      used.add(commit.sha);
      mapping[commit.sha] = commit.sha;
    }
  }
  for (const commit of recorded) {
    if (commit.sha in mapping) continue;
    const match = findByPatchId(commit, range, used);
    if (!match) refuse(`The recorded commit ${commit.sha} has no match after the rebase (its change differs, or it was dropped)`);
    used.add(match.sha);
    mapping[commit.sha] = match.sha;
  }
  const extra = range.find((candidate) => !used.has(candidate.sha));
  if (extra) refuse(`The commit ${extra.sha} is not in the unit record`);
  return mapping;
}
