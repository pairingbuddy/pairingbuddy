// What pb publish scans before anything leaves the machine, and how a hit is named and allowed.
import "./isolated-tmpdir.mjs";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { allowLeak, outgoingFindings, pendingLeaks } from "../../shared-node/leak-check.mjs";

const DIFF = ["diff --git a/.env b/.env", "new file mode 100644", "--- /dev/null", "+++ b/.env", "@@ -0,0 +1 @@", "+DB_PASSWORD=q7Lx2Vz9Rk4mWp8Tn3Bf"].join("\n");

test("every outgoing part is scanned and each hit says where it is", () => {
  const found = outgoingFindings({ title: "fix", messages: [{ sha: "abcdef1234", text: "fix: ping +46 70 123 45 67" }], diff: DIFF }, {});
  assert.deepEqual(found.map(({ kind, where }) => `${kind} in ${where}`), ["phone in the message of commit abcdef1", "env-file in .env", "secret-assignment in .env"]);
});

test("an allowed hit is not pending on the next check, and the others are numbered again from 1", () => {
  const runDir = mkdtempSync(join(tmpdir(), "leak-check-"));
  const found = outgoingFindings({ diff: DIFF }, {});
  pendingLeaks(runDir, found);

  allowLeak(runDir, 1);
  const pending = pendingLeaks(runDir, found);

  assert.deepEqual(pending.map(({ n, kind }) => `${n} ${kind}`), ["1 secret-assignment"]);
});
