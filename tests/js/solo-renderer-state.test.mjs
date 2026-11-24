import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Solo renderer (render_status in scripts/solo-buddy.sh) reads run/unit.json, the ledger,
// the captured claude stream and task_progress / task_notification events.
// Placeholders: each test fails until implement-tests writes the real assertion.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOLO_SCRIPT = join(REPO_ROOT, "scripts", "solo-buddy.sh");

// Loads render_status out of solo-buddy.sh and runs it once inside a temp project
// whose .pairingbuddy/run/unit.json holds `unit`. Returns the spawn result.
function renderWithUnit(unit) {
  const dir = mkdtempSync(join(tmpdir(), "solo-render-"));
  try {
    mkdirSync(join(dir, ".pairingbuddy", "run"), { recursive: true });
    writeFileSync(join(dir, ".pairingbuddy", "run", "unit.json"), JSON.stringify(unit));
    const script = [
      "set +e",
      `PLAN_FILE=${JSON.stringify(join(dir, "no-plan.md"))}`,
      "LAST_RENDER_LINES=0",
      "FORCE_COLOR=0",
      `eval "$(awk '/^render_status\\(\\)[ \\t]*\\{/,/^\\}/' ${JSON.stringify(SOLO_SCRIPT)})"`,
      `cd ${JSON.stringify(dir)}`,
      "render_status",
    ].join("\n");
    return spawnSync("bash", ["-c", script], { encoding: "utf8" });
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

  const result = renderWithUnit(unit);

  assert.equal(result.status, 0, `render_status must exit 0: ${result.stderr}`);
  assert.match(result.stdout, /feat\/solo-renderer/, "output names the unit's branch");
  assert.match(
    result.stdout,
    /\b3 tasks?\b|\btasks?\b\D{0,10}\b3\b/i,
    "output shows the three tasks recorded on the unit",
  );
});

test("shows-current-stage-from-ledger", () => {
  assert.fail("not implemented: With a ledger whose stage is {name, status, attempt}, the output shows the stage name, its status and the attempt");
});

test("shows-stop-reason-from-ledger", () => {
  assert.fail("not implemented: With a ledger whose stop is {reason, code}, the output shows the stop reason instead of a running stage");
});

test("shows-needs-human-gate-from-ledger", () => {
  assert.fail("not implemented: With a ledger whose needsHuman names a gate, the output shows that the run is waiting on that gate");
});

test("no-longer-reads-guardian-hooks-file", () => {
  assert.fail("not implemented: With a .pairingbuddy/hooks session file holding lastAgent and no new state, the output does not show that agent");
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
