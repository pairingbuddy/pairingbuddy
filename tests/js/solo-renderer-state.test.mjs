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

// Loads render_status, the read_state_line helper it calls and the STREAM_FILE path out of solo-buddy.sh and runs it once inside a temp project.
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
      `eval "$(grep -E '^STREAM_FILE=' "$1")"`,
      `eval "$(awk '/^read_state_line\\(\\)[ \\t]*\\{/,/^\\}/' "$1")"`,
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

// Renders like renderWithFiles, asserts the render exited 0, and returns stdout.
function renderStdout(files, situation) {
  const result = renderWithFiles(files);
  assert.equal(result.status, 0, `render_status must exit 0 ${situation}: ${result.stderr}`);
  return result.stdout;
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
  const stream = jsonl([
    { type: "system", subtype: "task_notification", usage: { total_tokens: 1200 } },
    { type: "system", subtype: "task_progress", description: "Writing the failing test" },
    { type: "system", subtype: "task_notification", usage: { total_tokens: 3300 } },
  ]);

  const result = renderWithFiles({ "solo-stream.jsonl": stream });

  assert.equal(result.status, 0, `render_status must exit 0: ${result.stderr}`);
  assert.match(
    result.stdout,
    /^Spend: 4500 tokens$/m,
    "the Spend line shows the total tokens summed across both task_notification events",
  );
});

test("shows-unknown-spend-with-no-notifications", () => {
  const stream = jsonl([
    { type: "system", subtype: "task_progress", description: "Writing the failing test" },
    { type: "system", subtype: "task_progress", description: "Running the test suite" },
  ]);

  const result = renderWithFiles({ "solo-stream.jsonl": stream });

  assert.equal(result.status, 0, `render_status must exit 0: ${result.stderr}`);
  assert.match(
    result.stdout,
    /^Spend: unknown$/m,
    "the Spend line says unknown when the stream holds no task_notification",
  );
});

test("task-notification-without-usage-adds-nothing", () => {
  const stream = jsonl([
    { type: "system", subtype: "task_notification", usage: { total_tokens: 1200 } },
    { type: "system", subtype: "task_notification", summary: "Finished without usage" },
    { type: "system", subtype: "task_notification", usage: { total_tokens: 3300 } },
  ]);

  const result = renderWithFiles({ "solo-stream.jsonl": stream });

  assert.equal(result.status, 0, `render_status must exit 0: ${result.stderr}`);
  assert.match(
    result.stdout,
    /^Spend: 4500 tokens$/m,
    "the Spend line sums only the notifications that carry usage, and the one without adds nothing",
  );
  assert.doesNotMatch(result.stdout, /NaN|null|undefined/, "the missing usage does not leak into the output");
});

test("missing-unit-json-does-not-crash", () => {
  const ledger = { stage: { name: "implement-tests", status: "running", attempt: 2 } };
  const stream = jsonl([
    { type: "system", subtype: "task_progress", description: "Writing the failing test" },
    { type: "system", subtype: "task_notification", usage: { total_tokens: 1200 } },
  ]);

  const result = renderWithFiles({ "run/task/ledger.json": ledger, "solo-stream.jsonl": stream });

  assert.equal(result.status, 0, `render_status must exit 0 without a unit.json: ${result.stderr}`);
  assert.doesNotMatch(result.stdout, /^Unit: /m, "no Unit line shows when there is no unit.json");
  assert.match(
    result.stdout,
    /^Stage: implement-tests running \(attempt 2\)$/m,
    "the Stage line from the ledger still shows",
  );
  assert.match(
    result.stdout,
    /^Agent: Writing the failing test$/m,
    "the Agent line from the stream still shows",
  );
  assert.match(result.stdout, /^Spend: 1200 tokens$/m, "the Spend line from the stream still shows");
});

test("missing-ledger-does-not-crash", () => {
  const unit = {
    unit: "solo-renderer",
    branch: "feat/solo-renderer",
    tasks: [{ title: "Task 1" }, { title: "Task 2" }],
    commits: [],
  };

  const result = renderWithFiles({ "run/unit.json": unit });

  assert.equal(result.status, 0, `render_status must exit 0 without a ledger: ${result.stderr}`);
  assert.match(
    result.stdout,
    /^Unit: feat\/solo-renderer \(2 tasks\)$/m,
    "the Unit line from unit.json still shows",
  );
  assert.doesNotMatch(result.stdout, /^Stage: /m, "no Stage line shows when there is no ledger");
  assert.doesNotMatch(result.stdout, /^Stopped: /m, "no Stopped line shows when there is no ledger");
  assert.doesNotMatch(result.stdout, /^Waiting on: /m, "no Waiting line shows when there is no ledger");
});

test("missing-stream-file-does-not-crash", () => {
  const ledger = { stage: { name: "implement-tests", status: "running", attempt: 2 } };

  const stdout = renderStdout({ "run/task/ledger.json": ledger }, "without a stream file");

  assert.match(
    stdout,
    /^Stage: implement-tests running \(attempt 2\)$/m,
    "the Stage line from the ledger still shows",
  );
  assert.doesNotMatch(stdout, /^Agent: /m, "no Agent line shows when there is no stream");
  assert.match(stdout, /^Spend: unknown$/m, "the Spend line says unknown when there is no stream");
});

test("malformed-json-state-does-not-crash", () => {
  const stdout = renderStdout(
    {
      "run/unit.json": '{"unit":"solo-renderer","branch":"feat/solo-ren',
      "run/task/ledger.json": "this is not json",
    },
    "with a unit.json and a ledger that are not valid JSON",
  );

  assert.match(stdout, /Initializing autonomous execution/, "the initializing view shows when no state file can be read");
  assert.doesNotMatch(stdout, /^Unit: /m, "no Unit line shows for a malformed unit.json");
  assert.doesNotMatch(stdout, /^Stage: /m, "no Stage line shows for a malformed ledger");
  assert.doesNotMatch(stdout, /SyntaxError|Unexpected token/, "the parse error does not leak into the output");
});

test("no-files-shows-initializing", () => {
  const stdout = renderStdout({}, "with no unit.json, ledger or stream");

  assert.match(stdout, /Initializing autonomous execution/, "the initializing view shows when no state file exists");
  assert.doesNotMatch(stdout, /^Unit: /m, "no Unit line shows without a unit.json");
  assert.doesNotMatch(stdout, /^Stage: /m, "no Stage line shows without a ledger");
  assert.doesNotMatch(stdout, /^Agent: /m, "no Agent line shows without a stream");
});
