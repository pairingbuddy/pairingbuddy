// Task 106a: stable and experimental are two marketplace plugins, and a session with both on is refused in plain words.
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPERIMENTAL, STABLE, bothChannelsOn, mergeEnabledPlugins } from "../../shared-node/channels.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const GUARD = join(ROOT, "hooks", "channel-guard.mjs");

const tempDirs = [];
const makeDir = (prefix) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
};
after(() => tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const layer = (enabledPlugins) => ({ enabledPlugins });

describe("channel settings", () => {
  test("names the two marketplace plugins", () => {
    assert.equal(STABLE, "pairingbuddy@pairingbuddy-marketplace");
    assert.equal(EXPERIMENTAL, "pairingbuddy-experimental@pairingbuddy-marketplace");
  });

  test("both on in any layers is a conflict", () => {
    assert.equal(bothChannelsOn(mergeEnabledPlugins([layer({ [STABLE]: true }), layer({ [EXPERIMENTAL]: true })])), true);
  });

  test("one channel on is not a conflict", () => {
    assert.equal(bothChannelsOn(mergeEnabledPlugins([layer({ [STABLE]: true })])), false);
    assert.equal(bothChannelsOn(mergeEnabledPlugins([layer({ [EXPERIMENTAL]: true })])), false);
  });

  test("a later layer's false turns off an earlier layer's true", () => {
    const merged = mergeEnabledPlugins([layer({ [STABLE]: true, [EXPERIMENTAL]: true }), layer({ [STABLE]: false })]);
    assert.equal(bothChannelsOn(merged), false);
  });

  test("a layer with no enabledPlugins, or a broken one, changes nothing", () => {
    const merged = mergeEnabledPlugins([layer({ [STABLE]: true }), null, {}, layer("yes"), layer({ [EXPERIMENTAL]: true })]);
    assert.equal(bothChannelsOn(merged), true);
  });
});

function setup({ user = {}, project = null, local = null } = {}) {
  const configDir = makeDir("pb-channel-config-");
  const projectDir = makeDir("pb-channel-project-");
  writeFileSync(join(configDir, "settings.json"), JSON.stringify(layer(user)));
  mkdirSync(join(projectDir, ".claude"));
  if (project) writeFileSync(join(projectDir, ".claude", "settings.json"), JSON.stringify(layer(project)));
  if (local) writeFileSync(join(projectDir, ".claude", "settings.local.json"), typeof local === "string" ? local : JSON.stringify(layer(local)));
  return { configDir, projectDir };
}

function guard(event, { configDir, projectDir }) {
  const input = JSON.stringify({ hook_event_name: event, session_id: "channel-session", cwd: projectDir, source: "startup", prompt: "go on" });
  const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir, CLAUDE_PROJECT_DIR: projectDir };
  const r = spawnSync("node", [GUARD], { cwd: projectDir, input, encoding: "utf8", env });
  assert.equal(r.status, 0, `channel-guard exits 0: ${r.stderr}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

describe("channel guard hook", () => {
  const both = { user: { [STABLE]: true }, project: { [EXPERIMENTAL]: true } };

  test("refuses every prompt while both channels are on, and says how to turn one off", () => {
    const out = guard("UserPromptSubmit", setup(both));
    assert.equal(out.decision, "block");
    assert.match(out.reason, /stable and experimental are both on/);
    assert.ok(out.reason.includes(`claude plugin disable ${EXPERIMENTAL}`), out.reason);
    assert.ok(out.reason.includes(`claude plugin disable ${STABLE}`), out.reason);
  });

  test("says so to the person at session start", () => {
    const out = guard("SessionStart", setup(both));
    assert.match(out.systemMessage, /stable and experimental are both on/);
  });

  test("stays silent with one channel on", () => {
    assert.equal(guard("UserPromptSubmit", setup({ user: { [STABLE]: true } })), null);
    assert.equal(guard("SessionStart", setup({ user: { [EXPERIMENTAL]: true } })), null);
  });

  test("reads the local settings last, so turning one off there ends the refusal", () => {
    assert.equal(guard("UserPromptSubmit", setup({ ...both, local: { [EXPERIMENTAL]: false } })), null);
  });

  test("skips a settings file it cannot read and still reads the others", () => {
    assert.equal(guard("UserPromptSubmit", setup({ ...both, local: "{" })).decision, "block");
  });

  test("stays silent with no settings files at all", () => {
    const dirs = setup();
    rmSync(join(dirs.configDir, "settings.json"));
    assert.equal(guard("UserPromptSubmit", dirs), null);
  });
});
