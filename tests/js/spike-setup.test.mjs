import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { spikePlugin } from "./spike-plugin-fixture.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CONFIG = `${JSON.stringify({ runners: { pytest: { command: "pytest", test_directory: "tests", run_args: [] } }, default_runner: "pytest" })}\n`;

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
}

// Runs pb from the given plugin copy. PAIRINGBUDDY_SOLO is dropped from the environment because run open refuses to
// run under it, and spike setup has nothing to do with solo.
function pb(cwd, args, { plugin }) {
  const { PAIRINGBUDDY_SOLO: _solo, ...env } = process.env;
  return spawnSync("node", [join(plugin, "cli", "pb.mjs"), ...args], { cwd, encoding: "utf8", env });
}

// A temp repo with a test config and a spike classification; removed when the test ends.
function makeSpikeRepo(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pb-spike-setup-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "x\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  git(dir, "checkout", "-q", "-b", "feature/x");
  mkdirSync(join(dir, ".pairingbuddy"));
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), CONFIG);
  writeFileSync(join(dir, ".pairingbuddy", "task-classification.json"), JSON.stringify({ task_type: "spike", rationale: "exploring" }));
  return dir;
}

const SPIKE_CONFIG = { goal: "Learn X", code_location: "spike", exploration_mode: "questions", doc_path: "docs/spikes/learn-x.md" };
const EXECUTION = { language: "node", run_command: "node probe.mjs", working_directory: "spike/u1" };

function pendingUnit(description) {
  return { id: "u1", name: "Probe", description, execution: EXECUTION, status: "pending" };
}

// Writes the given text for each spike setup file; a null skips the file, so it is missing.
function writeSpikeSetup(root, { config, questions }) {
  if (config !== null) writeFileSync(join(root, ".pairingbuddy", "spike-config.json"), config);
  if (questions !== null) writeFileSync(join(root, ".pairingbuddy", "spike-questions.json"), questions);
}

// Opens a run in a fresh spike repo with the given setup text and checks the deliberate refusal: exit 1, the rule's
// wording on stderr, not the catch-all branch, and no run dir left behind.
function assertRunOpenRefuses(st, plugin, { config, questions }, refusal) {
  const root = makeSpikeRepo(st);
  writeSpikeSetup(root, { config, questions });

  const r = pb(root, ["run", "open", "--kind", "code"], { plugin });

  assert.equal(r.status, 1, `a refusal exits 1: ${r.stderr}`);
  assert.match(r.stderr, refusal, `stderr names the rule that refused: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /unexpected failure/, "the refusal is deliberate, not the catch-all branch");
  assert.equal(existsSync(join(root, ".pairingbuddy", "run")), false, "no run dir is left");
}

// Scenario spike-setup-recorded-at-run-open: pb run open --kind code for a spike task.
// Tests run on temp repos only; never run pb run open against the real repo.

test("run-open-writes-spike-json", (t) => {
  const root = makeSpikeRepo(t);
  const plugin = spikePlugin(t);
  writeSpikeSetup(root, { config: JSON.stringify(SPIKE_CONFIG), questions: JSON.stringify({ units: [pendingUnit("Does the probe work?")] }) });

  const r = pb(root, ["run", "open", "--kind", "code"], { plugin });

  assert.equal(r.status, 0, `run open must succeed: ${r.stderr}`);
  const spike = JSON.parse(readFileSync(join(root, ".pairingbuddy", "run", "task", "spike.json"), "utf8"));
  assert.deepEqual(spike, { ...SPIKE_CONFIG, units: [{ id: "u1", name: "Probe", description: "Does the probe work?", execution: EXECUTION }] }, "spike.json holds the setup, with units reduced to id, name, description and execution");
});
test("run-open-refuses-missing-or-unreadable-setup", async (t) => {
  const plugin = spikePlugin(t);
  const config = JSON.stringify(SPIKE_CONFIG);
  const questions = JSON.stringify({ units: [pendingUnit("Does it work?")] });
  const cases = [
    { label: "spike-config.json missing", file: "spike-config.json", config: null, questions },
    { label: "spike-questions.json missing", file: "spike-questions.json", config, questions: null },
    { label: "spike-config.json not JSON", file: "spike-config.json", config: "{ not json", questions },
    { label: "spike-questions.json not JSON", file: "spike-questions.json", config, questions: "{ not json" },
  ];

  for (const { label, file, config: configText, questions: questionsText } of cases) {
    await t.test(label, (st) => {
      assertRunOpenRefuses(st, plugin, { config: configText, questions: questionsText }, new RegExp(`\\.pairingbuddy/${file.replace(".", "\\.")}`));
    });
  }
});
test("run-open-refuses-bad-units", async (t) => {
  const plugin = spikePlugin(t);
  const config = JSON.stringify(SPIKE_CONFIG);
  const unit = (id) => ({ ...pendingUnit("Does it work?"), id });
  const cases = [
    { label: "no units", units: [], refusal: /has no unit/ },
    { label: "units missing", units: undefined, refusal: /has no unit/ },
    { label: "units not an array", units: "u1", refusal: /has no unit/ },
    { label: "an id with capital letters", units: [unit("U1")], refusal: /"U1" does not fit the key rule/ },
    { label: "an id with a slash", units: [unit("u/1")], refusal: /"u\/1" does not fit the key rule/ },
    { label: "an empty id", units: [unit("")], refusal: /"" does not fit the key rule/ },
    { label: "an id over 64 characters", units: [unit("a".repeat(65))], refusal: new RegExp(`"${"a".repeat(65)}" does not fit the key rule`) },
    { label: "a repeated id", units: [unit("u1"), unit("u2"), unit("u1")], refusal: /u1 repeats/ },
  ];

  for (const { label, units, refusal } of cases) {
    await t.test(label, (st) => {
      assertRunOpenRefuses(st, plugin, { config, questions: JSON.stringify({ units }) }, refusal);
    });
  }
});
test("run-open-refuses-bad-paths", async (t) => {
  const plugin = spikePlugin(t);
  const questionsFor = (working_directory) => JSON.stringify({ units: [{ ...pendingUnit("Does it work?"), execution: { ...EXECUTION, working_directory } }] });
  const goodQuestions = questionsFor("spike/u1");
  const withConfig = (override) => JSON.stringify({ ...SPIKE_CONFIG, ...override });
  // A bad code_location gets a working_directory inside it, so only the code_location rule can refuse.
  const badCodeLocation = (code_location) => ({ config: withConfig({ code_location }), questions: questionsFor(`${code_location}/u1`) });
  const badDocPath = (doc_path) => ({ config: withConfig({ doc_path }), questions: goodQuestions });
  const cases = [
    { label: "an absolute code_location", ...badCodeLocation("/tmp/spike"), refusal: /code_location .* is absolute/ },
    { label: "an empty code_location", config: withConfig({ code_location: "" }), questions: goodQuestions, refusal: /code_location "" is not a path/ },
    { label: "an empty doc_path", ...badDocPath(""), refusal: /doc_path "" is not a path/ },
    { label: "a working_directory in a sibling dir sharing the code_location prefix", config: withConfig({}), questions: questionsFor("spike-other/u1"), refusal: /working_directory "spike-other\/u1" is not inside code_location/ },
    { label: "a code_location with ..", ...badCodeLocation("../spike"), refusal: /code_location .* goes up with \.\./ },
    { label: "a code_location inside .pairingbuddy/", ...badCodeLocation(".pairingbuddy/spike"), refusal: /code_location .* is inside \.pairingbuddy\// },
    { label: "a code_location inside .git/", ...badCodeLocation(".git/spike"), refusal: /code_location .* is inside \.git\// },
    { label: "a code_location spelled ./.git/ that normalizes into .git/", ...badCodeLocation("./.git/spike"), refusal: /code_location .* is inside \.git\// },
    { label: "a doc_path spelled ./.pairingbuddy/ that normalizes into .pairingbuddy/", ...badDocPath("./.pairingbuddy/out.md"), refusal: /doc_path .* is inside \.pairingbuddy\// },
    { label: "an absolute doc_path", ...badDocPath("/tmp/learn-x.md"), refusal: /doc_path .* is absolute/ },
    { label: "a doc_path with ..", ...badDocPath("../learn-x.md"), refusal: /doc_path .* goes up with \.\./ },
    { label: "a doc_path inside .pairingbuddy/", ...badDocPath(".pairingbuddy/learn-x.md"), refusal: /doc_path .* is inside \.pairingbuddy\// },
    { label: "a doc_path inside .git/", ...badDocPath(".git/learn-x.md"), refusal: /doc_path .* is inside \.git\// },
    { label: "a doc_path not ending in .md", ...badDocPath("docs/spikes/learn-x.txt"), refusal: /doc_path .* does not end in \.md/ },
    { label: "a unit working_directory outside code_location", config: withConfig({}), questions: questionsFor("elsewhere/u1"), refusal: /working_directory .* is not inside code_location/ },
    { label: "a unit working_directory under code_location that goes up with ..", config: withConfig({}), questions: questionsFor("spike/../../x"), refusal: /working_directory .* goes up with \.\./ },
  ];

  for (const { label, config, questions, refusal } of cases) {
    await t.test(label, (st) => {
      assertRunOpenRefuses(st, plugin, { config, questions }, refusal);
    });
  }
});
test("run-open-accepts-code-location-edges", async (t) => {
  const plugin = spikePlugin(t);
  const questionsFor = (working_directory) => JSON.stringify({ units: [{ ...pendingUnit("Does it work?"), execution: { ...EXECUTION, working_directory } }] });
  const cases = [
    { label: "a code_location with a trailing slash and a working_directory under it", code_location: "spike/", working_directory: "spike/u1" },
    { label: "a working_directory equal to code_location", code_location: "spike", working_directory: "spike" },
  ];

  for (const { label, code_location, working_directory } of cases) {
    await t.test(label, (st) => {
      const root = makeSpikeRepo(st);
      writeSpikeSetup(root, { config: JSON.stringify({ ...SPIKE_CONFIG, code_location }), questions: questionsFor(working_directory) });

      const r = pb(root, ["run", "open", "--kind", "code"], { plugin });

      assert.equal(r.status, 0, `run open accepts it: ${r.stderr}`);
      assert.equal(existsSync(join(root, ".pairingbuddy", "run", "task", "spike.json")), true, "spike.json is written");
    });
  }
});
test("run-open-non-spike-untouched", (t) => {
  const root = makeSpikeRepo(t);
  writeFileSync(join(root, ".pairingbuddy", "task-classification.json"), JSON.stringify({ task_type: "new_feature", rationale: "adding a feature" }));
  // A TDD task needs a runner that can select one test; spike tasks do not, so the shared config does not carry one.
  const selectable = { runners: { pytest: { command: "pytest", test_directory: "tests", run_args: [], selector_template: ["{test_file}::{test_function}"] } }, default_runner: "pytest" };
  writeFileSync(join(root, ".pairingbuddy", "test-config.json"), `${JSON.stringify(selectable)}\n`);
  writeSpikeSetup(root, { config: "{ not json", questions: "{ not json" });

  const r = pb(root, ["run", "open", "--kind", "code"], { plugin: ROOT });

  assert.equal(r.status, 0, `a non-spike task opens even with unreadable spike files: ${r.stderr}`);
  assert.equal(existsSync(join(root, ".pairingbuddy", "run", "task", "spike.json")), false, "no spike.json is written for a non-spike task");
});


test("spike-config schema declares an optional string doc_path", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "contracts", "schemas", "spike-config.schema.json"), "utf8"));

  assert.equal(schema.properties.doc_path?.type, "string", "doc_path must be a string property");
  assert.ok(!schema.required.includes("doc_path"), "doc_path must stay optional");
});
