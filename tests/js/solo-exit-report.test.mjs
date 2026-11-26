import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Tests for the Solo exit report. Each runs scripts/solo-buddy.sh in a throwaway repo with a stubbed claude.

const SCRIPT_PATH = fileURLToPath(new URL("../../scripts/solo-buddy.sh", import.meta.url));

// Runs solo-buddy.sh in a throwaway repo whose claude stub exits with `claudeExit`.
// `files` maps a path under the repo to its text, or to a JSON value that is written as JSON.
// Returns the spawn result and the text of the status file the script wrote ("" when none).
function runSolo({ claudeExit = 0, files = {} }) {
  const dir = mkdtempSync(join(tmpdir(), "solo-exit-report-"));
  try {
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const repo = join(dir, "repo");
    const bin = join(dir, "bin");
    mkdirSync(bin);
    mkdirSync(repo);
    execFileSync(realGit, ["init", "-q", "-b", "feature/x", repo]);
    writeFileSync(join(repo, "plan.md"), "# plan\n");
    for (const [path, value] of Object.entries(files)) {
      const full = join(repo, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, typeof value === "string" ? value : JSON.stringify(value));
    }
    writeFileSync(join(bin, "claude"), `#!/usr/bin/env bash\nexit ${claudeExit}\n`);
    chmodSync(join(bin, "claude"), 0o755);

    const result = spawnSync("bash", [SCRIPT_PATH, "plan.md"], {
      cwd: repo,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
      timeout: 60000,
    });

    const statusPath = join(repo, ".pairingbuddy", "solo-status");
    return { result, status: existsSync(statusPath) ? readFileSync(statusPath, "utf8") : "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("exit-zero-with-stop-in-ledger-reports-failure", () => {
  const ledger = {
    stage: { name: "implement-tests", status: "running", attempt: 2 },
    stop: { reason: "implement-tests ran out of fix attempts", seq: 7, code: "attempt-cap" },
  };

  const { result, status } = runSolo({ claudeExit: 0, files: { ".pairingbuddy/run/task/ledger.json": ledger } });

  assert.doesNotMatch(result.stdout, /Session complete/, "an exit 0 with a stop in the ledger must not read as complete");
  assert.match(result.stdout, /^✗/m, "the summary must carry a failure line");
  assert.match(result.stdout, /implement-tests ran out of fix attempts/, "the summary must name the stop reason");
  assert.doesNotMatch(status, /Session complete/, "the status footer must not say the session completed");
});

test("exit-zero-with-needs-human-in-ledger-reports-failure", () => {
  assert.fail("not implemented: exit-zero-with-needs-human-in-ledger-reports-failure");
});

test("exit-zero-with-unfinished-stage-reports-failure", () => {
  assert.fail("not implemented: exit-zero-with-unfinished-stage-reports-failure");
});

test("unfinished-exit-zero-script-exits-non-zero", () => {
  assert.fail("not implemented: unfinished-exit-zero-script-exits-non-zero");
});

test("exit-zero-with-finished-ledger-still-complete", () => {
  assert.fail("not implemented: exit-zero-with-finished-ledger-still-complete");
});

test("attempt-cap-stop-shows-attempt-count", () => {
  assert.fail("not implemented: attempt-cap-stop-shows-attempt-count");
});

test("attempt-cap-stop-shows-each-lesson", () => {
  assert.fail("not implemented: attempt-cap-stop-shows-each-lesson");
});

test("summary-lists-every-pr-link", () => {
  assert.fail("not implemented: summary-lists-every-pr-link");
});

test("summary-lists-pr-links-on-failure-too", () => {
  assert.fail("not implemented: summary-lists-pr-links-on-failure-too");
});

test("summary-with-pr-links-makes-no-gh-or-push-call", () => {
  assert.fail("not implemented: summary-with-pr-links-makes-no-gh-or-push-call");
});
