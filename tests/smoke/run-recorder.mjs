// Test tooling only. Saves spawn events, ledger snapshots, what `pb task end` printed and timing from a real run, for the T4a replay rig (S8).
// It sits outside the run: a timer reads the ledger, the smoke harness hands it stream lines, and it writes only to its
// own directory. No hook, CLI verb or workflow loads it, so a run cannot tell it is there.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const PLANS = join(REPO_ROOT, "docs", "plans");
const POLL_MS = 20;
const TRANSCRIPT_DIR = /Transcript dir: (\/[^\n"'\\]+)/g;
const SPAWN_TOOLS = { Skill: "skill", Agent: "subagent_type", Workflow: "name" };

export function assertOutsidePlans(out) {
  const path = resolve(REPO_ROOT, out);
  if (path === PLANS || path.startsWith(PLANS + sep)) throw new Error(`recordings stay outside docs/plans, not at ${out}`);
}

const toolUses = (event) => (event.type === "assistant" ? event.message.content.filter((block) => block.type === "tool_use") : []);

const TASK_NAMES = { task_started: "description", task_progress: "description", task_notification: "status" };

function taskEvent({ t, event }) {
  if (event.type !== "system" || !Object.hasOwn(TASK_NAMES, event.subtype)) return [];
  return [{ t, kind: event.subtype, name: event[TASK_NAMES[event.subtype]], id: event.task_id }];
}

function toolEvents({ t, event }) {
  return toolUses(event).filter(({ name }) => Object.hasOwn(SPAWN_TOOLS, name)).map(({ name, input }) => ({ t, kind: name, name: input[SPAWN_TOOLS[name]] }));
}

export const spawnEvents = (stream) => stream.flatMap((line) => [...toolEvents(line), ...taskEvent(line)]);

function readAgent(dir, file, startedAt) {
  const id = file.slice("agent-".length, -".meta.json".length);
  try {
    const { agentType, description, workflowPhase } = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const lines = readFileSync(join(dir, `agent-${id}.jsonl`), "utf8").trim().split("\n");
    const [first, last] = [lines[0], lines.at(-1)].map((line) => Date.parse(JSON.parse(line).timestamp));
    return [{ t: (first - startedAt) / 1000, kind: "workflow_agent", name: description, id, agentType, phase: workflowPhase, seconds: (last - first) / 1000 }];
  } catch {
    return [];
  }
}

// The agents a workflow spawns never reach the stream: their transcripts hold the label and the span.
export function workflowAgents(dirs, startedAt) {
  return dirs.filter((dir) => existsSync(dir)).flatMap((dir) => readdirSync(dir).filter((file) => /^agent-.*\.meta\.json$/.test(file)).flatMap((file) => readAgent(dir, file, startedAt)));
}

const transcriptDirs = (stream) => [...new Set(stream.flatMap(({ event }) => [...JSON.stringify(event).matchAll(TRANSCRIPT_DIR)].map(([, dir]) => dir)))];

// The call that ends the task. Its output is the only place a leftover file shows, since a refusal leaves the ledger as it was.
const TASK_END = /\bpb(?:\.mjs)?["']?\s+task end\b/;

const textOf = (content) => (typeof content === "string" ? content : content.filter(({ type }) => type === "text").map(({ text }) => text).join(""));

const toolResults = (event) => (event.type === "user" && Array.isArray(event.message?.content) ? event.message.content.filter((block) => block.type === "tool_result") : []);

const jsonl = (rows) => rows.map((row) => `${JSON.stringify(row)}\n`).join("");

export class RunRecorder {
  constructor(repo, out, { intervalMs = POLL_MS, now = Date.now, streamPath = null } = {}) {
    assertOutsidePlans(out);
    this.ledgerPath = join(repo, ".pairingbuddy", "run", "task", "ledger.json");
    this.out = out;
    this.intervalMs = intervalMs;
    this.now = now;
    this.streamPath = streamPath;
    this.last = null;
    this.snapshots = [];
    this.stream = [];
    this.stageStarted = {};
    this.stageEnded = {};
    this.taskEndCalls = new Map();
    this.taskEnds = [];
  }

  seconds() {
    return (this.now() - this.startedAt) / 1000;
  }

  start() {
    mkdirSync(this.out, { recursive: true });
    this.startedAt = this.now();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    return this;
  }

  // A torn read or a ledger that has gone is simply not a snapshot.
  poll() {
    let ledger;
    try {
      ledger = JSON.parse(readFileSync(this.ledgerPath, "utf8"));
    } catch {
      return;
    }
    if (ledger.seq === this.last?.seq) return;
    this.last = ledger;
    this.snapshots.push(ledger);
    const t = this.seconds();
    appendFileSync(join(this.out, "ledger.jsonl"), jsonl([{ t, ledger }]));
    this.noteStage(ledger.stage, t);
  }

  noteStage({ name, status }, t) {
    if (!name) return;
    this.stageStarted[name] ??= t;
    if (status === "done") this.stageEnded[name] ??= t;
  }

  line(event) {
    const row = { t: this.seconds(), event };
    this.stream.push(row);
    this.noteTaskEnd(row);
    if (this.streamPath === null) return;
    mkdirSync(dirname(this.streamPath), { recursive: true });
    appendFileSync(this.streamPath, jsonl([row]));
  }

  noteTaskEnd({ t, event }) {
    for (const { id, name, input } of toolUses(event)) if (name === "Bash" && TASK_END.test(input.command ?? "")) this.taskEndCalls.set(id, input.command);
    for (const { tool_use_id: id, content, is_error: isError } of toolResults(event)) {
      if (this.taskEndCalls.has(id)) this.taskEnds.push({ t, command: this.taskEndCalls.get(id), output: textOf(content ?? ""), isError: isError === true });
    }
  }

  spawns() {
    return [...spawnEvents(this.stream), ...workflowAgents(transcriptDirs(this.stream), this.startedAt)].sort((a, b) => a.t - b.t);
  }

  stop() {
    clearInterval(this.timer);
    const stageSeconds = Object.fromEntries(Object.keys(this.stageEnded).map((name) => [name, Number((this.stageEnded[name] - this.stageStarted[name]).toFixed(3))]));
    writeFileSync(join(this.out, "spawns.jsonl"), jsonl(this.spawns()));
    writeFileSync(join(this.out, "task-end.jsonl"), jsonl(this.taskEnds));
    writeFileSync(join(this.out, "timing.json"), JSON.stringify({ seconds: this.seconds(), stageSeconds }));
  }
}
