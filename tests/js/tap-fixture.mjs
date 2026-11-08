// Shared by the tests that answer a gate question through the real tap: the recorded human payloads, a recorded
// AskUserQuestion answer, the tap runner, and the sha256 the ledger bindings use.
import "./isolated-tmpdir.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { env, ROOT } from "./cli-repo-fixture.mjs";

export const SESSION = "session-one";
const PAYLOADS = join(ROOT, "tests", "probes", "fixtures", "payloads");

export const fixture = (name) => JSON.parse(readFileSync(join(PAYLOADS, name), "utf8"));
export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// Runs hooks/tap.mjs on a payload in the repo and asserts it exits 0. A tap that has nothing to say prints nothing,
// so a test that expects output passes prints: true. extraEnv adds environment variables (for example a PATH with a gh shim).
export function runTap(repo, payload, extraEnv = {}, { prints = false } = {}) {
  const { status, stdout } = spawnSync(process.execPath, [join(ROOT, "hooks", "tap.mjs")], { cwd: repo.dir, input: JSON.stringify(payload), env: env(extraEnv), encoding: "utf8" });
  assert.equal(status, 0);
  if (!prints) assert.equal(stdout, "", "the tap prints nothing");
  return stdout;
}

// Built on the human P3 recording (pb-probes/human/P3/20261031-181900/hooks.jsonl, scrubbed into the payload
// fixtures). Only session, cwd, the question and the answer are filled in by the test, and a gate question must match
// what the CLI emitted, options included. notes puts the human's free text on the answer's annotation; over overrides
// payload fields; toolResponse replaces the response.
export function recordedAnswer(repo, gateQuestion, answer, { over = {}, toolResponse, notes } = {}) {
  const recorded = fixture("posttooluse-askuserquestion.json");
  const questions = recorded.tool_input.questions.map((asked) => ({ ...asked, ...gateQuestion }));
  const answered = { ...recorded.tool_input, questions, answers: { [gateQuestion.question]: answer } };
  const annotated = { ...answered, ...(notes !== undefined && { annotations: { [gateQuestion.question]: { notes } } }) };
  return {
    ...recorded, session_id: SESSION, cwd: repo.dir,
    tool_input: answered, tool_response: toolResponse === undefined ? annotated : toolResponse,
    ...over,
  };
}
