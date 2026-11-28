// The repo boundary and the leak check through the real gate process: in a repo pb works in, with a run or not, a call
// that reaches another repo or sends a secret out is denied, for the main context and subagents alike.
import "./isolated-tmpdir.mjs";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { fakeRepo } from "./d17-repos.mjs";
import { fixture, runGate } from "./gate-harness.mjs";

const originConfig = (url) => `[remote "origin"]\n\turl = ${url}\n`;

// A repo pb works in: it has .pairingbuddy/. No run is open unless runState says so.
function pbRepo({ runState = "none" } = {}) {
  const dir = fakeRepo({ config: originConfig("git@github.com:acme/private-app.git") });
  mkdirSync(join(dir, ".pairingbuddy", ...(runState === "none" ? [] : ["run", "task"])), { recursive: true });
  return dir;
}

let sessions = 0;
function call(cwd, tool, toolInput, { subagent = false } = {}) {
  const payload = { ...fixture("pretooluse-workflow-agent-bash.json"), cwd, session_id: `boundary-${++sessions}`, tool_name: tool, tool_input: toolInput, permission_mode: "default" };
  if (!subagent) {
    delete payload.agent_id;
    delete payload.agent_type;
  }
  return payload;
}

const reasonOf = ({ stdout }) => (stdout === "" ? null : JSON.parse(stdout).hookSpecificOutput);

describe("the repo boundary in the gate", { concurrency: 4 }, () => {
  test("with no run open, filing an issue in another repo is denied", async () => {
    const dir = pbRepo();
    const result = reasonOf(await runGate(call(dir, "Bash", { command: "gh issue create -R acme/open-tool --title 'pb bug' --body 'x'" }), { processCwd: dir }));
    assert.equal(result?.permissionDecision, "deny");
    assert.match(result.permissionDecisionReason, /acme\/open-tool.*only the human/s);
  });

  test("during a run, a subagent's write into another repo's checkout is denied", async () => {
    const dir = pbRepo({ runState: "run" });
    const other = fakeRepo({ config: originConfig("https://github.com/acme/open-tool.git") });
    const result = reasonOf(await runGate(call(dir, "Write", { file_path: join(other, "sub", "fix.js"), content: "x" }, { subagent: true }), { processCwd: dir }));
    assert.equal(result?.permissionDecision, "deny");
    assert.match(result.permissionDecisionReason, /acme\/open-tool.*only the human/s);
  });

  test("a repo pb does not work in is left alone", async () => {
    const dir = fakeRepo({ config: originConfig("git@github.com:acme/private-app.git") });
    const result = await runGate(call(dir, "Bash", { command: "gh issue create -R acme/open-tool --title x --body y" }), { processCwd: dir });
    assert.equal(result.stdout, "");
  });

  test("a gh call posting a secret is denied, and the author's address in the repo config is no leak", async () => {
    const dir = fakeRepo({ config: `${originConfig("git@github.com:acme/private-app.git")}[user]\n\temail = dev@acme-corp.se\n` });
    mkdirSync(join(dir, ".pairingbuddy"));
    const secret = reasonOf(await runGate(call(dir, "Bash", { command: `gh pr create --title fix --body 'token ${["gh", "p_", "q7Lx2Vz9Rk4mWp8Tn3BfY6cJ1sD5hG0eK9uA"].join("")}'` }), { processCwd: dir }));
    assert.match(secret?.permissionDecisionReason ?? "", /github-token/);
    const own = await runGate(call(dir, "Bash", { command: "gh pr create --title fix --body 'by dev@acme-corp.se'" }), { processCwd: dir });
    assert.equal(own.stdout, "");
  });
});
