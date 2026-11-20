// The deterministic parts of tests/smoke/compare-lab.mjs: arguments, the child environment and argv, result and
// transcript parsing, the blind mapping, the verdict, the summary, and a lab setup with stand-in plugin dirs.
import "./isolated-tmpdir.mjs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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

  it("gives both sides the same claude flags but their own plugin", () => {
    const flag = (argv, name) => argv[argv.indexOf(name) + 1];
    const old = lab.runArgs("old", fakeLab());
    const neu = lab.runArgs("new", fakeLab());
    assert.equal(flag(old, "-p"), "/pairingbuddy:code Add free_slots");
    for (const [name, value] of [["--output-format", "json"], ["--model", "claude-sonnet-5-5"], ["--permission-mode", "bypassPermissions"], ["--setting-sources", "project,local"], ["--max-budget-usd", "25"]]) {
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
    old: { plugin: { ref: "v0.7.0", sha: "1096ccfd07" }, run: { wallMs: 1_200_000, exitCode: 0, timedOut: false, result: lab.parseRunResult(JSON.stringify(SAMPLE_RESULT)), transcript: { files: 7, agentFiles: 6, total: { input: 10, output: 6000, cacheRead: 1_000_000, cacheCreation: 50_000, messages: 120 } } }, outcome: { stats: { files: ["schedule.py", "tests/test_schedule.py"], insertions: 80, deletions: 2 }, commits: ["abc feat: free slots"], tests: { parsed: true, passed: 10, failed: 0, errors: 0, exitCode: 0 } } },
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
    assert.match(md, /\| finished \| yes \| not run \|/);
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
