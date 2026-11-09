// Safeguards for shared-node/ledger.mjs: the validator's messages for a non-object and a key it does not know, and the
// refusals of acceptLedger for a ledger that is not well-formed or that carries no hand edit.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseLedger } from "./ledger-fixture.mjs";
import { LedgerRefused, NoHandEdit, acceptLedger, validateLedger, writeLedger } from "../../shared-node/ledger.mjs";

const ledgerPath = () => join(mkdtempSync(join(tmpdir(), "ledger-safeguards-")), "ledger.json");
const ACCEPT_TAIL = ". Only a well-formed ledger can be accepted: fix the file by hand first";

test("non-object-ledger-must-be-an-object", () => {
  assert.deepEqual(validateLedger(42), { valid: false, errors: [{ path: "", message: "must be an object" }] });
});

test("null-ledger-must-be-an-object-without-reading-its-keys", () => {
  assert.deepEqual(validateLedger(null), { valid: false, errors: [{ path: "", message: "must be an object" }] });
});

test("unknown-top-key-is-not-allowed", () => {
  const { valid, errors } = validateLedger({ ...baseLedger(), extra: 1 });

  assert.equal(valid, false);
  assert.deepEqual(errors, [{ path: "extra", message: "is not allowed" }]);
});

test("unknown-nested-key-is-not-allowed", () => {
  const { errors } = validateLedger({ ...baseLedger(), owner: { sessionId: null, lastSeen: null, extra: 1 } });

  assert.deepEqual(errors, [{ path: "owner.extra", message: "is not allowed" }]);
});

test("accept-refuses-a-root-that-is-no-object-naming-the-root", () => {
  const path = ledgerPath();
  writeFileSync(path, "42\n");

  assert.throws(() => acceptLedger(path), (error) =>
    error instanceof LedgerRefused && !(error instanceof NoHandEdit) && error.message === `ledger ${path} is invalid: (root) must be an object${ACCEPT_TAIL}`);
});

test("accept-refuses-a-ledger-that-is-not-json", () => {
  const path = ledgerPath();
  writeFileSync(path, "{ not json");

  assert.throws(() => acceptLedger(path), (error) => error instanceof LedgerRefused && error.message === `ledger ${path} is not valid JSON${ACCEPT_TAIL}`);
});

test("accept-refuses-a-hand-edit-that-breaks-the-schema", () => {
  const path = ledgerPath();
  writeFileSync(path, JSON.stringify({ ...baseLedger(), seq: -1 }));

  assert.throws(() => acceptLedger(path), (error) => error instanceof LedgerRefused && error.message === `ledger ${path} is invalid: seq must be a non-negative integer${ACCEPT_TAIL}`);
});

test("accept-refuses-a-ledger-with-no-hand-edit", () => {
  const path = ledgerPath();
  writeLedger(path, baseLedger());

  assert.throws(() => acceptLedger(path), (error) => error instanceof NoHandEdit && error.message === `ledger ${path} has no sha mismatch, so there is nothing to accept`);
});
