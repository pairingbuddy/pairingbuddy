import { test } from "node:test";
import assert from "node:assert/strict";

test("fixture always fails deliberately", () => {
  assert.equal(1, 2);
});
