// A hook reads its payload from fd 0, never by opening /dev/stdin: when a Node parent spawns it with piped stdio, stdin is a
// socket pair, and on Linux opening /dev/stdin then fails with ENXIO (a Linux user's report, Node 24).
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CODE_DIRS = ["hooks", "cli", "shared-node", "scripts"];

test("no shipped script opens /dev/stdin by path", () => {
  const offenders = CODE_DIRS.flatMap((dir) => readdirSync(join(ROOT, dir)).filter((name) => /\.(mjs|js)$/.test(name)).map((name) => join(dir, name)))
    .filter((path) => readFileSync(join(ROOT, path), "utf8").includes("/dev/stdin"));

  assert.deepEqual(offenders, []);
});

// Spawned the way a Node parent does it, stdin a pipe the parent writes the payload into.
function runPiped(hook, payload, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, "hooks", hook)], { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT } });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

for (const hook of ["guardian.mjs", "solo-progress.mjs"]) {
  test(`${hook} reads a payload written into a piped stdin`, async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pb-hook-stdin-")));

    const { code, stderr } = await runPiped(hook, { session_id: "s1", cwd, hook_event_name: "PostToolUse", tool_name: "Read", tool_input: {} }, cwd);

    assert.equal(code, 0, stderr);
    assert.doesNotMatch(stderr, /ENXIO|dev\/stdin/);
  });
}
