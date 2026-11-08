// Pure git-doctor warning rules. Takes parsed gh JSON, returns warning texts.

const SQUASH_RULES = [
  { field: "squash_merge_commit_title", expected: "PR_TITLE", consequence: "a squash commit will not use the PR title." },
  { field: "squash_merge_commit_message", expected: "PR_BODY", consequence: "a squash commit will not use the PR body." },
];

// Only a missing body or the exact "Branch not protected" message is unprotected; any other 404/403 is unknown.
function isUnprotected(protection) {
  return !protection || protection.message === "Branch not protected";
}

export function doctorWarnings({ repo, protection }) {
  const warnings = SQUASH_RULES.filter(({ field, expected }) => repo?.[field] !== expected).map(
    ({ field, expected, consequence }) => `${field} is ${repo?.[field] ?? "missing"}, expected ${expected}: ${consequence}`,
  );
  if (isUnprotected(protection)) {
    warnings.push("The default branch has no protection: anyone with write access can push to it directly.");
  }
  return warnings;
}
