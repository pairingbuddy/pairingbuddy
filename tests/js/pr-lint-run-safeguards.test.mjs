// Safeguards for shared-node/pr-lint-run.mjs: a git diff that fails is a PrLintRunRefused naming the command and git's error.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrLintRunRefused, runPrLint } from "../../shared-node/pr-lint-run.mjs";

const BASE = "0".repeat(40);

test("git-diff-failure-is-a-refusal-naming-the-command", () => {
  const root = mkdtempSync(join(tmpdir(), "pr-lint-run-"));
  mkdirSync(join(root, ".pairingbuddy", "run"), { recursive: true });
  writeFileSync(join(root, ".pairingbuddy", "run", "unit.json"), JSON.stringify({ baseSha: BASE, base: "main" }));
  writeFileSync(join(root, ".pairingbuddy", "run", "pr-body.md"), "Adds a button.\n");
  writeFileSync(join(root, ".pairingbuddy", "git-config.json"), "{}\n");

  assert.throws(() => runPrLint(root, "feat: add a button"), (error) =>
    error instanceof PrLintRunRefused && error.message.startsWith(`git diff --numstat ${BASE}...HEAD failed: `) && /not a git repository/i.test(error.message));
});
