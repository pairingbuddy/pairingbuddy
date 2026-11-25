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

// Runs solo-buddy.sh in a throwaway repo with stubbed binaries on PATH.
// `stubs` maps a binary name to its bash body; `env` adds environment variables.
// Returns the spawn result and the stubs' call log.
function runSolo({ stubs, env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), "solo-no-pr-"));
  try {
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const repo = join(dir, "repo");
    const bin = join(dir, "bin");
    const calls = join(dir, "calls.log");
    mkdirSync(bin);
    mkdirSync(repo);
    execFileSync(realGit, ["init", "-q", "-b", "feature/x", repo]);
    writeFileSync(join(repo, "plan.md"), "# plan\n");
    for (const [name, body] of Object.entries(stubs({ realGit, calls }))) {
      writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    }

    const result = spawnSync("bash", [SCRIPT_PATH, "plan.md"], {
      cwd: repo,
      env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
      timeout: 60000,
    });

    return { result, log: existsSync(calls) ? readFileSync(calls, "utf8") : "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("success-run-makes-no-gh-or-push-call", () => {
  const { result, log } = runSolo({
    stubs: ({ realGit, calls }) => ({
      claude: "exit 0",
      gh: `echo "gh $*" >> "${calls}"\nexit 0`,
      git: `echo "git $*" >> "${calls}"\nexec "${realGit}" "$@"`,
    }),
  });

  const forbidden = log.split("\n").filter((line) => /^gh\b|^git push\b/.test(line));
  assert.equal(result.status, 0, `script should exit 0, stderr: ${result.stderr}`);
  assert.notEqual(log, "", "the stubs must have been used, so the call log cannot be empty");
  assert.deepEqual(forbidden, [], "a successful run must not call gh or git push");
});

test("exit-code-still-matches-claude", () => {
  const { result } = runSolo({ stubs: () => ({ claude: "exit 3" }) });

  assert.equal(result.status, 3, `script must exit with claude's exit code 3, stderr: ${result.stderr}`);
});

test("report-file-not-passed-as-body", () => {
  const source = readFileSync(SCRIPT_PATH, "utf8");
  const lines = source.split("\n");

  const bodyFlagLines = lines.filter((line) => /--body(-file)?\b/.test(line));
  const prBodyMentions = lines.filter((line) => /\bPR\s+body\b|pull request body/i.test(line));
  const reportOnPrCommand = lines.filter(
    (line) => /(gh|git)\b.*(REPORT_FILE|SOLO_BUDDY_REPORT)|(REPORT_FILE|SOLO_BUDDY_REPORT).*\bgh\b/.test(line),
  );

  assert.deepEqual(bodyFlagLines, [], "the script must not pass a body or body-file to any PR command");
  assert.deepEqual(prBodyMentions, [], "the header and usage text must not call the report a PR body");
  assert.deepEqual(reportOnPrCommand, [], "SOLO_BUDDY_REPORT.md must not appear on a gh or git command line");
});

test("exit-summary-has-no-pr-lines", () => {
  const prUrl = "https://example.test/pull/1";
  const prError = "push rejected";
  // The script no longer reads these; leaking them in proves the summary cannot print them.
  const { result } = runSolo({
    stubs: () => ({ claude: "exit 0" }),
    env: { PR_URL: prUrl, PR_ERROR: prError },
  });

  const output = `${result.stdout}${result.stderr}`;
  assert.ok(output.includes("Session complete"), `the exit summary must print, output: ${output}`);
  assert.ok(!output.includes(prUrl), "the exit summary must not print the PR URL");
  assert.ok(!output.includes(prError), "the exit summary must not print the PR error");
});

test("pr-creation-test-file-removed", () => {
  const retiredPath = fileURLToPath(new URL("../test_solo_buddy_pr_creation.py", import.meta.url));

  const stillThere = existsSync(retiredPath);

  assert.equal(stillThere, false, `${retiredPath} must be retired (deleted)`);
});

test("other-solo-tests-remain", () => {
  assert.fail("placeholder: not implemented");
});
