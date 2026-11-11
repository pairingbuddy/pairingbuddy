import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { env, makeRepo } from "./cli-repo-fixture.mjs";
import { pbFrom, spikePlugin } from "./spike-plugin-fixture.mjs";

// Scenario spike-unit-checkpoint: checkpoint step spike-unit with the working_directory scope check.
// Tests run on temp repos only.

const UNIT_KEY = "code-spike-unit.explore-spike-unit.u1.r1.a1";
const UNIT = { id: "u1", name: "Probe", description: "Does the probe work?", execution: { language: "python", run_command: "python try.py", working_directory: "spike/u1" } };
const SPIKE = { goal: "Learn X", code_location: "spike", exploration_mode: "questions", doc_path: "docs/spikes/learn-x.md", units: [UNIT] };
const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: env() }).trim();

const LEDGER = { taskType: "spike", stage: { name: "code-spike-unit", status: "active", runId: "wf_1", attempt: 1, startedAt: null }, stages: [{ name: "code-spike-unit", status: "active" }], checkpoints: [] };

// Builds a temp repo at the code-spike-unit stage holding the given files, plus a unit artifact claiming filesChanged.
// A string spike is written as is (so it can be corrupt JSON), null writes no spike.json.
function arrangeUnit(t, { files = {}, filesChanged = [], key = UNIT_KEY, spike = SPIKE, ledger = LEDGER }) {
  const plugin = spikePlugin(t);
  const repo = makeRepo({ ledger });
  const taskDir = join(repo.dir, ".pairingbuddy", "run", "task");
  if (spike !== null) writeFileSync(join(taskDir, "spike.json"), typeof spike === "string" ? spike : JSON.stringify(spike));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo.dir, path)), { recursive: true });
    writeFileSync(join(repo.dir, path), content);
  }
  const artifact = { pb_key: key, ambiguity: "", unit_id: "u1", summary: "it works", code_references: [], recommendation: "use it", commit_subject: "try the probe", files_changed: filesChanged };
  writeFileSync(join(taskDir, "artifacts", `${key}.json`), JSON.stringify(artifact));
  return { plugin, repo, seed: git(repo.dir, "rev-parse", "HEAD") };
}

test("spike-unit-checkpoint-commits-inside-working-directory", (t) => {
  const { plugin, repo, seed } = arrangeUnit(t, { files: { "spike/u1/try.py": "print(1)\n" }, filesChanged: ["spike/u1/try.py"] });

  const result = pbFrom(plugin, repo, "checkpoint", "--step", "spike-unit", "--from", UNIT_KEY);

  assert.equal(result.code, 0, `exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.notEqual(git(repo.dir, "rev-parse", "HEAD"), seed, "a new commit landed");
  assert.equal(git(repo.dir, "log", "-1", "--format=%s"), "chore: try the probe", "the commit subject is chore plus the artifact's commit_subject");
  assert.deepEqual(git(repo.dir, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean), ["spike/u1/try.py"], "the commit holds only the unit's file");
  assert.ok(repo.ledger().checkpoints.some((record) => record.key === UNIT_KEY && record.step === "spike-unit"), "the ledger records a spike-unit checkpoint for the key");
});

test("spike-unit-checkpoint-refuses-path-outside", (t) => {
  const { plugin, repo, seed } = arrangeUnit(t, { files: { "spike/u1/try.py": "print(1)\n", "cart.py": "print(2)\n" }, filesChanged: ["spike/u1/try.py", "cart.py"] });

  const result = pbFrom(plugin, repo, "checkpoint", "--step", "spike-unit", "--from", UNIT_KEY);

  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.code, 1, `refuses with exit 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.ok(output.includes("cart.py"), `the message names the outside path: ${output}`);
  assert.match(output, /working_directory spike\/u1(?!\/)/, `the message names the working_directory itself, not just a file under it: ${output}`);
  assert.equal(git(repo.dir, "rev-parse", "HEAD"), seed, "nothing was committed");
  assert.ok(!repo.ledger().checkpoints.some((record) => record.key === UNIT_KEY), "no checkpoint is recorded for the key");
});

test("spike-unit-checkpoint-no-change-no-commit", (t) => {
  const { plugin, repo, seed } = arrangeUnit(t, { filesChanged: [] });

  const result = pbFrom(plugin, repo, "checkpoint", "--step", "spike-unit", "--from", UNIT_KEY);

  assert.equal(result.code, 0, `exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(git(repo.dir, "rev-parse", "HEAD"), seed, "no commit landed");
  assert.ok(repo.ledger().checkpoints.some((record) => record.key === UNIT_KEY && record.step === "spike-unit" && record.committed === false), "the ledger records a spike-unit checkpoint for the key with committed false");
});

test("spike-unit-checkpoint-refuses-cleanly", async (t) => {
  const withUnit = (override) => ({ ...SPIKE, units: [{ ...UNIT, ...override }] });
  const inside = { "spike/u1/try.py": "print(1)\n" };
  const cases = [
    { label: "a unit id that is not in spike.json", key: "code-spike-unit.explore-spike-unit.u9.r1.a1", refusal: /unit u9 is not in spike\.json/ },
    { label: "a spike.json that is corrupt JSON", spike: "{ not json", refusal: /spike\.json is not valid JSON/ },
    { label: "a spike.json that is missing", spike: null, refusal: /no usable .*spike\.json/ },
    { label: "a key with no item", key: "code-spike-unit.explore-spike-unit.-.r1.a1", refusal: /names no unit, and step spike-unit takes one/ },
    { label: "a non-spike task", ledger: { ...LEDGER, taskType: "refactoring" }, refusal: /step spike-unit runs for spike only, and this task is refactoring/ },
    { label: "a stray path listed after an inside path", files: { ...inside, "stray.py": "print(2)\n" }, filesChanged: ["spike/u1/try.py", "stray.py"], refusal: /stray\.py/ },
    { label: "a hand-edited unit working_directory that is empty", spike: withUnit({ execution: { ...UNIT.execution, working_directory: "" } }), files: inside, filesChanged: ["spike/u1/try.py"], refusal: /the unit has no working_directory in spike\.json/ },
  ];

  for (const { label, key = UNIT_KEY, refusal, ...arrangement } of cases) {
    await t.test(label, (st) => {
      const { plugin, repo, seed } = arrangeUnit(st, { key, ...arrangement });

      const result = pbFrom(plugin, repo, "checkpoint", "--step", "spike-unit", "--from", key);

      const output = `${result.stdout}${result.stderr}`;
      assert.equal(result.code, 1, `refuses with exit 1: ${output}`);
      assert.match(output, refusal, `the refusal names the rule: ${output}`);
      assert.doesNotMatch(output, /unexpected failure/, "the refusal is deliberate, not the catch-all branch");
      assert.equal(git(repo.dir, "rev-parse", "HEAD"), seed, "nothing was committed");
      assert.ok(!repo.ledger().checkpoints.some((record) => record.key === key), "no checkpoint is recorded for the key");
    });
  }
});
