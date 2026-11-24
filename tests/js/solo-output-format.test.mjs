import { test } from "node:test";
import assert from "node:assert/strict";

// solo-buddy.sh invokes claude with an output format that supplies task_progress and
// task_notification events (stream-json, per P14 and D14), and keeps the captured output for the renderer.
// Placeholders: each test fails until implement-tests writes the real assertion.

test("claude-args-use-output-format-per-p14", () => {
  assert.fail("not implemented: The claude arguments carry --output-format with the format the renderer parses (stream-json), and no longer the bare json default");
});

test("claude-output-captured-to-stream-file", () => {
  assert.fail("not implemented: The claude invocation writes its output to the stream file the renderer reads, and the file is under .pairingbuddy");
});
