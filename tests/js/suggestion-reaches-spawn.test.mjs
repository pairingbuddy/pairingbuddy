// Scenario suggestion-reaches-next-spawn: a suggestion written to human-guidance.json is what stage agents already read.
// Workflow control flow, checked with recording stand-ins.
import "./isolated-tmpdir.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { blockOf, runScript } from "./harness.mjs";

const STAGE = fileURLToPath(new URL("../../workflows/code-scenarios.js", import.meta.url));
// GUIDANCE in mod/suggest.ts
const SUGGESTION_FILE = ".pairingbuddy/human-guidance.json";
const ARGS = { attempt: 1, pluginRoot: "/plugins/pairingbuddy", task: { description: "fix the crash" } };

describe("suggestion-reaches-next-stage-spawn", () => {
  test("first-spawn-is-pointed-at-the-file-the-mod-writes-suggestions-to", async () => {
    const { calls } = await runScript(STAGE, { args: ARGS, agent: async () => ({}) });

    const { human_guidance: guidancePath } = JSON.parse(blockOf(calls[0].prompt, "paths"));
    assert.strictEqual(guidancePath, SUGGESTION_FILE, "the first spawn is pointed at the file the mod writes suggestions to");
  });
});
