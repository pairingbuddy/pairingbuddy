import "./isolated-tmpdir.mjs";
// The gate watch: a hook apart from gate-boot.mjs that notices when gate-boot.mjs cannot load during a run, which is the
// one break that fails open. Each test drives the real hook from a copy of hooks/ whose gate-boot.mjs it may break.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const BROKEN = "\n)forced parse failure(\n";

const tempDirs = [];
function makeDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// A plugin with only the two hooks the watch touches: the watch must not need anything else.
function makePlugin({ broken = false, appended = BROKEN } = {}) {
  const plugin = makeDir("gate-watch-plugin-");
  mkdirSync(join(plugin, "hooks"));
  for (const name of ["gate-watch.mjs", "gate-boot.mjs"]) copyFileSync(join(ROOT, "hooks", name), join(plugin, "hooks", name));
  if (broken) appendFileSync(join(plugin, "hooks", "gate-boot.mjs"), appended);
  return plugin;
}

function makeRun() {
  const root = makeDir("gate-watch-run-");
  mkdirSync(join(root, ".pairingbuddy", "run", "task"), { recursive: true });
  writeFileSync(join(root, ".pairingbuddy", "run", "task", "ledger.json"), "{}\n");
  return root;
}

function watch(plugin, payload) {
  const result = spawnSync("node", [join(plugin, "hooks", "gate-watch.mjs")], { input: JSON.stringify(payload), cwd: payload.cwd ?? tmpdir(), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout === "" ? null : JSON.parse(result.stdout);
}

describe("gate watch", () => {
  test("tells the model the safety checks are off when gate-boot.mjs cannot load during a run", () => {
    const plugin = makePlugin({ broken: true });
    const root = makeRun();

    const out = watch(plugin, { hook_event_name: "PostToolUse", session_id: "s1", cwd: root, tool_name: "Bash", tool_input: { command: "ls" } });

    assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
    const text = out.hookSpecificOutput.additionalContext;
    assert.match(text, /safety checks are off/);
    assert.match(text, /make no more tool calls/i);
    assert.match(text, /gate-boot\.mjs parse failure/);
  });

  test("says nothing while gate-boot.mjs loads", () => {
    assert.equal(watch(makePlugin(), { hook_event_name: "PostToolUse", session_id: "s1", cwd: makeRun(), tool_name: "Bash" }), null);
  });

  test("says nothing with no run, however broken gate-boot.mjs is", () => {
    assert.equal(watch(makePlugin({ broken: true }), { hook_event_name: "PostToolUse", session_id: "s1", cwd: makeDir("gate-watch-norun-"), tool_name: "Bash" }), null);
  });

  test("finds a run the session is bound to from a cwd that has left it", () => {
    const root = makeRun();
    mkdirSync(join(tmpdir(), "pairingbuddy-sessions"), { recursive: true });
    writeFileSync(join(tmpdir(), "pairingbuddy-sessions", "bound-1"), root);

    const out = watch(makePlugin({ broken: true }), { hook_event_name: "PostToolUse", session_id: "bound-1", cwd: makeDir("gate-watch-away-"), tool_name: "Bash" });

    assert.match(out.hookSpecificOutput.additionalContext, /safety checks are off/);
  });

  // A name gate-boot.mjs imports and its module does not export parses fine, and still fails the load.
  test("notices a load that fails past the parse", () => {
    const plugin = makePlugin({ broken: true, appended: '\nimport { noSuchExport } from "node:fs";\n' });

    const out = watch(plugin, { hook_event_name: "PostToolUse", session_id: "s1", cwd: makeRun(), tool_name: "Bash" });

    assert.match(out?.hookSpecificOutput.additionalContext ?? "", /noSuchExport/);
  });

  // gate-boot.mjs fails open, so the watch denies in its place, as gate-boot.mjs denies for a gate.mjs that cannot load.
  test("denies a gated tool before it runs", () => {
    const out = watch(makePlugin({ broken: true }), { hook_event_name: "PreToolUse", session_id: "s1", cwd: makeRun(), tool_name: "Bash", tool_input: { command: "ls" } });

    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /safety checks are off/);
  });

  test("tells the model on a prompt too, before it makes a call", () => {
    const out = watch(makePlugin({ broken: true }), { hook_event_name: "UserPromptSubmit", session_id: "s1", cwd: makeRun(), prompt: "go on" });

    assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.match(out.hookSpecificOutput.additionalContext, /safety checks are off/);
  });

  // The mod reads the marker, since it must not load the broken file; it names the file as it stood, so a restored file
  // shows the marker stale before any hook runs again.
  test("leaves a marker in the run while gate-boot.mjs cannot load, and clears it once it loads", () => {
    const plugin = makePlugin({ broken: true });
    const root = makeRun();
    const marker = join(root, ".pairingbuddy", "run", "gate-off.json");
    const payload = { hook_event_name: "PostToolUse", session_id: "s1", cwd: root, tool_name: "Bash" };

    watch(plugin, payload);

    const gateBoot = join(plugin, "hooks", "gate-boot.mjs");
    const written = JSON.parse(readFileSync(marker, "utf8"));
    assert.equal(written.path, gateBoot);
    assert.equal(written.plugin, plugin);
    assert.equal(written.mtimeMs, statSync(gateBoot).mtimeMs);
    assert.equal(written.size, statSync(gateBoot).size);

    copyFileSync(join(ROOT, "hooks", "gate-boot.mjs"), gateBoot);
    watch(plugin, payload);

    assert.equal(existsSync(marker), false);
  });

  // Every tool call runs the watch, so it loads gate-boot.mjs again only once the file changed.
  test("keeps its verdict while gate-boot.mjs keeps its time and size", () => {
    const plugin = makePlugin();
    const gateBoot = join(plugin, "hooks", "gate-boot.mjs");
    const good = readFileSync(gateBoot, "utf8");
    const { atime, mtime } = statSync(gateBoot);
    // Whole milliseconds, which utimes keeps exactly.
    utimesSync(gateBoot, atime, mtime);
    const payload = { hook_event_name: "PostToolUse", session_id: "s1", cwd: makeRun(), tool_name: "Bash" };
    watch(plugin, payload);

    writeFileSync(gateBoot, `)${good.slice(1)}`);
    utimesSync(gateBoot, atime, mtime);
    const cached = watch(plugin, payload);
    utimesSync(gateBoot, atime, new Date(mtime.getTime() + 1000));
    const fresh = watch(plugin, payload);

    assert.equal(cached, null);
    assert.match(fresh.hookSpecificOutput.additionalContext, /safety checks are off/);
  });
});

describe("gate watch registration", () => {
  const { hooks } = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));
  const watchEntries = (event) => (hooks[event] ?? []).filter((entry) => entry.hooks.some((h) => h.command === "node ${CLAUDE_PLUGIN_ROOT}/hooks/gate-watch.mjs"));

  test("runs before every tool gate-boot.mjs gates, in an entry of its own", () => {
    const [boot] = (hooks.PreToolUse ?? []).filter((entry) => entry.hooks.some((h) => h.command.includes("hooks/gate-boot.mjs")));
    const [entry, ...more] = watchEntries("PreToolUse");

    assert.equal(more.length, 0);
    assert.equal(entry.matcher, boot.matcher);
    assert.equal(entry.hooks.length, 1);
  });

  for (const event of ["PostToolUse", "UserPromptSubmit", "SessionStart"]) {
    test(`runs on ${event}`, () => {
      assert.ok(watchEntries(event).length > 0);
    });
  }

  test("imports node built-ins only, and never gate-boot.mjs or gate.mjs", () => {
    const source = readFileSync(join(ROOT, "hooks", "gate-watch.mjs"), "utf8");
    const imports = [...source.matchAll(/^import .* from "(.+)";$/gm)].map(([, name]) => name);

    assert.ok(imports.length > 0);
    assert.deepEqual(imports.filter((name) => !name.startsWith("node:")), []);
    assert.doesNotMatch(source, /import\(["'`]\.\/gate/);
  });
});
