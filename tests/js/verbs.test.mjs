import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeLedger } from "../../shared-node/ledger.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const GATE = join(ROOT, "hooks", "gate.mjs");
const CLI = join(ROOT, "cli", "pb.mjs");
const VERBS_MODULE = join(ROOT, "shared-node", "verbs.mjs");
const PAYLOADS = join(ROOT, "tests", "probes", "fixtures", "payloads");
const fixture = (name) => JSON.parse(readFileSync(join(PAYLOADS, name), "utf8"));

// Each spawn is a read of one shared run: the gate's Bash path never writes the ledger.
const IN_PARALLEL = { concurrency: 8 };

// The runner's exact command: this plugin's CLI by absolute path, one runner verb, no shell syntax.
const PB = `node ${CLI}`;

// D5, written out here so the test does not read its answer from the table it checks.
const RUNNER_VERBS = ["test", "checkpoint", "stage finish", "snapshot", "artifact check"];
const MAIN_VERBS = ["unit open", "run open", "stage report", "stage fail", "gate eval", "task end", "plan next", "publish", "status", "git doctor"];
const HUMAN_VERBS = ["human approve", "human abandon", "human accept"];

// Rows of the class matrix. A human row carries an argument because the real calls have one.
const VERB_ROWS = [
  ...RUNNER_VERBS.map((verb) => ({ verb, line: verb, verbClass: "runner" })),
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

function bashCall(command, { agentType, cwd = RUN_REPO, toolInput = { command, description: "run it" } } = {}) {
  const base = agentType === undefined ? fixture("pretooluse-workflow.json") : { ...fixture("pretooluse-workflow-agent-bash.json"), agent_type: agentType };
  return { ...base, cwd, permission_mode: "default", tool_name: "Bash", tool_input: toolInput };
}

function runGate(payload, { gate = GATE } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [gate], {
      cwd: payload.cwd,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT },
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
  ["a commit message", 'git commit -m "fix pb test"'],
  ["a grep pattern", "grep 'pb test' f"],
  ["an echoed line", "echo pb publish"],
  ["a wrapped argument", "timeout 5 grep 'pb test' f"],
  ["a quoted sh -c argument", "sh -c 'grep \"pb test\" f'"],
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
];

describe("a real pb invocation keeps its deny", IN_PARALLEL, () => {
  for (const [shape, agentType, command, verb, owner] of REAL_INVOCATIONS) {
    test(`${shape} is denied`, async () => {
      const result = await runGate(bashCall(command, { agentType }));

      assertWrongCallerDenied(result, verb, owner);
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

describe("deny messages do not advertise pb human abandon", IN_PARALLEL, () => {
  const DENIALS = [
    ["pb human abandon itself", `${PB} human abandon`, undefined],
    ["another human verb", `${PB} human approve g1`, undefined],
    ["a runner verb from main context", `${PB} test`, undefined],
    ["a main verb from a subagent", `${PB} publish`, "pairingbuddy:apply-config-change"],
  ];

  for (const [name, command, agentType] of DENIALS) {
    test(`deny of ${name}`, async () => {
      const result = await runGate(bashCall(command, { agentType }));

      const reason = denialReason(result);

      assert.doesNotMatch(reason, /abandon/i);
    });
  }
});

describe("what counts as a run", IN_PARALLEL, () => {
  test("a unit run with no task ledger still denies pb human", async () => {
    const dir = makeRepo();
    mkdirSync(join(dir, ".pairingbuddy", "run"), { recursive: true });
    writeFileSync(join(dir, ".pairingbuddy", "run", "unit.json"), "{}");

    const result = await runGate(bashCall(HUMAN, { cwd: dir }));

    assertHumanDenied(result);
  });

  test("outside a run a human verb gets no decision", async () => {
    const result = await runGate(bashCall(HUMAN, { cwd: makeRepo() }));

    assertSilent(result);
  });

  test("outside a run the runner's exact command gets no decision", async () => {
    const result = await runGate(bashCall(`${PB} test`, { agentType: RUNNER_AGENT, cwd: makeRepo() }));

    assertSilent(result);
  });

  test("outside a run Bash loads nothing beyond the wrapper, which keeps latency near 50 ms", async () => {
    const plugin = makeDir("verbs-plugin-");
    mkdirSync(join(plugin, "hooks"));
    copyFileSync(GATE, join(plugin, "hooks", "gate.mjs"));

    const result = await runGate(bashCall("uv run pytest", { cwd: makeRepo() }), { gate: join(plugin, "hooks", "gate.mjs") });

    assertSilent(result);
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

  const entry = hooks.PreToolUse.find(({ hooks: list }) => list.some(({ command }) => command.includes("hooks/gate.mjs")));

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
