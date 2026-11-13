import { test } from "node:test";
import assert from "node:assert/strict";
import { doctorWarnings } from "../../shared-node/git-doctor.mjs";

// Scenario: git-doctor-warnings-logic. Literal gh JSON in, warning texts out.

const PROTECTION = { url: "https://api.github.com/repos/o/r/branches/main/protection", required_pull_request_reviews: {} };

test("squash-settings-pr-title-and-body-no-warning", () => {
  const repo = { squash_merge_commit_title: "PR_TITLE", squash_merge_commit_message: "PR_BODY" };

  const warnings = doctorWarnings({ repo, protection: PROTECTION });

  assert.deepEqual(warnings, [], "PR_TITLE, PR_BODY and a protected default branch yield no warnings");
});

test("squash-title-or-message-other-than-pr-values-warns", () => {
  const titleOnly = doctorWarnings({
    repo: { squash_merge_commit_title: "COMMIT_OR_PR_TITLE", squash_merge_commit_message: "PR_BODY" },
    protection: PROTECTION,
  });
  const messageOnly = doctorWarnings({
    repo: { squash_merge_commit_title: "PR_TITLE", squash_merge_commit_message: "COMMIT_MESSAGES" },
    protection: PROTECTION,
  });
  const blankMessage = doctorWarnings({
    repo: { squash_merge_commit_title: "PR_TITLE", squash_merge_commit_message: "BLANK" },
    protection: PROTECTION,
  });
  const missingFields = doctorWarnings({ repo: {}, protection: PROTECTION });

  assert.deepEqual(
    titleOnly,
    ["squash_merge_commit_title is COMMIT_OR_PR_TITLE, expected PR_TITLE: a squash commit will not use the PR title."],
    "a non-PR_TITLE squash title warns and names the setting",
  );
  assert.deepEqual(
    messageOnly,
    ["squash_merge_commit_message is COMMIT_MESSAGES, expected PR_BODY: a squash commit will not use the PR body."],
    "COMMIT_MESSAGES as squash message warns and names the setting",
  );
  assert.deepEqual(
    blankMessage,
    ["squash_merge_commit_message is BLANK, expected PR_BODY: a squash commit will not use the PR body."],
    "BLANK as squash message warns and names the setting",
  );
  assert.deepEqual(
    missingFields,
    [
      "squash_merge_commit_title is missing, expected PR_TITLE: a squash commit will not use the PR title.",
      "squash_merge_commit_message is missing, expected PR_BODY: a squash commit will not use the PR body.",
    ],
    "missing fields warn for both settings",
  );
});

test("unprotected-default-branch-warns", () => {
  const repo = { squash_merge_commit_title: "PR_TITLE", squash_merge_commit_message: "PR_BODY" };

  const whenNull = doctorWarnings({ repo, protection: null });
  const when404 = doctorWarnings({ repo, protection: { message: "Branch not protected", status: "404" } });

  const expected = ["The default branch has no protection: anyone with write access can push to it directly."];
  assert.deepEqual(whenNull, expected, "null protection (gh 404) warns that the default branch is unprotected");
  assert.deepEqual(when404, expected, "a 404 'Branch not protected' body warns the same way");
});
