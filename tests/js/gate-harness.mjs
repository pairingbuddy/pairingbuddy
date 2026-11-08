import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
export const BOOT = join(ROOT, "hooks", "gate-boot.mjs");
const PAYLOADS = join(ROOT, "tests", "probes", "fixtures", "payloads");

export const fixture = (name) => JSON.parse(readFileSync(join(PAYLOADS, name), "utf8"));

// pluginRoot null leaves CLAUDE_PLUGIN_ROOT unset. processCwd is the hook's own cwd, payload.cwd by default.
// A string payload goes to stdin as it is. gate and path swap the hook file and the PATH it sees.
// env overrides entries of the hook's environment. An inherited PAIRINGBUDDY_GATE_POLICY is dropped unless env sets it.
export function runGate(payload, { pluginRoot = ROOT, processCwd = payload.cwd, gate = BOOT, path = process.env.PATH, env: overrides = {} } = {}) {
  const { CLAUDE_PLUGIN_ROOT: _inherited, PAIRINGBUDDY_GATE_POLICY: _policy, ...env } = process.env;
  if (pluginRoot !== null) env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  env.PATH = path;
  Object.assign(env, overrides);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [gate], {
      cwd: processCwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.on("error", () => {});
    child.stdin.end(typeof payload === "string" ? payload : JSON.stringify(payload));
  });
}

export function assertAllowed(result) {
  assert.deepEqual(result, { code: 0, stdout: "", stderr: "" }, "an allow is silent");
}

export function assertDenied(result, reason) {
  assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout), {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  });
}
