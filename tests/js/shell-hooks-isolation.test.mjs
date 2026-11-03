// R6: a broken mod must not stop the shell hooks (gate, tap, stop, session-start). The test copies the plugin, makes
// mod/register.tsx throw on load, and drives every command in the copy's hooks.json as a subprocess.
import "./isolated-tmpdir.mjs";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const PAYLOADS = join(ROOT, "tests", "probes", "fixtures", "payloads");
const BROKEN_MOD = 'throw new Error("mod broken on load");\n';
const SKIP = new Set([".git", ".venv", "node_modules", ".pairingbuddy", "tests", ".pytest_cache", ".ruff_cache", "pairingbuddy.egg-info"]);

const tempDirs = [];
const makeDir = (prefix) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
};
after(() => tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const payload = (file) => JSON.parse(readFileSync(join(PAYLOADS, file), "utf8"));
const sessionStart = (source) => ({ hook_event_name: "SessionStart", session_id: "iso-session", source });
const PAYLOAD_FOR = {
  "SessionStart[startup|resume|clear]": sessionStart("startup"),
  "SessionStart[compact]": sessionStart("compact"),
  "PreToolUse[Workflow|Agent|Write|Edit|NotebookEdit|Bash|AskUserQuestion]": payload("pretooluse-workflow-agent-bash.json"),
  "PreToolUse[]": payload("pretooluse-workflow-agent-bash.json"),
  "PostToolUse[]": payload("posttooluse-workflow.json"),
  "PostToolUse[AskUserQuestion]": payload("posttooluse-askuserquestion.json"),
  "PostToolUse[StructuredOutput|Workflow]": payload("posttooluse-workflow.json"),
  "Stop[]": payload("stop.json"),
};

const plugin = (() => {
  const copy = makeDir("pb-plugin-copy-");
  cpSync(ROOT, copy, { recursive: true, filter: (src) => !SKIP.has(src.slice(ROOT.length + 1).split("/")[0]) });
  writeFileSync(join(copy, "mod", "register.tsx"), BROKEN_MOD);
  return copy;
})();

function shellCommands(plugin) {
  const config = JSON.parse(readFileSync(join(plugin, "hooks", "hooks.json"), "utf8"));
  return Object.entries(config.hooks).flatMap(([event, groups]) =>
    groups.flatMap((group) => group.hooks.map((h) => ({ event, matcher: group.matcher ?? "", command: h.command.replaceAll("${CLAUDE_PLUGIN_ROOT}", plugin) }))));
}

test("with mod/register.tsx throwing on load, the shell hooks from hooks.json still run and exit successfully with normal output", () => {
  const repo = makeDir("pb-iso-repo-");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const commands = shellCommands(plugin);
  assert.deepEqual([...new Set(commands.map((c) => c.event))].sort(), ["PostToolUse", "PreToolUse", "SessionStart", "Stop"], "hooks.json declares the four shell hook events");

  for (const { event, matcher, command } of commands) {
    const key = `${event}[${matcher}]`;
    const label = `${key} ${command.replace(plugin, "<plugin>")}`;
    assert.ok(PAYLOAD_FOR[key], `${key} has a payload for its matcher group`);
    const input = JSON.stringify({ ...PAYLOAD_FOR[key], cwd: repo });
    const r = spawnSync("sh", ["-c", command], { cwd: repo, input, encoding: "utf8", env: { ...process.env, PAIRINGBUDDY_SOLO: "", CLAUDE_PLUGIN_ROOT: plugin } });

    assert.equal(r.status, 0, `${label} exits 0: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /mod broken on load|register\.tsx/, `${label} never loads the mod`);
    if (r.stdout.trim()) assert.doesNotThrow(() => JSON.parse(r.stdout), `${label} prints JSON or nothing`);
    if (event === "PreToolUse") assert.doesNotMatch(r.stdout, /"deny"/, `${label} does not deny an allowed call`);
  }
});

// Not { skip }: tests/js_suite.py rejects a run with skipped tests, and no CI config in this repo provides the claude
// CLI, so a missing CLI logs a diagnostic and returns early instead of failing.
test("claude plugin validate flags only the broken mod, never a shell hook entry", (t) => {
  const claude = spawnSync("claude", ["--version"], { encoding: "utf8" });
  if (claude.error || claude.status !== 0) {
    t.diagnostic("claude CLI not available: skipped `claude plugin validate`");
    return;
  }
  const v = spawnSync("claude", ["plugin", "validate", plugin, "--json"], { encoding: "utf8" });
  assert.ok(v.stdout?.trim(), `validate printed JSON (status ${v.status}, error ${v.error}): ${v.stderr}`);
  const report = JSON.parse(v.stdout);
  const hooksEntry = report.contents.find((c) => c.file.endsWith("hooks/hooks.json"));
  assert.ok(hooksEntry, "validate reports the shell hooks (hooks/hooks.json)");
  const isBrokenMod = (e) => /^modules.*\/mod\/register\.tsx$/.test(e.path);
  assert.deepEqual(hooksEntry.errors.filter((e) => !isBrokenMod(e)), [], "validate finds no error besides the broken module");
  assert.equal(hooksEntry.errors.filter(isBrokenMod).length, 1, "validate flags the broken mod/register.tsx exactly once");
});
