// Safeguards for shared-node/duration.mjs: an hour or more reads h:mm:ss, minutes and seconds padded to two digits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clock } from "../../shared-node/duration.mjs";

test("an-hour-or-more-reads-h-mm-ss", () => {
  assert.equal(clock(3661), "1:01:01");
  assert.equal(clock(3600), "1:00:00");
  assert.equal(clock(36000 + 59 * 60 + 9.9), "10:59:09");
});

test("under-an-hour-stays-m-ss", () => {
  assert.equal(clock(3599), "59:59");
});
