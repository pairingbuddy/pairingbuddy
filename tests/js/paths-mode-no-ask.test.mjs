import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// R4 and Section 7: no human is reachable from a stage, so an agent the new path calls never asks when given paths,
// while its legacy branch (no paths) still reads and writes flat files and asks as before, for the old callers.
// This reads what the agents are told, never what a run returned.
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const STAGES = readdirSync(new URL("../../workflows-src/stages/", import.meta.url)).map((f) => `workflows-src/stages/${f}`);
const SOURCES = [...STAGES, "workflows-src/shared/stage-steps.mjs"].map(read).join("\n");
const AGENT_FILES = new Set(readdirSync(new URL("../../agents/", import.meta.url)));

// Every agent a stage spawns, by its agentType literal or the role name the stage builds the agentType from.
const NEW_PATH_AGENTS = [
  ...new Set(
    [...SOURCES.matchAll(/pairingbuddy:([a-z][a-z-]*)'|(?:role|finder|fixer)(?::| =) '([a-z][a-z-]*)'/g)]
      .map((m) => m[1] ?? m[2])
      .filter((name) => AGENT_FILES.has(`${name}.md`)),
  ),
].sort();

const CONFIG = read("contracts/agent-config.yaml");
const STEP3 = /\nworkflow_step3_human_review:\n {2}content: \|\n([\s\S]*?)\n\S/.exec(CONFIG)[1].replace(/^ {4}/gm, "").trim();

const PATHS_LINE = /^With a `<paths>` block/;
const ASKS = /AskUserQuestion|\bask(?:s|ed|ing)?\b/i;
const ASK_COVER = "where the steps below say to ask the human, do not guess";

const textOf = (name) => read(`agents/${name}.md`);
const isLegacyAgent = (text) => text.includes("With no `<paths>` block: use the legacy flat files below and write the legacy Output");

// The lines of a document, each with the `## ` section and `### ` step it sits in.
function placed(text) {
  let section = "";
  let step = "";
  let fence = false;
  return text.split("\n").map((line) => {
    if (line.startsWith("```")) fence = !fence;
    if (!fence && line.startsWith("## ")) [section, step] = [line, ""];
    else if (!fence && line.startsWith("### ")) step = line;
    return { line, section, step };
  });
}

const stepBody = (lines, step) => lines.filter((l) => l.step === step && l.line !== step).map((l) => l.line);
const firstParagraph = (lines) => lines.join("\n").trim().split("\n\n")[0];

// A line mentioning asking is covered under paths when its step is skipped under paths, or when an earlier paths line
// of its section tells the agent not to ask.
function uncoveredAsks(text) {
  const lines = placed(text);
  const skipped = (step) => step && /^With a `<paths>` block: skip Step \d\b/.test(firstParagraph(stepBody(lines, step)));
  return lines
    .map((l, i) => ({ ...l, i }))
    .filter(({ line }) => ASKS.test(line) && !PATHS_LINE.test(line))
    .filter(({ section, step, i }) => {
      if (skipped(step)) return false;
      const before = lines.slice(0, i).filter((l) => l.section === section && PATHS_LINE.test(l.line));
      return !before.some((l) => l.line.includes(ASK_COVER));
    })
    .map(({ line }) => line.trim());
}

test("the new path calls the agents migrated so far", () => {
  for (const name of ["enumerate-scenarios-and-test-cases", "implement-code", "verify-test-coverage", "update-documentation", "runner"]) {
    assert.ok(NEW_PATH_AGENTS.includes(name), `${name} is found as a stage's agent`);
  }
});

for (const name of NEW_PATH_AGENTS) {
  test(`${name}: with paths no instruction to ask a human is reachable`, () => {
    assert.deepEqual(uncoveredAsks(textOf(name)), []);
  });

  test(`${name}: a Human Review step is skipped with paths, and kept whole for the legacy branch`, () => {
    const text = textOf(name);
    const lines = placed(text);
    const step3 = lines.find((l) => l.line.startsWith("### Step 3: Human Review"))?.line;
    if (!step3) {
      assert.ok(!text.includes("AskUserQuestion"), "AskUserQuestion appears only inside a Human Review step");
      return;
    }
    const body = stepBody(lines, step3);

    assert.match(firstParagraph(body), /^With a `<paths>` block: skip Step 3\./);
    assert.ok(body.join("\n").includes(STEP3), "the legacy branch still asks as before");
    assert.ok(text.includes("\n## Solo Mode\n"), "the legacy branch keeps its Solo Mode");
    const outside = lines.filter((l) => l.step !== step3 && l.line.includes("AskUserQuestion"));
    assert.deepEqual(outside, [], "AskUserQuestion appears only inside the Human Review step");
  });

  test(`${name}: takes its input from the prompt, and keeps a legacy branch only beside a paths branch`, () => {
    const text = textOf(name);
    const input = text.slice(text.indexOf("\n## Input\n"), text.indexOf("\n## Instructions\n"));

    if (isLegacyAgent(text)) {
      assert.match(input, /With a `<paths>` block in the prompt: read only what the paths name/);
      assert.match(input, /`pb_key`/);
    } else {
      assert.match(input, /The prompt contains:/, "a new-path-only agent reads nothing but its prompt");
      assert.ok(!text.includes(".pairingbuddy/"), "a new-path-only agent names no flat state file");
    }
  });
}

test("every agent that still has a legacy caller keeps its legacy branch", () => {
  const legacy = NEW_PATH_AGENTS.filter((name) => isLegacyAgent(textOf(name)));

  assert.deepEqual(
    legacy,
    [
      "create-test-placeholders",
      "enumerate-scenarios-and-test-cases",
      "implement-code",
      "implement-tests",
      "refactor-code",
      "refactor-tests",
      "scope-refactoring",
      "update-documentation",
      "verify-test-coverage",
    ],
  );
});
