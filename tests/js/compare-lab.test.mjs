// The deterministic parts of tests/smoke/compare-lab.mjs: arguments, the child environment and argv, result and
// transcript parsing, the blind mapping, the verdict, the summary, and a lab setup with stand-in plugin dirs.
import "./isolated-tmpdir.mjs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const lab = await import("../smoke/compare-lab.mjs");
const { CRITERIA, LabError, UsageError } = lab;

const tempDir = (prefix) => realpathSync(mkdtempSync(join(tmpdir(), prefix)));
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const fakeLab = (over = {}) => ({
  task: "Add free_slots",
  model: "sonnet",
  tiers: "same",
  permissionMode: "bypassPermissions",
  budgetUsd: 25,
  sides: Object.fromEntries(["old", "new"].map((side) => [side, { plugin: { dir: `/plugins/${side}` }, shim: { dir: `/shim/${side}`, log: `/shim/${side}/gh.log`, opened: `/shim/${side}/opened.json` } }])),
  ...over,
});

describe("compare-lab-args", () => {
  it("gives setup its defaults", () => {
    const { command, options } = lab.parseArgs(["setup"]);
    assert.equal(command, "setup");
    assert.equal(options.model, "sonnet");
    assert.equal(options.tiers, "same");
    assert.equal(options.permissionMode, "bypassPermissions");
    assert.equal(options.oldRef, "v0.7.0");
  });

  it("reads setup flags and numbers", () => {
    const { options } = lab.parseArgs(["all", "--model", "opus", "--budget-usd", "7.5", "--timeout-min", "30", "--tiers", "native", "--new-plugin", "/x"]);
    assert.deepEqual([options.model, options.budgetUsd, options.timeoutMin, options.tiers, options.newPlugin], ["opus", 7.5, 30, "native", "/x"]);
  });

  it("takes a resume cap at setup, and a side to reset", () => {
    assert.equal(lab.parseArgs(["setup"]).options.maxResumes, 30);
    assert.equal(lab.parseArgs(["setup", "--max-resumes", "4"]).options.maxResumes, 4);
    assert.deepEqual(lab.parseArgs(["reset", "new", "--lab", "/l"]), { command: "reset", side: "new", options: { lab: "/l" } });
    assert.throws(() => lab.parseArgs(["reset"]), UsageError);
  });

  it("takes a side for run, and --lab", () => {
    assert.deepEqual(lab.parseArgs(["run", "both", "--lab", "/l"]), { command: "run", side: "both", options: { lab: "/l" } });
    assert.equal(lab.parseArgs(["run", "old"]).side, "old");
  });

  it("refuses what it does not know", () => {
    for (const argv of [[], ["go"], ["run"], ["run", "mid"], ["run", "new", "--model", "opus"], ["setup", "--budget-usd", "0"], ["setup", "--tiers", "few"], ["setup", "--model"], ["setup", "--permission-mode", "yolo"], ["judge", "--lab"]]) {
      assert.throws(() => lab.parseArgs(argv), UsageError, argv.join(" "));
    }
  });

  it("maps model aliases to ids and keeps a full id", () => {
    assert.equal(lab.modelId("sonnet"), "claude-sonnet-5-5");
    assert.equal(lab.modelId("claude-opus-5-5"), "claude-opus-5-5");
  });
});

describe("compare-lab-env", () => {
  const inherited = { HOME: "/h", PATH: "/bin", PAIRINGBUDDY_SOLO: "false", PB_X: "1", CLAUDECODE: "1", ANTHROPIC_MODEL: "opus", GIT_DIR: "/g" };

  it("refuses to run with ANTHROPIC_API_KEY set", () => {
    assert.throws(() => lab.runEnv("new", fakeLab(), { ...inherited, ANTHROPIC_API_KEY: "sk" }), LabError);
    assert.throws(() => lab.refuseApiKey({ ANTHROPIC_API_KEY: "" }), LabError);
  });

  it("drops inherited policy, session, auth and git variables", () => {
    const env = lab.runEnv("new", fakeLab(), inherited);
    for (const name of ["PB_X", "CLAUDECODE", "ANTHROPIC_MODEL", "GIT_DIR", "ANTHROPIC_API_KEY"]) assert.equal(env[name], undefined, name);
    assert.equal(env.HOME, "/h");
  });

  it("puts the side's gh shim first on PATH", () => {
    const env = lab.runEnv("old", fakeLab(), inherited);
    assert.equal(env.PATH, "/shim/old:/bin");
    assert.equal(env.GH_SHIM_LOG, "/shim/old/gh.log");
  });

  it("runs old in Solo mode and new under the auto gate policy", () => {
    const old = lab.runEnv("old", fakeLab(), inherited);
    const neu = lab.runEnv("new", fakeLab(), inherited);
    assert.equal(old.PAIRINGBUDDY_SOLO, "true");
    assert.equal(old.PAIRINGBUDDY_GATE_POLICY, undefined);
    assert.equal(neu.PAIRINGBUDDY_GATE_POLICY, "auto");
    assert.equal(neu.PAIRINGBUDDY_SOLO, undefined);
  });

  it("puts every model tier on the one model under same tiers, and none under native", () => {
    const same = lab.runEnv("new", fakeLab(), inherited);
    for (const tier of ["OPUS", "SONNET", "HAIKU"]) assert.equal(same[`ANTHROPIC_DEFAULT_${tier}_MODEL`], "claude-sonnet-5-5");
    const native = lab.runEnv("new", fakeLab({ tiers: "native" }), inherited);
    assert.equal(native.ANTHROPIC_DEFAULT_OPUS_MODEL, undefined);
  });

  it("lets claude -p wait for background workflows on both sides, whatever was inherited", () => {
    for (const side of ["old", "new"]) assert.equal(lab.runEnv(side, fakeLab(), { ...inherited, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "600000" }).CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, "0");
  });

  it("resumes a session with the same flags, a continue prompt and what is left of the budget", () => {
    const flag = (argv, name) => argv[argv.indexOf(name) + 1];
    const first = lab.runArgs("new", fakeLab());
    const again = lab.runArgs("new", fakeLab(), { resume: "sid-1", prompt: "Go on.", budgetUsd: 21.5 });
    assert.equal(first.includes("--resume"), false);
    assert.equal(flag(again, "--resume"), "sid-1");
    assert.equal(flag(again, "-p"), "Go on.");
    assert.equal(flag(again, "--max-budget-usd"), "21.5");
    for (const name of ["--output-format", "--model", "--plugin-dir", "--setting-sources", "--permission-mode"]) assert.equal(flag(again, name), flag(first, name), name);
    assert.ok(again.includes("--strict-mcp-config"));
  });

  it("gives both sides the same claude flags but their own plugin", () => {
    const flag = (argv, name) => argv[argv.indexOf(name) + 1];
    const old = lab.runArgs("old", fakeLab());
    const neu = lab.runArgs("new", fakeLab());
    assert.equal(flag(old, "-p"), "/pairingbuddy:code Add free_slots");
    const tools = JSON.parse(readFileSync(new URL("../smoke/session-tools.json", import.meta.url), "utf8")).join(",");
    assert.match(tools, /\bGlob\b.*\bGrep\b/, "the sessions have Glob and Grep, which the tool rule names");
    for (const [name, value] of [["--output-format", "json"], ["--model", "claude-sonnet-5-5"], ["--permission-mode", "bypassPermissions"], ["--setting-sources", "project,local"], ["--max-budget-usd", "25"], ["--tools", tools]]) {
      assert.equal(flag(old, name), value, name);
      assert.equal(flag(neu, name), value, name);
    }
    assert.equal(flag(old, "--plugin-dir"), "/plugins/old");
    assert.equal(flag(neu, "--plugin-dir"), "/plugins/new");
  });
});

const SAMPLE_RESULT = {
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 812345,
  duration_api_ms: 700000,
  num_turns: 42,
  result: "Done.",
  session_id: "11111111-2222-3333-4444-555555555555",
  total_cost_usd: 3.21,
  usage: { input_tokens: 10, cache_creation_input_tokens: 2000, cache_read_input_tokens: 90000, output_tokens: 5000 },
  modelUsage: { "claude-sonnet-5-5": { inputTokens: 10, outputTokens: 5000, costUSD: 3.21 } },
  permission_denials: [{ tool_name: "AskUserQuestion" }],
};

describe("compare-lab-result", () => {
  it("parses a claude -p json result", () => {
    const parsed = lab.parseRunResult(JSON.stringify(SAMPLE_RESULT));
    assert.equal(parsed.durationMs, 812345);
    assert.equal(parsed.numTurns, 42);
    assert.equal(parsed.costUsd, 3.21);
    assert.equal(parsed.sessionId, SAMPLE_RESULT.session_id);
    assert.equal(parsed.permissionDenials, 1);
    assert.equal(parsed.isError, false);
    assert.deepEqual(parsed.modelUsage, SAMPLE_RESULT.modelUsage);
  });

  it("finds the result after other lines, and gives null with none", () => {
    assert.equal(lab.parseRunResult(`warning\n${JSON.stringify(SAMPLE_RESULT)}\n`).numTurns, 42);
    assert.equal(lab.parseRunResult("not json\n{\"type\":\"system\"}"), null);
    assert.equal(lab.parseRunResult(""), null);
  });
});

const assistant = (id, model, usage) => JSON.stringify({ type: "assistant", uuid: `u-${id}`, message: { id, model, usage } });
const u = (input, output, cacheRead = 0, cacheCreation = 0) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreation });

describe("compare-lab-transcripts", () => {
  it("sums usage once per message id, by model, skipping synthetic messages", () => {
    const main = [assistant("m1", "claude-sonnet-5-5", u(1, 10, 100, 5)), assistant("m1", "claude-sonnet-5-5", u(1, 12, 100, 5)), JSON.stringify({ type: "user" }), "garbage"].join("\n");
    const agent = [assistant("m2", "claude-haiku-5-5", u(2, 20, 200)), assistant("s", "<synthetic>", u(0, 99))].join("\n");
    const { total, byModel } = lab.sumTranscripts([main, agent]);
    assert.deepEqual(total, { input: 3, output: 32, cacheRead: 300, cacheCreation: 5, messages: 2 });
    assert.equal(byModel["claude-sonnet-5-5"].output, 12);
    assert.equal(byModel["claude-haiku-5-5"].messages, 1);
    assert.equal(byModel["<synthetic>"], undefined);
  });

  it("finds a session's transcript, its subagents and workflow agents, but not the journal", () => {
    const projects = tempDir("cl-projects-");
    const sid = "abc";
    const folder = join(projects, "-some-repo");
    mkdirSync(join(folder, sid, "subagents", "workflows", "wf_1"), { recursive: true });
    writeFileSync(join(folder, `${sid}.jsonl`), assistant("a", "m", u(1, 1)));
    writeFileSync(join(folder, sid, "subagents", "agent-x.jsonl"), assistant("b", "m", u(1, 1)));
    writeFileSync(join(folder, sid, "subagents", "workflows", "wf_1", "agent-y.jsonl"), assistant("c", "m", u(1, 1)));
    writeFileSync(join(folder, sid, "subagents", "workflows", "wf_1", "journal.jsonl"), "{}");
    writeFileSync(join(folder, "other.jsonl"), assistant("d", "m", u(1, 1)));
    const usage = lab.transcriptUsage({ sessionId: sid, projects });
    assert.equal(usage.files, 3);
    assert.equal(usage.agentFiles, 2);
    assert.equal(usage.total.messages, 3);
  });

  it("with no session id, reads the repo's project folder", () => {
    const projects = tempDir("cl-projects-");
    const repo = tempDir("cl-repo.x_");
    mkdirSync(join(projects, lab.projectFolderName(repo)));
    writeFileSync(join(projects, lab.projectFolderName(repo), "s.jsonl"), assistant("a", "m", u(1, 1)));
    assert.equal(lab.transcriptUsage({ sessionId: null, repo, projects }).files, 1);
    assert.match(lab.projectFolderName("/a/b.c_d"), /^-a-b-c-d$/);
  });
});

const score = (n) => Object.fromEntries(CRITERIA.map((c) => [c, { score: n, reason: `${c} reason ${n}` }]));
const VERDICT = { A: score(8), B: score(6), preferred: "A", summary: "A handles touching bookings." };

describe("compare-lab-blind", () => {
  it("maps A and B to old and new in either order", () => {
    assert.deepEqual(lab.blindMapping(() => 0.1), { A: "old", B: "new" });
    assert.deepEqual(lab.blindMapping(() => 0.9), { A: "new", B: "old" });
  });

  it("unblinds scores and the preference", () => {
    const { scores, preferred } = lab.unblind(VERDICT, { A: "new", B: "old" });
    assert.equal(scores.new.total, 32);
    assert.equal(scores.old.total, 24);
    assert.equal(scores.new.label, "A");
    assert.equal(preferred, "new");
    assert.equal(lab.unblind({ ...VERDICT, preferred: "tie" }, { A: "new", B: "old" }).preferred, "tie");
  });

  it("reads the verdict from structured output or from fenced text, and refuses a bad one", () => {
    assert.deepEqual(lab.parseVerdict({ structuredOutput: VERDICT }), VERDICT);
    assert.deepEqual(lab.parseVerdict({ structuredOutput: null, resultText: "```json\n" + JSON.stringify(VERDICT) + "\n```" }), VERDICT);
    assert.throws(() => lab.parseVerdict({ structuredOutput: null, resultText: "no idea" }), LabError);
    assert.throws(() => lab.parseVerdict({ structuredOutput: { ...VERDICT, preferred: "C" } }), LabError);
  });

  it("puts both diffs in the judge prompt under their labels only", () => {
    const prompt = lab.judgePrompt({ task: "T", baseFiles: { "schedule.py": "def f(): pass\n" }, diffA: "+a line", diffB: "", testsA: { parsed: true, passed: 9, failed: 0, errors: 0, exitCode: 0 }, testsB: { parsed: false, exitCode: 2 } });
    assert.match(prompt, /<solution_A tests="9 passed, 0 failed, 0 errors \(exit 0\)">\n\+a line/);
    assert.match(prompt, /<solution_B tests="no pytest summary \(exit 2\)">\n\(no changes\)/);
    assert.doesNotMatch(prompt, /\b(old|new|v0\.7|Pairing Buddy)\b/i);
  });

  it("asks the judge for every criterion of both labels", () => {
    assert.deepEqual(lab.JUDGE_SCHEMA.properties.A.required, CRITERIA);
    const argv = lab.judgeArgs(fakeLab());
    assert.equal(argv[argv.indexOf("--tools") + 1], "");
    assert.equal(argv[argv.indexOf("--model") + 1], "claude-sonnet-5-5");
  });
});

describe("compare-lab-pytest", () => {
  it("reads pytest's summary line", () => {
    assert.deepEqual(lab.parsePytestSummary("....F\nFAILED x\n1 failed, 4 passed in 0.12s\n"), { passed: 4, failed: 1, errors: 0, skipped: 0, parsed: true });
    assert.deepEqual(lab.parsePytestSummary("3 passed, 1 skipped, 2 errors in 1.0s"), { passed: 3, failed: 0, errors: 2, skipped: 1, parsed: true });
    assert.equal(lab.parsePytestSummary("command not found").parsed, false);
  });
});

const RESULTS = {
  lab: "/labs/x",
  task: "Add free_slots",
  model: "claude-sonnet-5-5",
  tiers: "same",
  permissionMode: "bypassPermissions",
  budgetUsd: 25,
  sides: {
    old: { plugin: { ref: "v0.7.0", sha: "1096ccfd07" }, run: { wallMs: 1_200_000, exitCode: 0, timedOut: false, result: lab.parseRunResult(JSON.stringify(SAMPLE_RESULT)), transcript: { files: 7, agentFiles: 6, total: { input: 10, output: 6000, cacheRead: 1_000_000, cacheCreation: 50_000, messages: 120 } } }, outcome: { end: { state: "completed", finished: true, waitingForHuman: false, reason: "the Solo report's status is completed" }, stats: { files: ["schedule.py", "tests/test_schedule.py"], insertions: 80, deletions: 2 }, commits: ["abc feat: free slots"], tests: { parsed: true, passed: 10, failed: 0, errors: 0, exitCode: 0 } } },
    new: { plugin: { dir: "/bnew", sha: "08d1531c3c" }, run: null, outcome: null },
  },
  judge: { mapping: { A: "new", B: "old" }, verdict: VERDICT, ...lab.unblind(VERDICT, { A: "new", B: "old" }), costUsd: 0.12 },
};

describe("compare-lab-summary", () => {
  const md = lab.renderSummary(RESULTS);

  it("shows the run numbers side by side", () => {
    assert.match(md, /\| wall time \| 20\.0 min \| - \|/);
    assert.match(md, /\| cost \(claude\) \| \$3\.21 \| - \|/);
    assert.match(md, /\| output tokens \| 6,000 \| - \|/);
    assert.match(md, /\| tests after \| 10 passed, 0 failed, 0 errors \| - \|/);
    assert.match(md, /\| finished \| yes: the Solo report's status is completed \| not run \|/);
    assert.match(md, /\| API time \(claude\) \| 11\.7 min \| - \|/);
    assert.match(md, /\| claude -p invocations \| 1 \| - \|/);
  });

  const withNew = (run, outcome = null) => lab.renderSummary({ ...RESULTS, sides: { ...RESULTS.sides, new: { ...RESULTS.sides.new, run: { ...RESULTS.sides.old.run, ...run }, outcome } } });

  it("shows the new side's real end, not its exit code", () => {
    const waiting = { state: "needs-human", finished: false, waitingForHuman: true, reason: "G:coverage: a coverage gap" };
    assert.match(withNew({ end: waiting, loop: { invocations: 2, stoppedBecause: "waiting for a human: G:coverage: a coverage gap" } }), /\| finished \| yes: [^|]+ \| no, waiting for a human: G:coverage: a coverage gap \|/);
    const running = { state: "running", finished: false, waitingForHuman: false, reason: "stage code-tdd is still active" };
    assert.match(withNew({ end: running, loop: { invocations: 31, stoppedBecause: "the resume cap (30) was reached" } }), /\| no: the resume cap \(30\) was reached; stage code-tdd is still active \|/);
  });

  it("prefers the end the judge read over the one the run read", () => {
    const judged = { end: { state: "ended", finished: true, waitingForHuman: false, reason: "the task ended and the PR was opened: u" }, stats: { files: [], insertions: 0, deletions: 0 }, commits: [], tests: { parsed: false, exitCode: 0 } };
    assert.match(withNew({ end: { state: "running", finished: false, reason: "r" } }, judged), /\| yes: the task ended and the PR was opened: u \|$/m);
  });

  it("says an older run's exit code alone is no end state", () => {
    assert.match(withNew({ end: undefined }), /\| exit 0, end not read \|$/m);
  });

  it("puts each side's unblinded judge scores in its own column", () => {
    assert.match(md, /\| judge: correctness \| 6 \| 8 \|/);
    assert.match(md, /\| judge: total \(of 40\) \| 24 \| 32 \|/);
  });

  it("gives the blind reasons by label and unblinds at the end", () => {
    const blind = md.indexOf("## Blind judge");
    const unblinded = md.indexOf("## Unblinded");
    assert.ok(blind > 0 && unblinded > blind);
    const blindPart = md.slice(blind, unblinded);
    assert.match(blindPart, /### A[\s\S]*correctness 8: correctness reason 8/);
    assert.doesNotMatch(blindPart, /\b(old|new)\b/);
    assert.match(md.slice(unblinded), /A was new, B was old\. Preferred: new\./);
  });

  it("says when there is no verdict yet", () => {
    assert.match(lab.renderSummary({ ...RESULTS, judge: null }), /No judge verdict yet\./);
  });
});

describe("compare-lab-setup", () => {
  const plugins = () => {
    const root = tempDir("cl-plugins-");
    for (const side of ["old", "new"]) mkdirSync(join(root, side));
    return root;
  };

  it("makes two repos from one commit, each with a bare origin and its own gh shim", () => {
    const p = plugins();
    const made = lab.setupLab({ root: tempDir("cl-labs-"), oldPlugin: join(p, "old"), newPlugin: join(p, "new"), now: new Date(2026, 10, 20, 9, 0, 0) });
    const { old, new: neu } = made.sides;
    assert.equal(old.startCommit, neu.startCommit);
    assert.notEqual(old.repo, neu.repo);
    for (const side of [old, neu]) {
      assert.equal(git(side.repo, "rev-parse", "HEAD"), side.startCommit);
      assert.equal(git(side.repo, "branch", "--show-current"), "main");
      assert.equal(git(side.origin, "rev-parse", "main"), side.startCommit);
      assert.deepEqual(git(side.repo, "ls-files").split("\n"), [".gitignore", "pytest.ini", "schedule.py", "tests/test_schedule.py"]);
      assert.match(readFileSync(join(side.shim.dir, "gh"), "utf8"), /gh\.mjs/);
    }
    assert.equal(made.task, readFileSync(join(lab.FIXTURE, "task.txt"), "utf8").trim());
    assert.deepEqual(lab.readLab(made.dir).sides.new.plugin.dir, realpathSync(join(p, "new")));
  });

  it("gives each build a test config its schema takes", () => {
    const p = plugins();
    const made = lab.setupLab({ root: tempDir("cl-labs-"), oldPlugin: join(p, "old"), newPlugin: join(p, "new") });
    const config = (side) => JSON.parse(readFileSync(join(made.sides[side].repo, ".pairingbuddy", "test-config.json"), "utf8")).runners.pytest;
    assert.equal(config("old").selector_template, undefined);
    assert.deepEqual(config("new").selector_template, ["{test_file}::{test_function}"]);
  });

  it("refuses a lab inside the new plugin", () => {
    const p = plugins();
    assert.throws(() => lab.setupLab({ root: join(p, "new", "labs"), oldPlugin: join(p, "old"), newPlugin: join(p, "new") }), LabError);
  });

  it("finds the latest lab", () => {
    const p = plugins();
    const root = tempDir("cl-labs-");
    lab.setupLab({ root, oldPlugin: join(p, "old"), newPlugin: join(p, "new"), now: new Date(2026, 0, 1) });
    const later = lab.setupLab({ root, oldPlugin: join(p, "old"), newPlugin: join(p, "new"), now: new Date(2026, 0, 2) });
    assert.equal(lab.latestLab(root), later.dir);
    assert.throws(() => lab.latestLab(tempDir("cl-empty-")), LabError);
  });

  it("collects a side's commits and diff, untracked files included, and runs its tests", async () => {
    const p = plugins();
    const made = lab.setupLab({ root: tempDir("cl-labs-"), oldPlugin: join(p, "old"), newPlugin: join(p, "new") });
    const { repo } = made.sides.new;
    writeFileSync(join(repo, "schedule.py"), `${readFileSync(join(repo, "schedule.py"), "utf8")}\n\ndef free_slots():\n    return []\n`);
    git(repo, "-c", "commit.gpgsign=false", "commit", "-qam", "feat: free slots");
    writeFileSync(join(repo, "tests", "test_free.py"), "def test_x():\n    pass\n");
    const c = lab.collectSide(made, "new");
    assert.equal(c.commits.length, 1);
    assert.match(c.commits[0], /feat: free slots$/);
    assert.match(c.diff, /\+def free_slots/);
    assert.match(c.diff, /tests\/test_free\.py/);
    assert.deepEqual(c.stats.files.sort(), ["schedule.py", "tests/test_free.py"]);
    const tests = await lab.runTests(made, "new", { command: [process.execPath, "-e", "console.log('1 failed, 4 passed in 0.1s'); process.exit(1)"] });
    assert.deepEqual([tests.exitCode, tests.passed, tests.failed], [1, 4, 1]);
  });
});

const pbStatus = (over = {}) => ({ code: 0, stdout: JSON.stringify({ ok: true, stage: { name: "code-tdd", status: "active", attempt: 1 }, next: null, stop: null, needsHuman: null, action: "Stage code-tdd is active at attempt 1. Wait for its workflow.", ...over }), stderr: "" });
const NO_RUN = { code: 1, stdout: "", stderr: "pb: no run here\n" };

describe("compare-lab-end-new", () => {
  it("reads a stage still active as running, to resume", () => {
    const end = lab.newEndState({ status: pbStatus(), kept: [] });
    assert.deepEqual([end.state, end.finished, end.waitingForHuman, end.stage], ["running", false, false, "code-tdd"]);
  });

  it("reads a stop as waiting for a human, with its reason", () => {
    const end = lab.newEndState({ status: pbStatus({ stop: { reason: "the retry limit is reached" } }), kept: [] });
    assert.deepEqual([end.state, end.finished, end.waitingForHuman, end.reason], ["stopped", false, true, "the retry limit is reached"]);
  });

  it("reads a question as waiting for a human, naming the gate", () => {
    const end = lab.newEndState({ status: pbStatus({ stage: { name: "code-tdd", status: "done" }, needsHuman: { gate: "G:coverage", reason: "a coverage gap" }, action: "The run is waiting for ..." }), kept: [] });
    assert.deepEqual([end.state, end.waitingForHuman], ["needs-human", true]);
    assert.match(end.reason, /G:coverage: a coverage gap/);
  });

  it("reads an answer only the human can act on as waiting for a human", () => {
    const end = lab.newEndState({ status: pbStatus({ stage: { name: "x", status: "done" }, action: "The human answered redo at G:scenarios. Only they can go on: ask them to type pb human approve G:scenarios" }), kept: [] });
    assert.equal(end.waitingForHuman, true);
    assert.match(end.reason, /The human answered redo/);
  });

  it("reads a next stage or gate as running", () => {
    assert.equal(lab.newEndState({ status: pbStatus({ stage: { name: "code-tdd", status: "done" }, next: { stage: "code-safety-net", attempt: 1 }, action: "Start the workflow" }), kept: [] }).state, "running");
  });

  it("reads the current build's no-run answer, exit 0 with run null, as no run", () => {
    const noRun = { code: 0, stdout: JSON.stringify({ ok: true, run: null, action: "No run is open: no run here, so go on to the workflow." }), stderr: "" };
    const end = lab.newEndState({ status: noRun, kept: [{ runId: "p1", kind: "publish", prUrl: "https://github.com/example/repo/pull/7" }] });
    assert.deepEqual([end.state, end.finished], ["ended", true]);
    assert.equal(lab.newEndState({ status: noRun, kept: [] }).state, "not-started");
  });

  it("reads no run with a kept publish run that opened a PR as finished", () => {
    const end = lab.newEndState({ status: NO_RUN, kept: [{ runId: "t1", kind: "code", prUrl: null }, { runId: "p1", kind: "publish", prUrl: "https://github.com/example/repo/pull/7" }] });
    assert.deepEqual([end.state, end.finished, end.pr], ["ended", true, "https://github.com/example/repo/pull/7"]);
  });

  it("reads a publish run that opened no PR as ended but not finished", () => {
    const end = lab.newEndState({ status: NO_RUN, kept: [{ runId: "t1", kind: "code", prUrl: null }, { runId: "p1", kind: "publish", prUrl: null }] });
    assert.deepEqual([end.state, end.finished, end.waitingForHuman], ["ended-no-pr", false, false]);
  });

  it("reads an ended task with no publish run yet, and no run at all, as to resume", () => {
    assert.equal(lab.newEndState({ status: NO_RUN, kept: [{ runId: "t1", kind: "code", prUrl: null }] }).state, "task-ended");
    assert.equal(lab.newEndState({ status: NO_RUN, kept: [] }).state, "not-started");
  });

  it("reads any other pb failure as unreadable", () => {
    const end = lab.newEndState({ status: { code: 1, stdout: "", stderr: "pb: the ledger is corrupt\n" }, kept: [] });
    assert.deepEqual([end.state, end.finished], ["unreadable", false]);
    assert.match(end.reason, /the ledger is corrupt/);
  });

  it("lists the runs a repo kept, with their kind and PR", () => {
    const repo = tempDir("cl-kept-");
    const keep = (runId, kind, kept) => {
      mkdirSync(join(repo, ".pairingbuddy", "reports", "runs", runId), { recursive: true });
      writeFileSync(join(repo, ".pairingbuddy", "reports", "runs", runId, "ledger.json"), JSON.stringify({ kind, runId }));
      writeFileSync(join(repo, ".pairingbuddy", "reports", "runs", runId, "kept.json"), JSON.stringify(kept));
    };
    assert.deepEqual(lab.keptRuns(repo), []);
    keep("a", "code", { unit: "feat/x 1", endedAt: "2026-11-20T00:00:00Z" });
    keep("b", "publish", { unit: "feat/x 1", endedAt: "2026-11-20T00:01:00Z", prUrl: "https://x/pull/1" });
    assert.deepEqual(lab.keptRuns(repo), [{ runId: "a", kind: "code", prUrl: null }, { runId: "b", kind: "publish", prUrl: "https://x/pull/1" }]);
  });
});

describe("compare-lab-end-old", () => {
  const repoWith = (files) => {
    const repo = tempDir("cl-old-");
    mkdirSync(join(repo, ".pairingbuddy"));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, ".pairingbuddy", name), text);
    return repo;
  };

  it("reads the Solo report's status", () => {
    const end = lab.oldEndState(repoWith({ "SOLO_BUDDY_REPORT.md": "# Solo Buddy Report\n\n- **Status:** completed\n" }));
    assert.deepEqual([end.state, end.finished], ["completed", true]);
  });

  it("reads a stopped Solo report as waiting for a human, with its reason", () => {
    const end = lab.oldEndState(repoWith({ "SOLO_BUDDY_REPORT.md": "# Solo Buddy Report\n\n- **Status:** stopped\n\n## Stopped\n\n- **Task:** 1\n- **Reason:** no rule for the ambiguity\n" }));
    assert.deepEqual([end.state, end.finished, end.waitingForHuman, end.reason], ["stopped", false, true, "no rule for the ambiguity"]);
  });

  it("with no report, reads a successful final commit as finished", () => {
    const end = lab.oldEndState(repoWith({ "commit-result.json": JSON.stringify({ status: "success", commit_sha: "5afdb0b9" }) }));
    assert.deepEqual([end.state, end.finished], ["committed", true]);
    assert.match(end.reason, /no Solo report/);
  });

  it("with neither, is not finished", () => {
    const end = lab.oldEndState(repoWith({}));
    assert.deepEqual([end.state, end.finished], ["unknown", false]);
  });
});

describe("compare-lab-loop", () => {
  const base = { result: { sessionId: "s", isError: false, subtype: "success", costUsd: 1 }, exit: { code: 0, timedOut: false }, resumes: 0, maxResumes: 30, elapsedMs: 0, timeoutMs: 60_000, spentUsd: 1, budgetUsd: 25 };
  const running = { state: "running", finished: false, waitingForHuman: false };

  it("resumes a run still going, and stops at an end or a human", () => {
    assert.equal(lab.resumeStop({ ...base, end: running }), null);
    assert.match(lab.resumeStop({ ...base, end: { state: "ended", finished: true } }), /ended/);
    assert.match(lab.resumeStop({ ...base, end: { state: "stopped", waitingForHuman: true, reason: "r" } }), /waiting for a human/);
    assert.match(lab.resumeStop({ ...base, end: { state: "unreadable", reason: "bad" } }), /bad/);
  });

  it("stops at the resume cap, the wall time, the budget, a timeout, or no session", () => {
    assert.match(lab.resumeStop({ ...base, end: running, resumes: 30 }), /resume cap/);
    assert.match(lab.resumeStop({ ...base, end: running, elapsedMs: 60_000 }), /wall time/);
    assert.match(lab.resumeStop({ ...base, end: running, spentUsd: 25 }), /budget/);
    assert.match(lab.resumeStop({ ...base, end: running, result: { ...base.result, subtype: "error_max_budget_usd", isError: true } }), /budget/);
    assert.match(lab.resumeStop({ ...base, end: running, exit: { code: null, timedOut: true } }), /wall time/);
    assert.match(lab.resumeStop({ ...base, end: running, result: null }), /no session/);
  });

  it("asks the resumed session to go on from pb's next action, and says a stage it left was stopped", () => {
    const prompt = lab.continuePrompt({ state: "running", stage: "code-tdd", stageStatus: "active" }, "/plugins/new");
    assert.match(prompt, /node \/plugins\/new\/cli\/pb\.mjs status --action/);
    assert.match(prompt, /code-tdd/);
    assert.match(prompt, /No human/);
    assert.doesNotMatch(lab.continuePrompt({ state: "task-ended" }, "/p"), /stopped with it/);
  });

  const r = (costUsd, durationApiMs, over = {}) => ({ costUsd, numTurns: 3, durationMs: 10, durationApiMs, sessionId: "s", subtype: "success", isError: false, resultText: "a", ...over });

  it("sums turns and durations, and takes cost and API time as the running totals a resume continues", () => {
    const sum = lab.combineResults([r(1.5, 100), null, r(2, 300, { numTurns: 4, durationMs: 20, resultText: "b" })]);
    assert.deepEqual([sum.costUsd, sum.numTurns, sum.durationMs, sum.durationApiMs, sum.resultText, sum.invocations], [2, 7, 30, 300, "b", 3]);
    assert.equal(lab.combineResults([null]), null);
  });

  it("adds a resume's whole total when it did not continue the earlier one", () => {
    assert.deepEqual(lab.spendSteps([1.5, 0.4, 0.9]), [1.5, 0.4, 0.5]);
    assert.equal(lab.combineResults([r(1.5, 100), r(0.4, 50)]).costUsd, 1.9);
  });
});

// A lab for runSide with a stub claude (argv logged, one result per call) and a stub pb in the plugin dir (one
// answer per call, from states.json; the last repeats).
function stubLab({ states, results }) {
  const root = tempDir("cl-stub-");
  const plugin = join(root, "plugin");
  const repo = join(root, "repo");
  mkdirSync(join(plugin, "cli"), { recursive: true });
  mkdirSync(repo);
  writeFileSync(join(plugin, "cli", "states.json"), JSON.stringify(states));
  writeFileSync(
    join(plugin, "cli", "pb.mjs"),
    `import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const dir = ${JSON.stringify(join(plugin, "cli"))};
const states = JSON.parse(readFileSync(dir + "/states.json", "utf8"));
const n = existsSync(dir + "/count") ? Number(readFileSync(dir + "/count", "utf8")) : 0;
writeFileSync(dir + "/count", String(n + 1));
appendFileSync(dir + "/calls.log", JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
const s = states[Math.min(n, states.length - 1)];
process.stdout.write(s.stdout ?? "");
process.stderr.write(s.stderr ?? "");
process.exitCode = s.code ?? 0;
`,
  );
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "results.json"), JSON.stringify(results));
  const claude = join(bin, "claude");
  writeFileSync(
    claude,
    `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const dir = ${JSON.stringify(bin)};
const results = JSON.parse(readFileSync(dir + "/results.json", "utf8"));
const n = existsSync(dir + "/count") ? Number(readFileSync(dir + "/count", "utf8")) : 0;
writeFileSync(dir + "/count", String(n + 1));
appendFileSync(dir + "/calls.log", JSON.stringify({ argv: process.argv.slice(2), ceiling: process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS }) + "\\n");
process.stdout.write(JSON.stringify(results[Math.min(n, results.length - 1)]));
`,
  );
  chmodSync(claude, 0o755);
  const shim = { dir: join(root, "shim"), log: join(root, "shim", "gh.log"), opened: join(root, "shim", "opened.json") };
  const made = { ...fakeLab(), dir: root, timeoutMin: 5, maxResumes: 30, sides: { old: { repo, plugin: { dir: plugin }, shim }, new: { repo, plugin: { dir: plugin }, shim } } };
  const calls = (dir) => readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  // PATH holds only the stub, so no test can reach the real claude even if runSide ignored the claude option.
  const env = { PATH: bin, HOME: root };
  return { lab: made, repo, claude, env, projects: join(root, "projects"), claudeCalls: () => calls(bin), pbCalls: () => calls(join(plugin, "cli")), results: join(root, "results", "new") };
}

const claudeResult = (n, cost = 1.25) => ({ ...SAMPLE_RESULT, session_id: "sid-1", total_cost_usd: cost, num_turns: n, duration_ms: 1000, duration_api_ms: 2000, result: `turn ${n}` });

const keepPublish = (repo, prUrl) => {
  const dir = join(repo, ".pairingbuddy", "reports", "runs", "p1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ledger.json"), JSON.stringify({ kind: "publish" }));
  writeFileSync(join(dir, "kept.json"), JSON.stringify({ prUrl }));
};

describe("compare-lab-run-new", () => {
  it("resumes the session until the run ends, keeping each invocation and summing them", async () => {
    const s = stubLab({ states: [pbStatus(), pbStatus({ stage: { name: "code-tdd", status: "done" }, next: { stage: "code-safety-net", attempt: 1 } }), NO_RUN], results: [claudeResult(5, 1.25), claudeResult(7, 2.5), claudeResult(9, 3.75)] });
    keepPublish(s.repo, "https://github.com/example/repo/pull/7");
    const run = await lab.runSide(s.lab, "new", { claude: s.claude, projects: s.projects, inherited: s.env });
    const calls = s.claudeCalls();
    assert.equal(calls.length, 3);
    assert.equal(calls[0].argv.includes("--resume"), false);
    for (const later of calls.slice(1)) {
      assert.equal(later.argv[later.argv.indexOf("--resume") + 1], "sid-1");
      assert.match(later.argv[later.argv.indexOf("-p") + 1], /status --action/);
      assert.equal(later.argv[later.argv.indexOf("--plugin-dir") + 1], s.lab.sides.new.plugin.dir);
    }
    assert.equal(Number(calls[1].argv[calls[1].argv.indexOf("--max-budget-usd") + 1]), 23.75);
    assert.ok(calls.every((c) => c.ceiling === "0"));
    assert.ok(s.pbCalls().every((c) => c.argv.join(" ") === "status --action" && c.cwd === s.repo));
    for (const name of ["claude.json", "claude.2.json", "claude.3.json", "stderr.txt", "stderr.3.txt"]) assert.ok(existsSync(join(s.results, name)), name);
    assert.deepEqual([run.result.costUsd, run.result.numTurns, run.result.invocations], [3.75, 21, 3]);
    assert.deepEqual([run.end.state, run.end.finished, run.end.pr], ["ended", true, "https://github.com/example/repo/pull/7"]);
    assert.equal(run.loop.resumes, 2);
    assert.match(run.loop.stoppedBecause, /ended/);
    assert.deepEqual(JSON.parse(readFileSync(join(s.results, "run.json"), "utf8")).end, run.end);
  });

  it("stops when the run waits for a human, and records why", async () => {
    const s = stubLab({ states: [pbStatus({ stage: { name: "code-tdd", status: "done" }, needsHuman: { gate: "G:coverage", reason: "a coverage gap" } })], results: [claudeResult(5)] });
    const run = await lab.runSide(s.lab, "new", { claude: s.claude, projects: s.projects, inherited: s.env });
    assert.equal(s.claudeCalls().length, 1);
    assert.deepEqual([run.end.state, run.end.waitingForHuman], ["needs-human", true]);
    assert.match(run.loop.stoppedBecause, /waiting for a human: G:coverage: a coverage gap/);
  });

  it("stops at the resume cap", async () => {
    const s = stubLab({ states: [pbStatus()], results: [claudeResult(1)] });
    const run = await lab.runSide({ ...s.lab, maxResumes: 2 }, "new", { claude: s.claude, projects: s.projects, inherited: s.env });
    assert.equal(s.claudeCalls().length, 3);
    assert.match(run.loop.stoppedBecause, /resume cap/);
    assert.equal(run.end.finished, false);
  });

  it("runs old once and reads its end from its repo", async () => {
    const s = stubLab({ states: [pbStatus()], results: [claudeResult(5)] });
    mkdirSync(join(s.repo, ".pairingbuddy"), { recursive: true });
    writeFileSync(join(s.repo, ".pairingbuddy", "commit-result.json"), JSON.stringify({ status: "success" }));
    const run = await lab.runSide(s.lab, "old", { claude: s.claude, projects: s.projects, inherited: s.env });
    assert.equal(s.claudeCalls().length, 1);
    assert.equal(existsSync(join(s.lab.sides.new.plugin.dir, "cli", "calls.log")), false);
    assert.deepEqual([run.end.state, run.end.finished], ["committed", true]);
  });
});

describe("compare-lab-reset", () => {
  it("puts one side's repo back at the start commit and clears its results and shim log", () => {
    const root = tempDir("cl-plugins-");
    for (const side of ["old", "new"]) mkdirSync(join(root, side));
    const made = lab.setupLab({ root: tempDir("cl-labs-"), oldPlugin: join(root, "old"), newPlugin: join(root, "new") });
    const { repo, startCommit, shim } = made.sides.new;
    git(repo, "checkout", "-qb", "feat/free-slots");
    writeFileSync(join(repo, "schedule.py"), "changed\n");
    git(repo, "-c", "commit.gpgsign=false", "commit", "-qam", "feat: x");
    mkdirSync(join(repo, ".pairingbuddy", "run", "task"), { recursive: true });
    writeFileSync(join(repo, ".pairingbuddy", "run", "task", "ledger.json"), "{}");
    writeFileSync(shim.log, "{}\n");
    writeFileSync(shim.opened, "{}");
    mkdirSync(join(made.dir, "results", "new"), { recursive: true });
    writeFileSync(join(made.dir, "results", "new", "run.json"), "{}");
    mkdirSync(join(made.dir, "results", "old"), { recursive: true });
    writeFileSync(join(made.dir, "results", "old", "run.json"), "{}");
    lab.resetSide(made, "new");
    assert.equal(git(repo, "rev-parse", "HEAD"), startCommit);
    assert.equal(git(repo, "branch", "--show-current"), "main");
    assert.equal(git(repo, "branch", "--list", "feat/*"), "");
    assert.equal(git(repo, "status", "--porcelain"), "");
    assert.equal(existsSync(join(repo, ".pairingbuddy", "run")), false);
    assert.deepEqual(JSON.parse(readFileSync(join(repo, ".pairingbuddy", "test-config.json"), "utf8")), lab.testConfig("new"));
    assert.equal(existsSync(shim.opened), false);
    assert.equal(readFileSync(shim.log, "utf8"), "");
    assert.equal(existsSync(join(made.dir, "results", "new")), false);
    assert.equal(existsSync(join(made.dir, "results", "old", "run.json")), true);
    lab.assertFresh(made, "new");
    assert.throws(() => lab.assertFresh(made, "old"), /reset old/);
  });
});
