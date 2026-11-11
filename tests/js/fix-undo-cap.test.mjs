// The mod cannot read contracts/lenses.json, so shared-node/limits.mjs keeps its own copy of the fix-attempt cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as limits from "../../shared-node/limits.mjs";

const lenses = JSON.parse(readFileSync(new URL("../../contracts/lenses.json", import.meta.url), "utf8"));

test("max-fix-undos-equals-lenses-max-attempts", () => {
  assert.equal(
    limits.MAX_FIX_UNDOS,
    lenses.maxAttempts,
    "MAX_FIX_UNDOS in shared-node/limits.mjs must equal maxAttempts in contracts/lenses.json",
  );
});
