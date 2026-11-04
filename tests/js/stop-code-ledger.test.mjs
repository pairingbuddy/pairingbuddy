// Scenario: stop-code-validation. ledger.mjs validates a stable stop.code field on a stop.
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateLedger } from "../../shared-node/ledger.mjs";
import { baseLedger } from "./ledger-fixture.mjs";

test("accepts-stop-with-code", () => {
  const ledger = { ...baseLedger(), stop: { reason: "tests would not go green", seq: 3, code: "red_green_exhausted" } };

  const result = validateLedger(ledger);

  assert.deepEqual(result.errors, [], "a stop with reason, seq and a non-empty string code has no errors");
  assert.equal(result.valid, true, "the ledger validates");
});

test("rejects-stop-without-code", () => {
  const ledger = { ...baseLedger(), stop: { reason: "tests would not go green", seq: 3 } };

  const result = validateLedger(ledger);

  assert.equal(result.valid, false, "a stop with no code is invalid");
  assert.ok(
    result.errors.some((e) => e.path === "stop.code"),
    `an error names stop.code, got ${JSON.stringify(result.errors)}`,
  );
});

for (const [name, code] of [["empty", ""], ["non-string", 42]]) {
  test(`rejects-stop-with-empty-or-non-string-code: ${name}`, () => {
    const ledger = { ...baseLedger(), stop: { reason: "tests would not go green", seq: 3, code } };

    const result = validateLedger(ledger);

    assert.equal(result.valid, false, `a stop with code ${JSON.stringify(code)} is invalid`);
    assert.ok(
      result.errors.some((e) => e.path === "stop.code"),
      `an error names stop.code for ${JSON.stringify(code)}, got ${JSON.stringify(result.errors)}`,
    );
  });
}

test("null-stop-needs-no-code", () => {
  const ledger = { ...baseLedger(), stop: null };

  const result = validateLedger(ledger);

  assert.deepEqual(result.errors, [], "a ledger with stop null has no errors");
  assert.equal(result.valid, true, "the ledger validates without a stop code");
});
