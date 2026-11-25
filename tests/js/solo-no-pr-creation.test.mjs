import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(new URL("../../scripts/solo-buddy.sh", import.meta.url));

// Task 111: solo-buddy.sh no longer pushes or opens PRs (publish stages own that),
// SOLO_BUDDY_REPORT.md is no longer a PR body, and tests/test_solo_buddy_pr_creation.py is retired.
// Tests whose body is assert.fail("placeholder...") still wait for implement-tests.

test("no-gh-pr-create-in-script", () => {
  const source = readFileSync(SCRIPT_PATH, "utf8");

  const found = source.match(/gh\s+pr\s+create/);

  assert.equal(found, null, `solo-buddy.sh must not contain \`gh pr create\`, found: ${found?.[0]}`);
});

test("no-git-push-in-script", () => {
  const source = readFileSync(SCRIPT_PATH, "utf8");

  const found = source.match(/git\s+push/);

  assert.equal(found, null, `solo-buddy.sh must not contain \`git push\`, found: ${found?.[0]}`);
});

test("success-run-makes-no-gh-or-push-call", () => {
  const dir = mkdtempSync(join(tmpdir(), "solo-no-pr-"));
  try {
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const remote = join(dir, "remote.git");
    const repo = join(dir, "repo");
    const bin = join(dir, "bin");
    const calls = join(dir, "calls.log");
    mkdirSync(bin);
    mkdirSync(repo);
    execFileSync(realGit, ["init", "--bare", "-q", remote]);
    execFileSync(realGit, ["init", "-q", "-b", "feature/x", repo]);
    execFileSync(realGit, ["-C", repo, "remote", "add", "origin", remote]);
    writeFileSync(join(repo, "plan.md"), "# plan\n");
    const stub = (name, body) => {
      writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    stub("claude", "exit 0");
    stub("gh", `echo "gh $*" >> "${calls}"\nexit 0`);
    stub("git", `echo "git $*" >> "${calls}"\nexec "${realGit}" "$@"`);

    const result = spawnSync("bash", [SCRIPT_PATH, "plan.md"], {
      cwd: repo,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
      timeout: 60000,
    });

    const log = existsSync(calls) ? readFileSync(calls, "utf8") : "";
    const forbidden = log.split("\n").filter((line) => /^gh\b|^git push\b/.test(line));
    assert.equal(result.status, 0, `script should exit 0, stderr: ${result.stderr}`);
    assert.ok(log.includes("git branch"), "the stubs were used, so the log must show the branch lookup");
    assert.deepEqual(forbidden, [], "a successful run must not call gh or git push");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exit-code-still-matches-claude", () => {
  assert.fail("placeholder: not implemented");
});

test("report-file-not-passed-as-body", () => {
  assert.fail("placeholder: not implemented");
});

test("exit-summary-has-no-pr-lines", () => {
  assert.fail("placeholder: not implemented");
});

test("pr-creation-test-file-removed", () => {
  assert.fail("placeholder: not implemented");
});

test("other-solo-tests-remain", () => {
  assert.fail("placeholder: not implemented");
});
