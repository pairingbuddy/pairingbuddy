import "./isolated-tmpdir.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeLedger } from "../../shared-node/ledger.mjs";
import { makeRepo } from "./cli-repo-fixture.mjs";
import { pbFrom, spikePlugin } from "./spike-plugin-fixture.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");

const SPIKE_CONFIG = { goal: "Learn X", code_location: "spike", exploration_mode: "questions", doc_path: "docs/spikes/learn-x.md" };
const EXECUTION = { language: "node", run_command: "node probe.mjs", working_directory: "spike/u1" };

function pendingUnit(description) {
  return { id: "u1", name: "Probe", description, execution: EXECUTION, status: "pending" };
}

const DEFAULT_SETUP = { config: JSON.stringify(SPIKE_CONFIG), questions: JSON.stringify({ units: [pendingUnit("Does the probe work?")] }) };

function spikeJsonPath(dir) {
  return join(dir, ".pairingbuddy", "run", "task", "spike.json");
}

// Builds a repo whose run is past G:type, and removes it when the test ends.
function spikeRunPastTypeGate(t, { taskType = "spike" } = {}) {
  const repo = makeRepo({ ledger: { taskType, stage: { name: "intake", status: "done", runId: "wf_1", attempt: 1, startedAt: null } } });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
  return repo;
}

// Writes the given text for each spike setup file; a null skips the file, so it is missing.
function writeSpikeSetup(root, { config, questions } = DEFAULT_SETUP) {
  if (config !== null) writeFileSync(join(root, ".pairingbuddy", "spike-config.json"), config);
  if (questions !== null) writeFileSync(join(root, ".pairingbuddy", "spike-questions.json"), questions);
}

// Sets up a spike run past G:type with the given setup text and checks the deliberate refusal of pb spike setup: exit 1,
// the rule's wording on stderr, not the catch-all branch, and no spike.json written.
function assertSetupRefuses(st, plugin, { config, questions }, refusal) {
  const repo = spikeRunPastTypeGate(st);
  writeSpikeSetup(repo.dir, { config, questions });

  const r = pbFrom(plugin, repo, "spike", "setup");

  assert.equal(r.code, 1, `a refusal exits 1: ${r.stderr}`);
  assert.match(r.stderr, refusal, `stderr names the rule that refused: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /unexpected failure/, "the refusal is deliberate, not the catch-all branch");
  assert.match(r.stderr, /so pb spike setup recorded nothing/, "the refusal says pb spike setup recorded nothing, not that no run was opened");
  assert.equal(existsSync(spikeJsonPath(repo.dir)), false, "no spike.json is written");
}

test("spike-config schema declares an optional string doc_path", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "contracts", "schemas", "spike-config.schema.json"), "utf8"));

  assert.equal(schema.properties.doc_path?.type, "string", "doc_path must be a string property");
  assert.ok(!schema.required.includes("doc_path"), "doc_path must stay optional");
});

test("spike-setup-copies-setup-into-spike-json", (t) => {
  const plugin = spikePlugin(t);
  const repo = spikeRunPastTypeGate(t);
  writeSpikeSetup(repo.dir);

  const r = pbFrom(plugin, repo, "spike", "setup");

  assert.equal(r.code, 0, `spike setup must succeed: ${r.stderr}`);
  const spike = JSON.parse(readFileSync(spikeJsonPath(repo.dir), "utf8"));
  assert.deepEqual(spike, { ...SPIKE_CONFIG, units: [{ id: "u1", name: "Probe", description: "Does the probe work?", execution: EXECUTION }] }, "spike.json holds the setup, with units reduced to id, name, description and execution");
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, spike: ".pairingbuddy/run/task/spike.json" }, "stdout names where the setup was recorded");
});
test("spike-setup-refuses-extra-arguments", (t) => {
  const plugin = spikePlugin(t);
  const repo = spikeRunPastTypeGate(t);
  writeSpikeSetup(repo.dir);

  const r = pbFrom(plugin, repo, "spike", "setup", "extra");

  assert.equal(r.code, 2, `an extra argument is a usage error, stdout ${r.stdout}, stderr ${r.stderr}`);
  assert.match(r.stderr, /usage: pb spike setup/, "stderr gives the usage");
  assert.equal(existsSync(spikeJsonPath(repo.dir)), false, "no spike.json is written");
});
describe("spike-setup-refuses-wrong-state", () => {
  test("spike-setup-refuses-not-spike", (t) => {
    const plugin = spikePlugin(t);
    const repo = spikeRunPastTypeGate(t, { taskType: "bug_fix" });
    writeSpikeSetup(repo.dir);

    const r = pbFrom(plugin, repo, "spike", "setup");

    assert.equal(r.code, 1, `spike setup refuses with exit 1, stdout ${r.stdout}, stderr ${r.stderr}`);
    assert.match(r.stderr, /spike tasks only, and this task is bug_fix/, "the refusal names that the verb is for spike tasks only");
    assert.equal(existsSync(spikeJsonPath(repo.dir)), false, "no spike.json is written");
  });

  test("spike-setup-refuses-before-type-gate", (t) => {
    const plugin = spikePlugin(t);
    const repo = spikeRunPastTypeGate(t);
    const ledgerPath = join(repo.dir, ".pairingbuddy", "run", "task", "ledger.json");
    const { "G:type": _typeGate, ...gates } = repo.ledger().gates;
    writeLedger(ledgerPath, { ...repo.ledger(), gates });
    writeSpikeSetup(repo.dir);

    const r = pbFrom(plugin, repo, "spike", "setup");

    assert.equal(r.code, 1, `spike setup refuses with exit 1, stdout ${r.stdout}, stderr ${r.stderr}`);
    assert.match(r.stderr, /G:type has not passed/, "the refusal says G:type has not passed");
    assert.equal(existsSync(spikeJsonPath(repo.dir)), false, "no spike.json is written");
  });

  test("spike-setup-refuses-when-already-set-up", (t) => {
    const plugin = spikePlugin(t);
    const repo = spikeRunPastTypeGate(t);
    writeSpikeSetup(repo.dir);
    const first = pbFrom(plugin, repo, "spike", "setup");
    assert.equal(first.code, 0, `the first spike setup must succeed: ${first.stderr}`);
    const spikePath = spikeJsonPath(repo.dir);
    const before = readFileSync(spikePath);
    writeSpikeSetup(repo.dir, { config: JSON.stringify({ ...SPIKE_CONFIG, goal: "Learn Y instead" }), questions: JSON.stringify({ units: [pendingUnit("Does the probe work?")] }) });

    const r = pbFrom(plugin, repo, "spike", "setup");

    assert.equal(r.code, 1, `spike setup refuses with exit 1, stdout ${r.stdout}, stderr ${r.stderr}`);
    assert.match(r.stderr, /already has its spike setup/, "the refusal says the run already has its spike setup");
    assert.deepEqual(readFileSync(spikePath), before, "spike.json is byte-for-byte unchanged");
  });
});
describe("spike-setup-keeps-old-run-open-refusals", () => {
  test("spike-setup-refuses-missing-or-unreadable-setup", async (t) => {
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
        assertSetupRefuses(st, plugin, { config: configText, questions: questionsText }, new RegExp(`\\.pairingbuddy/${file.replace(".", "\\.")}`));
      });
    }
  });
  test("spike-setup-refuses-bad-units", async (t) => {
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
        assertSetupRefuses(st, plugin, { config, questions: JSON.stringify({ units }) }, refusal);
      });
    }
  });
  test("spike-setup-refuses-bad-paths", async (t) => {
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
        assertSetupRefuses(st, plugin, { config, questions }, refusal);
      });
    }
  });
  test("spike-setup-accepts-code-location-edges", async (t) => {
    const plugin = spikePlugin(t);
    const questionsFor = (working_directory) => JSON.stringify({ units: [{ ...pendingUnit("Does it work?"), execution: { ...EXECUTION, working_directory } }] });
    const cases = [
      { label: "a code_location with a trailing slash and a working_directory under it", code_location: "spike/", working_directory: "spike/u1" },
      { label: "a working_directory equal to code_location", code_location: "spike", working_directory: "spike" },
    ];

    for (const { label, code_location, working_directory } of cases) {
      await t.test(label, (st) => {
        const repo = spikeRunPastTypeGate(st);
        writeSpikeSetup(repo.dir, { config: JSON.stringify({ ...SPIKE_CONFIG, code_location }), questions: questionsFor(working_directory) });

        const r = pbFrom(plugin, repo, "spike", "setup");

        assert.equal(r.code, 0, `spike setup accepts it: ${r.stderr}`);
        assert.equal(existsSync(spikeJsonPath(repo.dir)), true, "spike.json is written");
      });
    }
  });
});
test("next-action-names-setting-up-spike-and-pb-spike-setup", (t) => {
  const plugin = spikePlugin(t);
  const repo = spikeRunPastTypeGate(t);

  const r = pbFrom(plugin, repo, "status", "--action");

  assert.equal(r.code, 0, `status --action must succeed: ${r.stderr}`);
  const { action } = JSON.parse(r.stdout);
  assert.match(action, /setting-up-spike/, "the action names the setting-up-spike skill");
  assert.match(action, /node \S*pb\.mjs\S* spike setup/, "the action names the pb spike setup command in the pbCommand form");
  assert.doesNotMatch(action, /Start the workflow pairingbuddy:code-spike-unit/, "the action does not start the spike workflow before the setup");
});
test("next-action-starts-the-spike-workflow-once-the-setup-is-recorded", (t) => {
  const plugin = spikePlugin(t);
  const repo = spikeRunPastTypeGate(t);
  writeSpikeSetup(repo.dir);
  assert.equal(pbFrom(plugin, repo, "spike", "setup").code, 0, "the setup is recorded");

  const r = pbFrom(plugin, repo, "status", "--action");

  assert.equal(r.code, 0, `status --action must succeed: ${r.stderr}`);
  const { action } = JSON.parse(r.stdout);
  assert.match(action, /Start the workflow pairingbuddy:code-spike-unit/, "with spike.json in place the action starts the spike workflow");
  assert.doesNotMatch(action, /setting-up-spike/, "the action no longer asks for the setup");
});
test("next-action-does-not-ask-a-non-spike-task-for-a-spike-setup", (t) => {
  const plugin = spikePlugin(t);
  const repo = spikeRunPastTypeGate(t, { taskType: "bug_fix" });

  const r = pbFrom(plugin, repo, "status", "--action");

  assert.equal(r.code, 0, `status --action must succeed: ${r.stderr}`);
  const { action } = JSON.parse(r.stdout);
  assert.match(action, /Start the workflow pairingbuddy:code-scenarios/, "a bug_fix past G:type starts its first stage");
  assert.doesNotMatch(action, /setting-up-spike/, "a non-spike task is never asked for a spike setup");
});
test("spike-state-without-setup-points-at-pb-spike-setup", (t) => {
  const plugin = spikePlugin(t);
  const repo = makeRepo({ ledger: { taskType: "spike", stage: { name: "code-spike-unit", status: "active", runId: "wf_1", attempt: 1, startedAt: null } } });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));

  const r = pbFrom(plugin, repo, "spike", "state");

  assert.equal(r.code, 1, `spike state refuses with exit 1, stdout ${r.stdout}, stderr ${r.stderr}`);
  assert.match(r.stderr, /run pb spike setup first/, "the refusal says to run pb spike setup");
});
