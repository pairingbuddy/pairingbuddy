// Safeguards for shared-node/unit-files.mjs: closing a unit whose run directory is gone removes nothing and does not throw.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeUnit } from "../../shared-node/unit-files.mjs";

test("close-unit-with-no-run-dir-removes-nothing", () => {
  const runDir = join(mkdtempSync(join(tmpdir(), "unit-files-")), "run");

  assert.deepEqual(closeUnit(runDir), []);
});
