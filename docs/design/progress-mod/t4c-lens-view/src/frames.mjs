// Writes the Task 86 review frames: the pane's lens block at three moments, wide and narrow.
// It replays the committed S4 fixture (mod/fixtures/replay/s4-rollback) up to a moment and draws the block with the
// same lensRound and lensLines the pane uses. The cap stop is the same run with five rollbacks put in, since no
// recorded run has reached the cap. Run from the repo root: node docs/design/progress-mod/t4c-lens-view/src/frames.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lensLines, lensRound } from "../../../../../shared-node/lens-round.mjs";
import contract from "../../../../../shared-node/stages-contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../../..");
const FIXTURE = join(ROOT, "mod/fixtures/replay/s4-rollback");
const OUT = join(HERE, "..");

// The fixture files are modules holding one JSON array after `export default`.
const load = (name) => {
  const text = readFileSync(join(FIXTURE, `${name}.ts`), "utf8");
  return JSON.parse(text.slice(text.indexOf("export default") + "export default".length));
};
const ledgers = load("ledger");
const spawns = load("spawns");
const calls = load("calls");

// t=0 of the recording, from the first snapshot with an active stage, as the replay rig works it out.
const first = ledgers.find(({ ledger }) => ledger.stage?.startedAt);
const epoch = Date.parse(first.ledger.stage.startedAt) - first.t * 1000;
const iso = (t) => new Date(epoch + t * 1000).toISOString();

// What the mod holds at second t: the newest ledger, the spawns seen (finished once their span ended) and the calls seen.
function at(t) {
  const ledger = ledgers.filter((row) => row.t <= t).at(-1).ledger;
  const seen = spawns
    .filter((s) => s.kind === "workflow_agent" && s.t <= t)
    .map((s) => ({ kind: "workflow_agent", name: s.name, startedAt: iso(s.t), agentId: s.id, finished: s.t + s.seconds <= t }));
  const made = calls.filter((c) => c.t <= t).map((c) => ({ agentId: c.agentId, at: iso(c.t), input: c.input }));
  return { ledger, spawns: seen, calls: made };
}

// Five rolled-back fixes and the stop the CLI writes at the cap.
function atCap(t) {
  const state = at(t);
  const rollbacks = [2, 3, 4, 5, 6].map((round, i) => ({ key: `code-safety-net.fix.g${i < 2 ? 1 : i}.r${round}.a1`, kind: i % 2 ? "repeated" : "red", ref: null, sha: null, base: null }));
  const ledger = { ...state.ledger, fixes: { rollbacks }, stop: { code: "attempt-cap", reason: "attempt-cap: stage code-safety-net rolled back 5 fix attempts, its cap of 5", seq: 99 } };
  const fixSpawns = rollbacks.map(({ key }) => {
    const [, , group, round] = key.split(".");
    return { kind: "workflow_agent", name: `pb1 code-safety-net - fix ${group} ${round}`, startedAt: iso(t), finished: true };
  });
  const keep = state.spawns.filter((s) => !/ (fix|course-checker) /.test(s.name));
  const keepCalls = state.calls.filter((c) => !/\.(fix|course-checker)\./.test(c.input.pb_key));
  return { ledger, spawns: [...keep, ...fixSpawns], calls: keepCalls };
}

// The same lens round with one lens that finished without a usable answer, which the recording never had.
function withUncovered(t) {
  const state = at(t);
  return { ...state, calls: state.calls.filter((c) => !c.input.pb_key.includes(".corpus-misalignment")) };
}

// A frame is the block inside a box `columns` wide, the way the pane body is that wide.
function frame(title, state, columns) {
  const lines = lensLines(lensRound({ ...state, contract }), columns);
  const rule = "─".repeat(columns + 2);
  const body = lines.map(({ text, tone }) => `│ ${text.padEnd(columns)} │${tone ? `  (${tone})` : ""}`);
  return [title, `┌${rule}┐`, ...body, `└${rule}┘`, ""].join("\n");
}

const MOMENTS = [
  ["1-lens-round", "the lenses have returned and the refuters are attacking their findings", () => at(136.5)],
  ["2-rollback", "the first fix turned the tests red and was undone; its retry is running", () => at(158)],
  ["3-kept-fixes", "later fixes were checked and kept; the round is about to end", () => at(201)],
  ["4-uncovered", "one lens finished without a usable answer (its answer taken out by hand)", () => withUncovered(136.5)],
  ["5-cap-stop", "five fixes were undone, so the run stopped at the cap (fixes put in by hand)", () => atCap(201)],
];

mkdirSync(OUT, { recursive: true });
for (const [name, what, state] of MOMENTS) {
  for (const columns of [140, 60]) {
    writeFileSync(join(OUT, `${name}-${columns}.txt`), frame(`${name} at ${columns} columns: ${what}`, state(), columns));
  }
}
console.log(`wrote ${MOMENTS.length * 2} frames to ${OUT}`);
