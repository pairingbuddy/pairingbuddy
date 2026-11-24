import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Solo renderer (render_status in scripts/solo-buddy.sh) reads run/unit.json, the ledger,
// the captured claude stream and task_progress / task_notification events.
// Tests not yet implemented are placeholders that fail until implement-tests writes the real assertion.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOLO_SCRIPT = join(REPO_ROOT, "scripts", "solo-buddy.sh");

// Loads render_status out of solo-buddy.sh and runs it once inside a temp project.
// Writes each entry of `files` (path under .pairingbuddy -> JSON value) first,
// e.g. { "run/unit.json": unit, "run/task/ledger.json": ledger }. Returns the spawn result.
function renderWithFiles(files) {
  const dir = mkdtempSync(join(tmpdir(), "solo-render-"));
  try {
    for (const [path, value] of Object.entries(files)) {
      const full = join(dir, ".pairingbuddy", path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, JSON.stringify(value));
    }
    // Paths travel as positional arguments, so the shell never parses them.
    const script = [
      "set +e",
      `PLAN_FILE="$2/no-plan.md"`,
      "LAST_RENDER_LINES=0",
      "FORCE_COLOR=0",
      `eval "$(awk '/^render_status\\(\\)[ \\t]*\\{/,/^\\}/' "$1")"`,
      `declare -F render_status >/dev/null || { echo "render_status not found in $1" >&2; exit 99; }`,
      `cd "$2"`,
      "render_status",
    ].join("\n");
    return spawnSync("bash", ["-c", script, "bash", SOLO_SCRIPT, dir], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("shows-unit-branch-and-task-count-from-unit-json", () => {
  const unit = {
    unit: "solo-renderer",
    branch: "feat/solo-renderer",
    tasks: [{ title: "Task 1" }, { title: "Task 2" }, { title: "Task 3" }],
    commits: [],
  };

  const result = renderWithFiles({ "run/unit.json": unit });

  assert.equal(result.status, 0, `render_status must exit 0: ${result.stderr}`);
  assert.match(
    result.stdout,
    /^Unit: feat\/solo-renderer \(3 tasks\)$/m,
    "the Unit line names the branch and the three tasks recorded on the unit",
  );
});

test("shows-current-stage-from-ledger", () => {
  const ledger = { stage: { name: "implement-tests", status: "running", attempt: 2 } };

  const result = renderWithFiles({ "run/task/ledger.json": ledger });

  assert.equal(result.status, 0, `render_status must exit 0: ${result.stderr}`);
  assert.match(
    result.stdout,
    /^Stage: implement-tests running \(attempt 2\)$/m,
    "the Stage line names the ledger stage, its status and its attempt",
  );
});

test("shows-stop-reason-from-ledger", () => {
  const ledger = {
    stage: { name: "implement-tests", status: "running", attempt: 2 },
    stop: { reason: "tests would not fail for the right reason", code: "wrong-failure" },
  };

  const result = renderWithFiles({ "run/task/ledger.json": ledger });

  assert.equal(result.status, 0, `render_status must exit 0: ${result.stderr}`);
  assert.match(
    result.stdout,
    /^Stopped: tests would not fail for the right reason$/m,
    "the Stopped line names the ledger stop reason",
  );
  assert.doesNotMatch(
    result.stdout,
    /^Stage: /m,
    "a stopped run shows no running Stage line",
  );
});

test("shows-needs-human-gate-from-ledger", () => {
  const ledger = {
    needsHuman: { gate: "pr-review" },
  };

  const result = renderWithFiles({ "run/task/ledger.json": ledger });

  assert.equal(result.status, 0, `render_status must exit 0: ${result.stderr}`);
  assert.match(
    result.stdout,
    /^Waiting on: pr-review$/m,
    "the Waiting line names the gate the ledger needsHuman holds",
  );
});

test("no-longer-reads-guardian-hooks-file", () => {
  const guardianSession = { lastAgent: "implement-tests", lastDescription: "Writing the failing test" };

  const result = renderWithFiles({ "hooks/session-1.json": guardianSession });

  assert.equal(result.status, 0, `render_status must exit 0: ${result.stderr}`);
  assert.doesNotMatch(
    result.stdout,
    /implement-tests/,
    "the agent name in the guardian hooks file is not shown",
  );
  assert.doesNotMatch(
    result.stdout,
    /Writing the failing test/,
    "the description in the guardian hooks file is not shown",
  );
});

test("shows-latest-task-progress-description", () => {
  assert.fail("not implemented: With a stream holding several task_progress events, the output shows the description of the last one");
});

test("ignores-non-progress-stream-lines", () => {
  assert.fail("not implemented: Stream lines that are not task_progress (other system subtypes, assistant messages) do not change the agent line");
});

test("skips-partial-or-invalid-stream-line", () => {
  assert.fail("not implemented: A truncated last line in the stream is skipped and the previous task_progress description still shows");
});

test("sums-usage-across-task-notifications", () => {
  assert.fail("not implemented: With two task_notification events carrying usage, the output shows their summed tokens");
});

test("shows-unknown-spend-with-no-notifications", () => {
  assert.fail("not implemented: With a stream holding no task_notification, spend is shown as unknown rather than zero");
});

test("task-notification-without-usage-adds-nothing", () => {
  assert.fail("not implemented: A task_notification with no usage field does not break the sum or add to it");
});

test("missing-unit-json-does-not-crash", () => {
  assert.fail("not implemented: With no run/unit.json but a ledger and stream, render_status exits 0 and still shows the other parts");
});

test("missing-ledger-does-not-crash", () => {
  assert.fail("not implemented: With a unit.json but no ledger, render_status exits 0 and still shows the unit");
});

test("missing-stream-file-does-not-crash", () => {
  assert.fail("not implemented: With no captured stream, render_status exits 0 and shows no agent line and unknown spend");
});

test("malformed-json-state-does-not-crash", () => {
  assert.fail("not implemented: With a unit.json or ledger that is not valid JSON, render_status exits 0 and shows the initializing or partial view");
});

test("no-files-shows-initializing", () => {
  assert.fail("not implemented: With no unit.json, ledger or stream, render_status exits 0 and shows the initializing message");
});
