import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HOOKS_JSON = resolve(REPO_ROOT, "hooks/hooks.json");

test("hooks.json lists mod/register.tsx in modules and keeps the four shell hook events", () => {
  const config = JSON.parse(readFileSync(HOOKS_JSON, "utf8"));

  const modules = config.modules;
  assert.ok(Array.isArray(modules), "hooks.json must have a `modules` array");
  const expected = resolve(REPO_ROOT, "mod/register.tsx");
  const resolvedModules = modules.map((m) => resolve(dirname(HOOKS_JSON), m));
  assert.equal(
    resolvedModules.filter((p) => p === expected).length,
    1,
    "modules must list mod/register.tsx exactly once",
  );
  assert.ok(existsSync(expected), `module path must resolve to an existing file, got ${expected}`);

  for (const event of ["SessionStart", "PreToolUse", "PostToolUse", "Stop"]) {
    assert.ok(
      Array.isArray(config.hooks?.[event]) && config.hooks[event].length > 0,
      `shell hook event ${event} must still be present`,
    );
  }
});
