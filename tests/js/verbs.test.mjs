import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeLedger } from "../../shared-node/ledger.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const GATE = join(ROOT, "hooks", "gate.mjs");
const BOOT = join(ROOT, "hooks", "gate-boot.mjs");
const CLI = join(ROOT, "cli", "pb.mjs");
const VERBS_MODULE = join(ROOT, "shared-node", "verbs.mjs");
const PAYLOADS = join(ROOT, "tests", "probes", "fixtures", "payloads");
const fixture = (name) => JSON.parse(readFileSync(join(PAYLOADS, name), "utf8"));

// Each spawn is a read of one shared run: the gate's Bash path never writes the ledger.
const IN_PARALLEL = { concurrency: 8 };

// The runner's exact command: this plugin's CLI by absolute path, one runner verb, no shell syntax.
const PB = `node ${CLI}`;

// D5, written out here so the test does not read its answer from the table it checks.
const RUNNER_VERBS = ["test", "checkpoint", "stage finish", "stage stop", "tdd state", "refactor state", "spike state", "spike write", "snapshot", "artifact check", "pr lint", "rollback"];
const MAIN_VERBS = ["unit open", "unit status", "run open", "stage report", "stage fail", "gate eval", "task end", "spike setup", "plan next", "publish", "pr refresh", "status", "git doctor"];
const HUMAN_VERBS = ["human approve", "human abandon", "human approve-config", "human accept"];

// Rows of the class matrix. A human row carries an argument because the real calls have one, and so does stage stop,
// which is allowed only with its reason.
const RUNNER_LINES = { "stage stop": "stage stop agent-budget" };
const VERB_ROWS = [
  ...RUNNER_VERBS.map((verb) => ({ verb, line: RUNNER_LINES[verb] ?? verb, verbClass: "runner" })),
  ...MAIN_VERBS.map((verb) => ({ verb, line: verb, verbClass: "main" })),
  { verb: "human approve", line: "human approve g1", verbClass: "human" },
  { verb: "human abandon", line: "human abandon", verbClass: "human" },
  { verb: "human accept", line: "human accept", verbClass: "human" },
  { verb: "human accept --legacy", line: "human accept --legacy unit-1", verbClass: "human" },
];

const RUNNER_AGENT = "pairingbuddy:runner";
// agentType undefined is the main context, which has neither agent key (P2).
const CALLERS = [
  { caller: "main context", agentType: undefined },
  { caller: "the runner agent", agentType: RUNNER_AGENT },
  { caller: "a pipeline subagent", agentType: "pairingbuddy:apply-config-change" },
  { caller: "a plain workflow agent", agentType: "workflow-subagent" },
];

// Same JSON shape as the allow that P18A proved in default mode, with no dialog. Only the reason text is ours.
const AUTO_ALLOW = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    permissionDecisionReason: "Runner CLI command, auto-allowed by the Pairing Buddy gate.",
  },
};

const makeLedger = () => ({
  v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "config_change",
  owner: { sessionId: null, lastSeen: null }, task: "Task 25",
  plan: { path: "", title: "" }, configHash: "a".repeat(64),
  policy: { mode: "", source: "" },
  stage: { name: "", status: "", runId: null, attempt: 0, startedAt: null }, stages: [],
  gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 },
  stop: null, needsHuman: null,
});

const tempDirs = [];
function makeDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function makeRepo() {
  const dir = makeDir("verbs-");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

function makeRunRepo() {
  const dir = makeRepo();
  mkdirSync(join(dir, ".pairingbuddy", "run", "task"), { recursive: true });
  writeLedger(join(dir, ".pairingbuddy", "run", "task", "ledger.json"), makeLedger());
  return dir;
}

const RUN_REPO = makeRunRepo();

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function bashCall(command, { agentType, cwd = RUN_REPO, session, toolInput = { command, description: "run it" } } = {}) {
  const base = agentType === undefined ? fixture("pretooluse-workflow.json") : { ...fixture("pretooluse-workflow-agent-bash.json"), agent_type: agentType };
  return { ...base, ...(session && { session_id: session }), cwd, permission_mode: "default", tool_name: "Bash", tool_input: toolInput };
}

function runGate(payload, { gate = BOOT, pluginRoot = ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [gate], {
      cwd: payload.cwd,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

function assertSilent(result) {
  assert.deepEqual(result, { code: 0, stdout: "", stderr: "" }, "the gate adds no decision here, so normal permissions apply");
}

function assertAutoAllowed(result) {
  assert.notEqual(result.stdout, "", "the runner's exact command must be auto-allowed, but the gate printed nothing");
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), AUTO_ALLOW);
}

function assertNotAutoAllowed(result) {
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  const decision = result.stdout === "" ? "none" : JSON.parse(result.stdout).hookSpecificOutput.permissionDecision;
  assert.notEqual(decision, "allow", "only the exact runner command is auto-allowed");
}

// Every deny goes through here, so every row also proves the message hides the abandon exit.
function denialReason(result) {
  assert.notEqual(result.stdout, "", "this call must be denied, but the gate printed nothing");
  assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
  const { hookEventName, permissionDecision, permissionDecisionReason: reason } = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(hookEventName, "PreToolUse");
  assert.equal(permissionDecision, "deny");
  assert.equal(typeof reason, "string");
  assert.doesNotMatch(reason, /abandon/i, "a deny must not advertise pb human abandon");
  return reason;
}

// A pasted `!` line reaches the model (P4, P20), so the human has to type it.
function assertHumanDenied(result) {
  const reason = denialReason(result);
  assert.match(reason, /\btype\b/i, "the deny says the human must type the command");
  assert.match(reason, /!/, "the deny names the `!` prefix");
}

function assertWrongCallerDenied(result, verb, owner) {
  const reason = denialReason(result);
  assert.ok(reason.includes(verb), `the deny names the verb ${verb}: ${reason}`);
  assert.match(reason, owner, `the deny names the class that owns ${verb}: ${reason}`);
}

const OWNER = { runner: /runner/i, main: /main context/i };

function assertOutcome(result, { caller, agentType }, { verb, verbClass }) {
  if (verbClass === "human") assertHumanDenied(result);
  else if (verbClass === "runner" && agentType === RUNNER_AGENT) assertAutoAllowed(result);
  else if (verbClass === "main" && caller === "main context") assertSilent(result);
  else assertWrongCallerDenied(result, verb, OWNER[verbClass]);
}

describe("each caller class calling each verb", IN_PARALLEL, () => {
  for (const caller of CALLERS) {
    for (const row of VERB_ROWS) {
      test(`${caller.caller} calling pb ${row.line}`, async () => {
        const result = await runGate(bashCall(`${PB} ${row.line}`, caller));

        assertOutcome(result, caller, row);
      });
    }
  }
});

const HUMAN = `${PB} human approve g1`;

const HUMAN_SHAPES = [
  ["&&", `true && ${HUMAN}`],
  [";", `true; ${HUMAN}`],
  ["||", `false || ${HUMAN}`],
  ["a pipe", `echo y | ${HUMAN}`],
  ["a background &", `${HUMAN} & wait`],
  ["a newline", `true\n${HUMAN}`],
  ["cd first", `cd /tmp && ${HUMAN}`],
  ["a subshell", `(${HUMAN})`],
  ["a brace group", `{ ${HUMAN}; }`],
  ["command substitution", `echo $(${HUMAN})`],
  ["backticks", `echo \`${HUMAN}\``],
  ["sh -c", `sh -c '${HUMAN}'`],
  ["bash -c", `bash -c "${HUMAN}"`],
  ["bash -lc", `bash -lc '${HUMAN}'`],
  ["eval", `eval "${HUMAN}"`],
  ["a pipe into sh", `echo '${HUMAN}' | sh`],
  ["a here-string into sh", `sh <<< '${HUMAN}'`],
  ["an env prefix", `PB_X=1 ${HUMAN}`],
  ["the env command", `env PB_X=1 ${HUMAN}`],
  ["the command builtin", `command ${HUMAN}`],
  ["exec", `exec ${HUMAN}`],
  ["nohup", `nohup ${HUMAN}`],
  ["time", `time ${HUMAN}`],
  ["timeout", `timeout 5 ${HUMAN}`],
  ["a bare pb", "pb human approve g1"],
  ["an absolute pb", "/usr/local/bin/pb human approve g1"],
  ["a direct script path", `${CLI} human approve g1`],
  ["a relative script path", "node cli/pb.mjs human approve g1"],
  ["the plugin root variable", `node "$CLAUDE_PLUGIN_ROOT/cli/pb.mjs" human approve g1`],
  ["a node flag", `node --no-warnings ${CLI} human approve g1`],
  ["a quoted script path", `node "${CLI}" human approve g1`],
  ["a double-quoted verb", 'pb "human" approve g1'],
  ["single-quoted words", "pb 'human' 'approve' g1"],
  ["a quote inside the word", 'pb hu"man" approve g1'],
  ["an empty quote inside the word", "pb hu''man approve g1"],
  ["a backslash in the word", "pb \\human approve g1"],
  ["doubled spaces", "pb  human   approve g1"],
  ["a tab", "pb\thuman\tapprove g1"],
  ["nested quoting", `sh -c "pb \\"human\\" approve g1"`],
  ["no subcommand", "pb human"],
  ["an unknown subcommand", "pb human whatever"],
  ["text that only mentions it, denied on purpose", "grep 'pb human' docs/notes.md"],
];

describe("pb human in any shape, during a run", IN_PARALLEL, () => {
  for (const { caller, agentType } of CALLERS.slice(0, 2)) {
    for (const [shape, command] of HUMAN_SHAPES) {
      test(`${caller} using ${shape} is denied`, async () => {
        const result = await runGate(bashCall(command, { agentType }));

        assertHumanDenied(result);
      });
    }
  }
});

const COMPOUND_WRONG_CALLER = [
  ["main context hiding a runner verb after &&", undefined, `true && ${PB} test`, "test", OWNER.runner],
  ["main context hiding a runner verb in sh -c", undefined, `sh -c '${PB} checkpoint'`, "checkpoint", OWNER.runner],
  ["main context hiding a runner verb after a main verb", undefined, `${PB} status && ${PB} stage finish`, "stage finish", OWNER.runner],
  ["main context using a bare pb for a runner verb", undefined, "pb snapshot", "snapshot", OWNER.runner],
  ["a subagent hiding a main verb after ;", "pairingbuddy:apply-config-change", `true; ${PB} publish`, "publish", OWNER.main],
  ["a subagent hiding a main verb in a subshell", "workflow-subagent", `(${PB} task end)`, "task end", OWNER.main],
  ["the runner hiding a main verb after a runner verb", RUNNER_AGENT, `${PB} test; ${PB} publish`, "publish", OWNER.main],
  ["the runner using a bare pb for a main verb", RUNNER_AGENT, "pb gate eval", "gate eval", OWNER.main],
];

describe("wrong-class verbs inside a compound command", IN_PARALLEL, () => {
  for (const [name, agentType, command, verb, owner] of COMPOUND_WRONG_CALLER) {
    test(`${name} is denied`, async () => {
      const result = await runGate(bashCall(command, { agentType }));

      assertWrongCallerDenied(result, verb, owner);
    });
  }
});

const MENTIONS = [
  ["a git log search", 'git log --grep "fix pb test"'],
  ["a grep pattern", "grep 'pb test' f"],
  ["an echoed line", "echo pb publish"],
  ["a wrapped argument", "timeout 5 grep 'pb test' f"],
  ["a quoted sh -c argument", "sh -c 'grep \"pb test\" f'"],
  ["an unquoted grep pattern", "grep pb test f"],
  ["a wrapped unquoted grep", "timeout 5 rg pb test f"],
  ["a printf", "printf pb test"],
  ["a comment after a command", "ls # pb test"],
  ["a comment line", "# then pb test\nls"],
  ["the path of the CLI as a plain argument", "git diff cli/pb.mjs tests/js/verbs.test.mjs"],
];

describe("a wrong-class verb that is only mentioned stays undecided", IN_PARALLEL, () => {
  for (const { caller, agentType } of CALLERS) {
    for (const [shape, command] of MENTIONS) {
      test(`${caller} using ${shape}`, async () => {
        const result = await runGate(bashCall(command, { agentType }));

        assertSilent(result);
      });
    }
  }
});

// A pb verb named inside a commit message, or the CLI's path given to git add, is a mention too. RUN_REPO holds a run, and
// D17 lets the main context commit and add during a run, so there the gate stays silent. A subagent is denied the same
// command by D17, not by a pb verb rule, so its deny must come from D17 and must not name a pb verb.
const GIT_MENTIONS = [
  ["a commit message", 'git commit -m "fix pb test"', /Subagents do not commit during a run/],
  ["the path of the CLI as a plain argument", "git add cli/pb.mjs tests/js/verbs.test.mjs", /A subagent during a run only reads/],
];

describe("a pb verb inside a git command stays a mention", IN_PARALLEL, () => {
  for (const { caller, agentType } of CALLERS) {
    for (const [shape, command, subagentDeny] of GIT_MENTIONS) {
      test(`${caller} using ${shape}`, async () => {
        const result = await runGate(bashCall(command, { agentType }));

        if (agentType === undefined) {
          assertSilent(result);
          return;
        }
        const reason = denialReason(result);
        assert.match(reason, subagentDeny, "the deny comes from D17");
        assert.doesNotMatch(reason, /belongs to/, "no pb verb rule decided this");
      });
    }
  }
});

const SUBAGENT = "pairingbuddy:apply-config-change";
const REAL_INVOCATIONS = [
  ["another CLI path", undefined, "node /x/cli/pb.mjs test", "test", OWNER.runner],
  ["cd first", undefined, "cd a && pb test", "test", OWNER.runner],
  ["an env prefix", undefined, "FOO=1 pb stage finish", "stage finish", OWNER.runner],
  ["a subagent's sh -c", SUBAGENT, "sh -c 'pb run open'", "run open", OWNER.main],
  ["a nested sh -c", SUBAGENT, `bash -lc "sh -c 'pb run open'"`, "run open", OWNER.main],
  ["eval", undefined, 'eval "pb test"', "test", OWNER.runner],
  ["a substitution inside quotes", undefined, 'git commit -m "$(pb test)"', "test", OWNER.runner],
  ["backticks", undefined, "echo `pb test`", "test", OWNER.runner],
  ["a wrapper", undefined, "env FOO=1 nohup node --no-warnings /x/cli/pb.mjs test", "test", OWNER.runner],
  ["a keyword", undefined, "if pb test; then true; fi", "test", OWNER.runner],
  ["a leading redirect", undefined, "> out pb test", "test", OWNER.runner],
  ["a verb touching a redirect", undefined, "pb test>out", "test", OWNER.runner],
  ["quotes in the command word", undefined, 'p"b" test', "test", OWNER.runner],
  ["env -u", undefined, "env -u X pb test", "test", OWNER.runner],
  ["env -u from a subagent", SUBAGENT, "env -u X pb checkpoint", "checkpoint", OWNER.runner],
  ["env -u around a shell", undefined, "env -u X sh -c 'pb test'", "test", OWNER.runner],
  ["node -r", undefined, "node -r ./x.mjs cli/pb.mjs test", "test", OWNER.runner],
  ["node --require", undefined, "node --require ./x.mjs cli/pb.mjs test", "test", OWNER.runner],
  ["node --import", undefined, "node --import ./x.mjs cli/pb.mjs test", "test", OWNER.runner],
  ["node -r with a quoted script path", undefined, `node -r ./x.mjs "/sp ace/cli/pb.mjs" test`, "test", OWNER.runner],
  ["find -exec", undefined, "find . -exec node cli/pb.mjs test \\;", "test", OWNER.runner],
  ["find -exec with a shell", undefined, "find . -exec sh -c 'pb test' \\;", "test", OWNER.runner],
  ["coproc", undefined, "coproc pb test", "test", OWNER.runner],
  ["coproc from a subagent", SUBAGENT, "coproc pb stage finish", "stage finish", OWNER.runner],
  ["a named coproc", undefined, "coproc P { pb test; }", "test", OWNER.runner],
  ["sudo -u", undefined, "sudo -u root pb test", "test", OWNER.runner],
  ["exec -a", undefined, "exec -a x pb test", "test", OWNER.runner],
  ["setsid", undefined, "setsid pb test", "test", OWNER.runner],
  ["stdbuf", undefined, "stdbuf -oL pb test", "test", OWNER.runner],
  ["caffeinate", undefined, "caffeinate pb test", "test", OWNER.runner],
  ["script", undefined, "script /dev/null pb test", "test", OWNER.runner],
  ["parallel", undefined, "parallel pb test ::: 1", "test", OWNER.runner],
  ["watch", undefined, "watch pb test", "test", OWNER.runner],
  ["a function body", undefined, "function f { pb test; }", "test", OWNER.runner],
  ["the runner reaching a main verb through env -u", RUNNER_AGENT, "env -u X pb gate eval", "gate eval", OWNER.main],
  ["the runner reaching a main verb through find -exec", RUNNER_AGENT, "find . -exec pb task end \\;", "task end", OWNER.main],
];

describe("a real pb invocation keeps its deny", IN_PARALLEL, () => {
  for (const [shape, agentType, command, verb, owner] of REAL_INVOCATIONS) {
    test(`${shape} is denied`, async () => {
      const result = await runGate(bashCall(command, { agentType }));

      assertWrongCallerDenied(result, verb, owner);
    });
  }
});

const CHECKPOINT = `${PB} checkpoint --step config --from code-config.apply-config-change.-.r1.a1`;
// A caller's own verb, so that only the environment rule is left to deny it.
const ENVIRONMENT_FORMS = [
  ["PYTEST_ADDOPTS", RUNNER_AGENT, `PYTEST_ADDOPTS=--collect-only ${PB} test --full`],
  ["PATH", RUNNER_AGENT, `PATH=/tmp/fake:$PATH ${PB} test --full`],
  ["git config through the environment", RUNNER_AGENT, `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null ${CHECKPOINT}`],
  ["the env command with an assignment", RUNNER_AGENT, `env X=1 ${PB} test --full`],
  ["a bare env", RUNNER_AGENT, `env ${PB} test --full`],
  ["env -u", RUNNER_AGENT, `env -u X ${PB} test --full`],
  ["env -i", RUNNER_AGENT, `env -i ${PB} test --full`],
  ["an env by path", RUNNER_AGENT, `/usr/bin/env ${PB} test --full`],
  ["an assignment after a wrapper", RUNNER_AGENT, `nice X=1 ${PB} test --full`],
  ["an env after a wrapper", RUNNER_AGENT, `timeout 5 env X=1 ${PB} test --full`],
  ["an assignment before a wrapper", RUNNER_AGENT, `X=1 nohup ${PB} test --full`],
  ["inside sh -c", RUNNER_AGENT, `sh -c 'X=1 ${PB} test --full'`],
  ["inside a substitution", RUNNER_AGENT, `echo $(X=1 ${PB} test --full)`],
  ["after a compound", RUNNER_AGENT, `true && X=1 ${PB} test --full`],
  ["the main context", undefined, `X=1 ${PB} gate eval`],
  ["the main context with env", undefined, `env X=1 ${PB} status`],
  ["a bare pb", undefined, "X=1 pb status"],
];

describe("a pb call takes no environment", IN_PARALLEL, () => {
  for (const [shape, agentType, command] of ENVIRONMENT_FORMS) {
    test(`${shape} is denied`, async () => {
      const result = await runGate(bashCall(command, { agentType }));

      assert.match(denialReason(result), /environment/);
    });
  }

  for (const [shape, command] of [
    ["an assignment on another command", `X=1 ls; ${PB} gate eval`],
    ["an assignment holding a pb's output", `RESULT=$(${PB} gate eval)`],
    ["env on another command", `env X=1 ls && ${PB} gate eval`],
    ["an assignment with no pb", "FOO=1 uv run pytest"],
  ]) {
    test(`${shape} stays untouched`, async () => {
      assertSilent(await runGate(bashCall(command)));
    });
  }
});

// Some rows name a verb an earlier rule already denies: what matters is that none gets through.
const ANY_PB_RULE = /literal|human alone|belongs to/;
const LITERAL_RULE = /literal/;
const GATE_ARG = "G:task-end";

// All of these ran for real before: the shell rebuilds `human`, or macOS's filesystem ignores the case.
const DISGUISED = [
  ["another letter case of pb.mjs", `node cli/PB.mjs human approve ${GATE_ARG}`],
  ["another letter case, one letter", "node cli/pB.mjs status"],
  ["the extension in capitals", "node cli/pb.MJS status"],
  ["a capitalised name alone", "ls cli/Pb.mjs"],
  ["another letter case with quotes in it", `node cli/P"B".mjs human approve ${GATE_ARG}`],
  ["a substitution", `node cli/pb.mjs $(echo human) approve ${GATE_ARG}`],
  ["backticks", `node cli/pb.mjs \`echo human\` approve ${GATE_ARG}`],
  ["a variable", `V=human; node cli/pb.mjs $V approve ${GATE_ARG}`],
  ["a quoted variable", `node cli/pb.mjs "$V" approve ${GATE_ARG}`],
  ["ANSI-C quoting", `node cli/pb.mjs $'\\x68uman' approve ${GATE_ARG}`],
  ["an empty expansion inside the word", `node cli/pb.mjs hu\${Z}man approve ${GATE_ARG}`],
  ["brace expansion", `node cli/pb.mjs {human,} approve ${GATE_ARG}`],
  ["IFS glued to the name", `node cli/pb.mjs\${IFS}human approve ${GATE_ARG}`],
  ["a variable glued to the name", `node cli/pb.mjs$X approve ${GATE_ARG}`],
  ["a backslash inside the verb's second word", "node cli/pb.mjs run op\\en"],
  ["a line continuation before the verb", `node cli/pb.mjs \\\nhuman approve ${GATE_ARG}`],
  ["a bare pb with a substitution", `pb $(echo human) approve ${GATE_ARG}`],
  ["a quoted name with an expansion", `node "cli/pb.mjs" $(echo human) approve ${GATE_ARG}`],
  ["a name broken by quotes with an expansion", `node cli/p"b".mjs $(echo human) approve ${GATE_ARG}`],
  ["a name broken by a backslash with an expansion", `node cli/p\\b.mjs $(echo human) approve ${GATE_ARG}`],
  ["xargs feeding pb.mjs through node", `echo human approve ${GATE_ARG} | xargs node cli/pb.mjs`],
  ["xargs feeding a bare pb", `echo gate eval | xargs pb`],
  ["xargs with options before the pb", "echo human | xargs -n 1 node cli/pb.mjs"],
  ["xargs with a replacement word before the pb", "echo human | xargs -I X node cli/pb.mjs X approve"],
  ["xargs after a wrapper", "echo human | env xargs pb"],
  ["xargs inside sh -c", `sh -c 'echo human | xargs pb'`],
  ["xargs inside a substitution", "echo $(echo human | xargs pb)"],
  ["a ? in the word", `node cli/pb.mjs hum?n approve ${GATE_ARG}`],
  ["a * in the word", `node cli/pb.mjs hu* approve ${GATE_ARG}`],
  ["a [ in the word", `node cli/pb.mjs hu[m]an approve ${GATE_ARG}`],
  ["a glob on a bare pb", `pb hum?n approve ${GATE_ARG}`],
  ["a mention with an expansion", "echo pb.mjs $(whoami)"],
  ["a mention in a grep", "grep -n pb.mjs $FILE"],
  ["a bare pb after a wrapper", "timeout 5 pb hum?n approve"],
  ["a bare pb after sudo", "sudo pb $(echo human) approve"],
  ["a bare pb after an assignment", "V=1 pb $V"],
  ["a bare pb after a keyword", "if pb $V; then :; fi"],
  ["a bare pb in a compound", "true && pb $V"],
  ["a bare pb in a subshell", "(pb $V)"],
  ["a bare pb by path", "/opt/bin/pb $V"],
  ["a bare pb inside sh -c", `sh -c 'pb $(echo human) approve'`],
  ["a bare pb inside eval", `eval 'pb $V'`],
  ["a bare pb in a substitution", "echo $(pb $V)"],
  ["a bare pb in backticks", "echo `pb $V`"],
  ["pb.mjs under a wrapper no list knows", "caffeinate node cli/pb.mjs $(echo human) approve"],
  ["pb.mjs under a wrapper option no list knows", "sudo -u me node cli/pb.mjs $V"],
  ["a quoted pb.mjs under a wrapper no list knows", `caffeinate node "cli/pb.mjs" $V`],
  ["pb.mjs inside find -exec", `find . -exec node cli/pb.mjs {} +`],
];

describe("pb takes literal words", IN_PARALLEL, () => {
  for (const { caller, agentType } of CALLERS) {
    for (const [shape, command] of DISGUISED) {
      test(`${caller} using ${shape} is denied`, async () => {
        const result = await runGate(bashCall(command, { agentType }));

        assert.match(denialReason(result), ANY_PB_RULE);
      });
    }
  }
});

const LITERAL_COMMANDS = [
  `${PB} gate eval`,
  `${PB} gate eval | jq '{gate: .gate}'`,
  `${PB} gate eval | jq '.x'`,
  `${PB} gate eval | jq '.[0]?'`,
  "ls | xargs wc -l",
  "ls *.md; ls cli/pb.mjs",
  `${PB} gate eval; echo "exit $?"`,
  `${PB} gate eval && echo $HOME`,
  `echo $HOME; ${PB} gate eval`,
  `RESULT=$(${PB} gate eval)`,
  "grep -n 'pb\\.mjs' hooks/gate.mjs",
  "ls cli/pb.mjs",
  "cat tests/js/pb-human.test.mjs $FILE",
  "cat docs/pb/notes.md $FILE",
  "node tools/pbx.mjs $(whoami)",
  "echo $PB",
  `find .pairingbuddy -type f | head; for f in $(find ...); do echo "## $f"; cat "$f"; done`,
  `find .pairingbuddy -type f | head; for f in $(find .pairingbuddy -type f); do echo "## $f"; cat "$f"; done`,
  `for f in pb $(find .pairingbuddy -type f); do echo "## $f"; cat "$f"; done`,
  "find .pairingbuddy -name pb -type f -exec cat {} +",
  "grep -rIl pb .pairingbuddy/*",
  `grep -rIl "pb " . --include=*.mjs`,
  `grep -rIl 'pb stage fail' .pairingbuddy/*`,
  `grep -rIl "pb.mjs" .pairingbuddy/*`,
  `grep -rIl 'pb\\.mjs' .pairingbuddy/*`,
  "ls pb $HOME",
  "cat /opt/pb $FILE",
  "echo pb $HOME",
  `echo "pb.mjs $HOME"`,
  `node "$PLUGIN/cli/pb.mjs" status`,
];

test("the deny for a rebuilt word states the rule", async () => {
  assert.match(denialReason(await runGate(bashCall(`node cli/pb.mjs $(echo human) approve ${GATE_ARG}`))), LITERAL_RULE);
  assert.match(denialReason(await runGate(bashCall(`node cli/pb.mjs hum?n approve ${GATE_ARG}`))), LITERAL_RULE);
  assert.match(denialReason(await runGate(bashCall(`echo human approve ${GATE_ARG} | xargs node cli/pb.mjs`))), LITERAL_RULE);
});

describe("a literal pb stays untouched", IN_PARALLEL, () => {
  for (const command of LITERAL_COMMANDS) {
    test(`the main context running ${command}`, async () => {
      assertSilent(await runGate(bashCall(command, { agentType: undefined })));
    });
  }
});

const UNRELATED_COMMANDS = ["uv run pytest", "ls human", "echo human approve", "grep -rn approve src", "git log --oneline", "pb humanize", "node tools/pbx.mjs human approve"];

describe("commands that are not pb human stay untouched", IN_PARALLEL, () => {
  for (const { caller, agentType } of CALLERS.slice(0, 2)) {
    for (const command of UNRELATED_COMMANDS) {
      test(`${caller} running ${command}`, async () => {
        const result = await runGate(bashCall(command, { agentType }));

        assertSilent(result);
      });
    }
  }
});

describe("runner auto-allow is for the exact command only", IN_PARALLEL, () => {
  test("the runner's pb test --full is auto-allowed", async () => {
    const result = await runGate(bashCall(`${PB} test --full`, { agentType: RUNNER_AGENT }));

    assertAutoAllowed(result);
  });

  const CONFIG_KEY = "code-config.apply-config-change.-.r1.a1";
  const DOCS_KEY = "code-safety-net.update-documentation.-.r2.a3";

  const PLACEHOLDERS_KEY = "code-tdd.create-test-placeholders.-.r1.a1";
  const RED_KEY = "code-tdd.implement-tests.t1.r2.a1";
  const GREEN_KEY = "code-tdd.implement-code.login-valid.r1.a3";

  const REFACTOR_CODE_KEY = "code-tdd.refactor-code.t1.r1.a1";
  const REFACTOR_TESTS_KEY = "code-tdd.refactor-tests.login-valid.r2.a3";

  for (const args of [`--step config --from ${CONFIG_KEY}`, `--step docs --from ${DOCS_KEY}`, `--step placeholders --from ${PLACEHOLDERS_KEY}`, `--step red --from ${RED_KEY}`, `--step green --from ${GREEN_KEY}`, `--step refactor --from ${REFACTOR_CODE_KEY}`, `--step refactor --from ${REFACTOR_TESTS_KEY}`]) {
    test(`the runner's pb checkpoint ${args} is auto-allowed`, async () => {
      const result = await runGate(bashCall(`${PB} checkpoint ${args}`, { agentType: RUNNER_AGENT }));

      assertAutoAllowed(result);
    });
  }

  const CHECKPOINT_NEAR_MISSES = [
    ["an unknown step", `--step rework --from ${RED_KEY}`],
    ["a RED key at refactor", `--step refactor --from ${RED_KEY}`],
    ["a GREEN key at refactor", `--step refactor --from ${GREEN_KEY}`],
    ["a finder's key at refactor", "--step refactor --from code-tdd.identify-code-issues.t1.r1.a1"],
    ["a test finder's key at refactor", "--step refactor --from code-tdd.identify-test-issues.t1.r1.a1"],
    ["a refactor key with no test", "--step refactor --from code-tdd.refactor-code.-.r1.a1"],
    ["a refactor key at GREEN", `--step green --from ${REFACTOR_CODE_KEY}`],
    ["a refactor key at RED", `--step red --from ${REFACTOR_TESTS_KEY}`],
    ["a config key at RED", `--step red --from ${CONFIG_KEY}`],
    ["a GREEN key at RED", `--step red --from ${GREEN_KEY}`],
    ["a RED key at GREEN", `--step green --from ${RED_KEY}`],
    ["a RED key at config", `--step config --from ${RED_KEY}`],
    ["a RED key at placeholders", `--step placeholders --from ${RED_KEY}`],
    ["a RED key with no test", "--step red --from code-tdd.implement-tests.-.r1.a1"],
    ["a GREEN key with no test", "--step green --from code-tdd.implement-code.-.r1.a1"],
    ["a placeholders key with a test", "--step placeholders --from code-tdd.create-test-placeholders.t1.r1.a1"],
    ["a capital step", `--step RED --from ${RED_KEY}`],
    ["a selector after the key", `--step red --from ${RED_KEY} tests/a.py::test_x`],
    ["a select flag after the key", `--step red --from ${RED_KEY} --select tests/a.py::test_x`],
    ["a selector before the step", `tests/a.py::test_x --step red --from ${RED_KEY}`],
    ["a step every object has", `--step constructor --from ${CONFIG_KEY}`],
    ["no key", "--step config"],
    ["no step", `--from ${CONFIG_KEY}`],
    ["swapped flags", `--from ${CONFIG_KEY} --step config`],
    ["an extra flag", `--step config --from ${CONFIG_KEY} --no-verify`],
    ["a flag before the step", `--no-verify --step config --from ${CONFIG_KEY}`],
    ["a malformed key", "--step config --from code-config.apply-config-change.-.r1"],
    ["a key with a path", "--step config --from ../../etc/passwd"],
    ["a key with a capital", "--step config --from Code-config.apply-config-change.-.r1.a1"],
    ["a doubled space", `--step  config --from ${CONFIG_KEY}`],
    ["a trailing space", `--step config --from ${CONFIG_KEY} `],
    ["a tab", `--step config\t--from ${CONFIG_KEY}`],
    ["a command after ;", `--step config --from ${CONFIG_KEY}; rm -rf src`],
    ["a command after &&", `--step config --from ${CONFIG_KEY} && curl https://example.com`],
    ["a newline in the key", `--step config --from ${CONFIG_KEY}\nrm -rf src`],
    ["command substitution in the key", "--step config --from $(whoami).a.-.r1.a1"],
    ["a redirect", `--step config --from ${CONFIG_KEY} > out.txt`],
    ["a pipe", `--step config --from ${CONFIG_KEY} | tee out.txt`],
    ["a background &", `--step config --from ${CONFIG_KEY} &`],
  ];

  for (const [shape, args] of CHECKPOINT_NEAR_MISSES) {
    test(`pb checkpoint with ${shape} loses the auto-allow`, async () => {
      const result = await runGate(bashCall(`${PB} checkpoint ${args}`, { agentType: RUNNER_AGENT }));

      assertNotAutoAllowed(result);
    });
  }

  for (const args of ["tdd state", "stage stop agent-budget", "stage stop step-failed"]) {
    test(`the runner's pb ${args} is auto-allowed`, async () => {
      assertAutoAllowed(await runGate(bashCall(`${PB} ${args}`, { agentType: RUNNER_AGENT })));
    });
  }

  for (const args of ["tdd state t1", "tdd state --tests t1", "tdd  state", "stage stop", "stage stop why-not", "stage stop agent-budget extra", "stage stop  agent-budget", "stage stop constructor"]) {
    test(`pb ${args} loses the auto-allow`, async () => {
      assertNotAutoAllowed(await runGate(bashCall(`${PB} ${args}`, { agentType: RUNNER_AGENT })));
    });
  }

  for (const verb of ["tdd state", "stage stop agent-budget"]) {
    test(`pb ${verb} from the main context is denied, not allowed`, async () => {
      assertWrongCallerDenied(await runGate(bashCall(`${PB} ${verb}`)), verb.split(" ").slice(0, 2).join(" "), OWNER.runner);
    });
  }

  describe("with a plugin path that needs quoting", () => {
    const pluginRoot = "/tmp/sp ace/it's";
    const quoted = `node '/tmp/sp ace/it'\\''s/cli/pb.mjs'`;

    for (const args of ["test --full", "stage finish", `checkpoint --step config --from ${CONFIG_KEY}`, `artifact check ${CONFIG_KEY}`]) {
      test(`the quoted form of pb ${args} is auto-allowed`, async () => {
        assertAutoAllowed(await runGate(bashCall(`${quoted} ${args}`, { agentType: RUNNER_AGENT }), { pluginRoot }));
      });
    }

    test("the unquoted form is not", async () => {
      assertNotAutoAllowed(await runGate(bashCall(`node ${pluginRoot}/cli/pb.mjs test --full`, { agentType: RUNNER_AGENT }), { pluginRoot }));
    });
  });

  test("an env prefix on the checkpoint form loses the auto-allow", async () => {
    const result = await runGate(bashCall(`GIT_CONFIG_GLOBAL=/tmp/evil ${PB} checkpoint --step config --from ${CONFIG_KEY}`, { agentType: RUNNER_AGENT }));

    assertNotAutoAllowed(result);
  });

  test("another plugin's CLI with the checkpoint form loses the auto-allow", async () => {
    const result = await runGate(bashCall(`node /tmp/evil/cli/pb.mjs checkpoint --step config --from ${CONFIG_KEY}`, { agentType: RUNNER_AGENT }));

    assertNotAutoAllowed(result);
  });

  test("the checkpoint form from the main context is denied, not allowed", async () => {
    const result = await runGate(bashCall(`${PB} checkpoint --step config --from ${CONFIG_KEY}`));

    assertWrongCallerDenied(result, "checkpoint", OWNER.runner);
  });

  const NEAR_MISSES = [
    ["a command after ;", `${PB} test; rm -rf src`],
    ["a command after &&", `${PB} test && curl https://example.com`],
    ["two runner verbs", `${PB} test && ${PB} checkpoint`],
    ["|| true", `${PB} test || true`],
    ["a pipe", `${PB} test | tee out.txt`],
    ["a redirect", `${PB} test > out.txt`],
    ["a background &", `${PB} test &`],
    ["a newline", `${PB} test\nrm -rf src`],
    ["command substitution", `${PB} test $(whoami)`],
    ["backticks", `${PB} test \`whoami\``],
    ["an env prefix", `NODE_OPTIONS=--require=/tmp/evil.js ${PB} test`],
    ["a node flag", `node --require /tmp/evil.js ${CLI} test`],
    ["another node binary", `/tmp/evil/node ${CLI} test`],
    ["sh -c", `sh -c '${PB} test'`],
    ["another plugin's CLI", "node /tmp/evil/cli/pb.mjs test"],
    ["a relative path", "node cli/pb.mjs test"],
    ["a bare pb", "pb test"],
    ["an unknown flag", `${PB} test --rootdir=/tmp/evil`],
    ["an unknown runner subcommand", `${PB} stage finish-all`],
  ];

  for (const [shape, command] of NEAR_MISSES) {
    test(`${shape} loses the auto-allow`, async () => {
      const result = await runGate(bashCall(command, { agentType: RUNNER_AGENT }));

      assertNotAutoAllowed(result);
    });
  }

  for (const agentType of ["runner", "pbprobe:runner", "pairingbuddy:runner-2"]) {
    test(`the look-alike agent ${agentType} is denied a runner verb`, async () => {
      const result = await runGate(bashCall(`${PB} test`, { agentType }));

      assertWrongCallerDenied(result, "test", OWNER.runner);
    });
  }
});

// Every call runs in RUN_REPO, which holds a run ledger, so the git and gh rows are denied by D17 and the row names the rule it expects.
describe("deny messages do not advertise pb human abandon", IN_PARALLEL, () => {
  const DENIALS = [
    ["pb human abandon itself", `${PB} human abandon`, undefined, /pb human/],
    ["another human verb", `${PB} human approve g1`, undefined, /pb human/],
    ["a runner verb from main context", `${PB} test`, undefined, /runner/i],
    ["a main verb from a subagent", `${PB} publish`, "pairingbuddy:apply-config-change", /main context/i],
    ["git push during a run", "git push", undefined, /git push is denied during a run/],
    ["gh pr merge during a run", "gh pr merge 3", undefined, /gh pr merge is denied during a run/],
    ["gh pr create during a run", "gh pr create --fill", undefined, /gh pr create, edit, ready/],
    ["git reset --hard during a run", "git reset --hard", undefined, /Nothing reverts during a run/],
    ["a hook-skipping commit during a run", "git commit --no-verify -m x", undefined, /skips hooks or signing/],
    ["a subagent's commit during a run", "git commit -m x", "pairingbuddy:apply-config-change", /Subagents do not commit/],
    ["a subagent's push to main during a run", "git push origin main", "pairingbuddy:apply-config-change", /git push is denied during a run/],
  ];

  for (const [name, command, agentType, expected] of DENIALS) {
    test(`deny of ${name}`, async () => {
      const result = await runGate(bashCall(command, { agentType }));

      const reason = denialReason(result);

      assert.match(reason, expected, "the deny comes from the intended rule");
      assert.doesNotMatch(reason, /abandon/i);
    });
  }
});

// The fixture's own session is bound to RUN_REPO by the tests above, and a bound session is in that run from any cwd.
const NEVER_IN_A_RUN = "never-in-a-run";

describe("what counts as a run", IN_PARALLEL, () => {
  test("a unit run with no task ledger still denies pb human", async () => {
    const dir = makeRepo();
    mkdirSync(join(dir, ".pairingbuddy", "run"), { recursive: true });
    writeFileSync(join(dir, ".pairingbuddy", "run", "unit.json"), "{}");

    const result = await runGate(bashCall(HUMAN, { cwd: dir }));

    assertHumanDenied(result);
  });

  test("outside a run a human verb gets no decision", async () => {
    const result = await runGate(bashCall(HUMAN, { cwd: makeRepo(), session: NEVER_IN_A_RUN }));

    assertSilent(result);
  });

  test("outside a run the runner's exact command gets no decision", async () => {
    const result = await runGate(bashCall(`${PB} test`, { agentType: RUNNER_AGENT, cwd: makeRepo() }));

    assertSilent(result);
  });

  test("outside a run Bash loads nothing beyond the wrapper, which keeps latency near 50 ms", async () => {
    const plugin = makeDir("verbs-plugin-");
    mkdirSync(join(plugin, "hooks"));
    copyFileSync(BOOT, join(plugin, "hooks", "gate-boot.mjs"));
    copyFileSync(GATE, join(plugin, "hooks", "gate.mjs"));

    const result = await runGate(bashCall("uv run pytest", { cwd: makeRepo(), session: NEVER_IN_A_RUN }), { gate: join(plugin, "hooks", "gate-boot.mjs") });

    assertSilent(result);
  });

  test("outside a run a main-context Read, Grep or Glob loads nothing beyond the wrapper either", async () => {
    const plugin = makeDir("verbs-plugin-");
    mkdirSync(join(plugin, "hooks"));
    mkdirSync(join(plugin, "shared-node"));
    copyFileSync(BOOT, join(plugin, "hooks", "gate-boot.mjs"));
    copyFileSync(GATE, join(plugin, "hooks", "gate.mjs"));
    const loaded = join(plugin, "gate-rules-was-loaded");
    // A module that records its own import: any lazy load on this path leaves the marker.
    writeFileSync(join(plugin, "shared-node", "gate-rules.mjs"), `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(loaded)}, "x");\nexport const checkCall = () => null;\nexport const assertReadConfined = () => {};\n`);
    const repo = makeRepo();
    const calls = [
      ["Read", { file_path: join(repo, "a.txt") }],
      ["Grep", { pattern: "x", path: repo }],
      ["Glob", { pattern: "*.md" }],
    ];

    for (const [tool_name, tool_input] of calls) {
      const payload = { ...bashCall("", { cwd: repo, session: NEVER_IN_A_RUN }), tool_name, tool_input };
      assertSilent(await runGate(payload, { gate: join(plugin, "hooks", "gate-boot.mjs") }));
    }

    assert.equal(existsSync(loaded), false, "a main-context read with no run must not import gate-rules");
  });
});

describe("a Bash call with no usable command fails closed during a run", IN_PARALLEL, () => {
  const MALFORMED = [
    ["no command", {}],
    ["a non-string command", { command: 42 }],
    ["an empty command", { command: "" }],
  ];

  for (const [name, toolInput] of MALFORMED) {
    test(`${name} is denied`, async () => {
      const result = await runGate(bashCall("", { toolInput }));

      assert.match(denialReason(result), /command/i);
    });
  }
});

test("the gate's PreToolUse matcher covers Bash", () => {
  const { hooks } = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));

  const entry = hooks.PreToolUse.find(({ hooks: list }) => list.some(({ command }) => command.includes("hooks/gate-boot.mjs")));

  assert.ok(new RegExp(`^(?:${entry.matcher})$`).test("Bash"), `matcher ${entry.matcher} must cover Bash`);
});

describe("the verb table", () => {
  test("shared-node/verbs.mjs holds D5's verbs by class", async () => {
    const { VERB_CLASSES } = await import(VERBS_MODULE);

    assert.deepEqual(VERB_CLASSES, { runner: RUNNER_VERBS, main: MAIN_VERBS, human: HUMAN_VERBS });
  });

  test("each verb belongs to one class", async () => {
    const { VERB_CLASSES } = await import(VERBS_MODULE);

    const verbs = Object.values(VERB_CLASSES).flat();

    assert.equal(new Set(verbs).size, verbs.length);
  });

  test("the CLI dispatches only verbs from the table", async () => {
    const { VERB_CLASSES } = await import(VERBS_MODULE);
    const { VERBS } = await import(CLI);

    const unlisted = Object.keys(VERBS).filter((verb) => !Object.values(VERB_CLASSES).flat().includes(verb));

    assert.deepEqual(unlisted, []);
  });

  test("the CLI's unknown-verb message does not advertise pb human abandon", () => {
    const result = spawnSync(process.execPath, [CLI, "frobnicate"], { encoding: "utf8" });

    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stderr, /abandon/i);
  });
});
