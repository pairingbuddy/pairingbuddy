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
      writeFileSync(full, typeof value === "string" ? value : JSON.stringify(value));
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

// Turns events into the JSONL text of a captured claude stream: one JSON object per line, newline-terminated.
function jsonl(events) {
  return events.map((event) => `${JSON.stringify(event)}\n`).join("");
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
  const stream = jsonl([
    { type: "system", subtype: "task_progress", description: "Reading the scenarios" },
    { type: "system", subtype: "task_progress", description: "Writing the failing test" },
    { type: "system", subtype: "task_progress", description: "Running the test suite" },
  ]);

  const result = renderWithFiles({ "solo-stream.jsonl": stream });

  assert.equal(result.status, 0, `render_status must exit 0: ${result.stderr}`);
  assert.match(
    result.stdout,
    /^Agent: Running the test suite$/m,
    "the Agent line shows the description of the last task_progress event",
  );
  assert.doesNotMatch(
    result.stdout,
    /Reading the scenarios|Writing the failing test/,
    "earlier task_progress descriptions are not shown",
  );
});

test("ignores-non-progress-stream-lines", () => {
  const stream = jsonl([
    { type: "system", subtype: "task_progress", description: "Writing the failing test" },
    { type: "system", subtype: "init", description: "Session started" },
    { type: "system", subtype: "task_started", description: "Starting a subtask" },
    { type: "assistant", message: { content: [{ type: "text", text: "Thinking about the next step" }] } },
    { type: "result", subtype: "success", description: "All done" },
  ]);

  const result = renderWithFiles({ "solo-stream.jsonl": stream });

  assert.equal(result.status, 0, `render_status must exit 0: ${result.stderr}`);
  assert.match(
    result.stdout,
    /^Agent: Writing the failing test$/m,
    "the Agent line still shows the last task_progress description",
  );
  assert.doesNotMatch(
    result.stdout,
    /Session started|Starting a subtask|Thinking about the next step|All done/,
    "lines that are not task_progress do not reach the output",
  );
});

test("skips-partial-or-invalid-stream-line", () => {
  const truncatedLine = '{"type":"system","subtype":"task_progress","description":"Half writ';
  const stream =
    jsonl([
      { type: "system", subtype: "task_progress", description: "Reading the scenarios" },
      { type: "system", subtype: "task_progress", description: "Writing the failing test" },
    ]) +
    "this is not json\n" +
    truncatedLine;

  const result = renderWithFiles({ "solo-stream.jsonl": stream });

  assert.equal(result.status, 0, `render_status must exit 0: ${result.stderr}`);
  assert.match(
    result.stdout,
    /^Agent: Writing the failing test$/m,
    "the Agent line shows the last complete task_progress description",
  );
  assert.doesNotMatch(
    result.stdout,
    /Half writ/,
    "the truncated last line is skipped",
  );
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
