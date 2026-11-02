// Task 27: pb human approve and pb human accept. Every test drives the real hooks and the real CLI as
// subprocesses, against a temp git repo. A shared `pb` helper proves on every call, success or refusal,
// that neither verb prints the abandon exit.
//
// Output contract:
//   approve: {ok, gate, source:"human-cli"}, recording {source:"human-cli", answer:"approve"}
//   accept:  {ok, oldSha, newSha, seq}, appending the same three fields to ledger.acceptances
//   oldSha is the sha the file carried. newSha is the sha of the content as edited, before the acceptance is
//   added: the ledger's own sha covers the acceptance, so it cannot appear inside what it signs.
// A refusal exits 1, bad arguments exit 2, and neither changes a byte of the ledger.
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const PAYLOADS = join(ROOT, "tests", "probes", "fixtures", "payloads");
const fixture = (name) => JSON.parse(readFileSync(join(PAYLOADS, name), "utf8"));

const FIRST = "first-stage";
const SECOND = "second-stage";
const G_FIRST = "G:first";
const G_SECOND = "G:second";
const TWO_GATES = "two_gates";
const SESSION = "session-one";
const CONFIG_TEXT = '{"runners":{}}\n';
const HEX64 = /^[0-9a-f]{64}$/;

const tempDirs = [];
function makeDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makePlugin() {
  const dir = makeDir("pb-human-plugin-");
  for (const part of ["cli", "hooks", "shared-node", "contracts"]) cpSync(join(ROOT, part), join(dir, part), { recursive: true });
  mkdirSync(join(dir, "workflows"));
  const contractPath = join(dir, "contracts", "stages.json");
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  contract.taskTypes[TWO_GATES] = {
    nodes: [{ name: FIRST, gate: G_FIRST, evidence: [] }, { name: SECOND, gate: G_SECOND, evidence: [] }],
    gates: { [G_FIRST]: { class: "decide" }, [G_SECOND]: { class: "decide" } },
  };
  writeFileSync(contractPath, JSON.stringify(contract));
  for (const stage of [FIRST, SECOND]) writeFileSync(join(dir, "workflows", `${stage}.js`), `export const meta = { name: '${stage}' };\n`);
  return dir;
}

const PLUGIN = makePlugin();
const CLI = join(PLUGIN, "cli", "pb.mjs");

const doneStages = (...names) => names.map((name) => ({ name, status: "done" }));

function makeLedger(done, over) {
  const stage = done.length === 0
    ? { name: "", status: "", runId: null, attempt: 0, startedAt: null }
    : { name: done[done.length - 1], status: "done", runId: "wf_1", attempt: 1, startedAt: null };
  return {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: TWO_GATES,
    owner: { sessionId: null, lastSeen: null }, task: "Task 27",
    plan: { path: "", title: "" }, configHash: createHash("sha256").update(CONFIG_TEXT).digest("hex"),
    policy: { mode: "", source: "" }, stage, stages: doneStages(...done),
    gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 },
    stop: null, needsHuman: null,
    ...over,
  };
}

// A run whose first stage is done, so G:first is due.
function makeRepo({ done = [FIRST], ledger = {} } = {}) {
  const dir = makeDir("pb-human-");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), CONFIG_TEXT);
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, makeLedger(done, ledger));
  return { dir, ledgerPath, ledger: () => readLedger(ledgerPath), bytes: () => readFileSync(ledgerPath, "utf8") };
}

function pb(repo, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...args], { cwd: repo.dir, env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN }, encoding: "utf8" });
  assert.doesNotMatch(`${stdout}${stderr}`, /abandon/i, "pb must not advertise the abandon exit");
  return { code: status, stdout, stderr };
}

const approve = (repo, ...args) => pb(repo, "human", "approve", ...args);
const accept = (repo, ...args) => pb(repo, "human", "accept", ...args);

function runGate(repo, payload) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(PLUGIN, "hooks", "gate.mjs")], { cwd: repo.dir, input: JSON.stringify(payload), env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN }, encoding: "utf8" });
  return { code: status, stdout, stderr };
}

const decisionOf = (result) => (result.stdout === "" ? null : JSON.parse(result.stdout).hookSpecificOutput);

function succeeded(result) {
  assert.equal(result.code, 0, `the verb succeeds, stderr: ${result.stderr}`);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

// Every refusal is a clean one: a `pb:` line naming the problem, no crash, and an untouched ledger.
function assertRefuses(repo, run, pattern, code = 1) {
  const before = repo.bytes();
  const result = run();
  assert.equal(result.code, code, `refuses with exit ${code}: stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(result.stdout, "", "a refusal prints no result");
  assert.match(result.stderr, pattern);
  assert.doesNotMatch(result.stderr, /unexpected failure/, "a refusal is not a crash");
  assert.equal(repo.bytes(), before, "a refusal leaves the ledger alone");
}

function stageCall(repo, stage) {
  return {
    ...fixture("pretooluse-workflow.json"), session_id: SESSION, cwd: repo.dir, permission_mode: "default",
    tool_input: { name: `pairingbuddy:${stage}`, args: { pluginRoot: PLUGIN, attempt: 1 } },
  };
}

function gateAnswerPayload(repo, gate, answer) {
  const recorded = fixture("posttooluse-askuserquestion.json");
  const text = `Approve ${gate}?`;
  const question = {
    question: text, header: `PB gate: ${gate}`, multiSelect: false,
    options: [
      { label: "approve", description: "Approve this gate and let the run continue." },
      { label: "redo", description: "Redo the stage before this gate." },
      { label: "stop", description: "Stop here." },
    ],
  };
  const response = { ...recorded.tool_input, questions: [question], answers: { [text]: answer } };
  return { ...recorded, session_id: SESSION, cwd: repo.dir, tool_input: response, tool_response: response };
}

function askedRepo(opts) {
  const repo = makeRepo(opts);
  const asked = succeeded(pb(repo, "gate", "eval"));
  assert.equal(asked.result, "needs-human");
  return { repo, asked };
}

// What a human edit does: the file changes, its sha does not.
function handEdit(repo, edit = (text) => text.replace('"task": "Task 27"', '"task": "Edited by hand"')) {
  const before = repo.bytes();
  writeFileSync(repo.ledgerPath, edit(before));
  assert.notEqual(repo.bytes(), before, "the edit changed the file");
}

const disk = (repo) => JSON.parse(repo.bytes());

// Written out here so the test does not read its answer from the code it checks.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentSha({ sha: _sha, ...content }) {
  return createHash("sha256").update(canonical(content)).digest("hex");
}

// ---------- approve ----------

describe("pb human approve passes a gate", () => {
  test("a pending gate is recorded with source human-cli, and needsHuman clears", () => {
    const { repo } = askedRepo();

    const output = succeeded(approve(repo, G_FIRST));

    assert.deepEqual(output, { ok: true, gate: G_FIRST, source: "human-cli" });
    assert.deepEqual(repo.ledger().gates[G_FIRST], { source: "human-cli", answer: "approve" });
    assert.equal(repo.ledger().needsHuman, null);
  });

  test("a due gate that was never evaluated can be approved", () => {
    const repo = makeRepo();

    succeeded(approve(repo, G_FIRST));

    assert.equal(repo.ledger().gates[G_FIRST]?.source, "human-cli");
  });

  test("the next stage is denied before the approval and starts after it, through the real gate", () => {
    const { repo } = askedRepo();
    const denied = decisionOf(runGate(repo, stageCall(repo, SECOND)));
    assert.equal(denied?.permissionDecision, "deny", "the gate blocks the next stage first");
    assert.match(denied.permissionDecisionReason, new RegExp(G_FIRST));

    succeeded(approve(repo, G_FIRST));
    const result = runGate(repo, stageCall(repo, SECOND));

    assert.equal(result.code, 0, result.stderr);
    assert.notEqual(decisionOf(result)?.permissionDecision, "deny", result.stdout);
    assert.equal(repo.ledger().stage.name, SECOND, "the stage started");
  });

  test("a gate needing a human through the printed command works as printed", () => {
    const { repo, asked } = askedRepo();
    assert.ok(asked.humanCommand.includes(CLI), "the command names this CLI");

    const result = spawnSync("sh", ["-c", asked.humanCommand.slice(1)], { cwd: makeDir("pb-human-elsewhere-"), env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN }, encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(repo.ledger().gates[G_FIRST]?.source, "human-cli");
  });

  test("it works from a subdirectory of the run", () => {
    const repo = makeRepo();
    const sub = join(repo.dir, "src");
    mkdirSync(sub);

    succeeded(approve({ ...repo, dir: sub }, G_FIRST));

    assert.equal(repo.ledger().gates[G_FIRST]?.source, "human-cli");
  });

  test("the later fields of the ledger survive", () => {
    const repo = makeRepo({ ledger: { gates: { other: { source: "auto" } }, commits: ["abc"] } });

    succeeded(approve(repo, G_FIRST));

    assert.deepEqual(repo.ledger().gates.other, { source: "auto" });
    assert.deepEqual(repo.ledger().commits, ["abc"]);
  });
});

describe("pb human approve is the way out of a redo or a stop", () => {
  for (const answer of ["redo", "stop"]) {
    test(`a record of ${answer} is replaced by the approval`, () => {
      const repo = makeRepo({ ledger: { gates: { [G_FIRST]: { source: "human", answer } } } });

      succeeded(approve(repo, G_FIRST));

      assert.deepEqual(repo.ledger().gates[G_FIRST], { source: "human-cli", answer: "approve" });
    });
  }

  test("a stop the gate's answer set is cleared", () => {
    const repo = makeRepo({ ledger: { gates: { [G_FIRST]: { source: "human", answer: "stop" } }, stop: { reason: `the human answered stop at ${G_FIRST}`, seq: 1 } } });

    succeeded(approve(repo, G_FIRST));

    assert.equal(repo.ledger().stop, null);
  });

  test("a gate answered redo can still be approved before the stage restarts, and the stage reads done again", () => {
    const { repo } = askedRepo();
    const tapped = spawnSync(process.execPath, [join(PLUGIN, "hooks", "tap.mjs")], { cwd: repo.dir, input: JSON.stringify(gateAnswerPayload(repo, G_FIRST, "redo")), env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN }, encoding: "utf8" });
    assert.equal(tapped.status, 0, tapped.stderr);
    assert.equal(Object.hasOwn(repo.ledger().gates, G_FIRST), false, "the redo cleared the record");

    succeeded(approve(repo, G_FIRST));

    assert.deepEqual(repo.ledger().gates[G_FIRST], { source: "human-cli", answer: "approve" });
    assert.equal(repo.ledger().stage.status, "done");
    assert.ok(repo.ledger().stages.some(({ name, status }) => name === FIRST && status === "done"));
    const result = runGate(repo, stageCall(repo, SECOND));
    assert.notEqual(decisionOf(result)?.permissionDecision, "deny", result.stdout);
  });

  test("once the redo has restarted the stage, its gate is no longer the human's to pass", () => {
    const repo = makeRepo({ ledger: { stage: { name: FIRST, status: "active", runId: "wf_2", attempt: 2, startedAt: null }, stages: [{ name: FIRST, status: "redo" }] } });

    assertRefuses(repo, () => approve(repo, G_FIRST), /G:first/);
  });
});

describe("pb human approve refuses a gate that is neither due nor pending", () => {
  test("a gate no contract names", () => {
    const repo = makeRepo();
    assertRefuses(repo, () => approve(repo, "G:nonsense"), /G:nonsense/);
  });

  test("an object prototype name", () => {
    const repo = makeRepo();
    assertRefuses(repo, () => approve(repo, "__proto__"), /__proto__/);
  });

  test("a gate whose stage has not finished", () => {
    const repo = makeRepo({ done: [] });
    assertRefuses(repo, () => approve(repo, G_FIRST), /G:first/);
  });

  test("a later gate while an earlier one is due", () => {
    const repo = makeRepo({ done: [FIRST, SECOND] });
    assertRefuses(repo, () => approve(repo, G_SECOND), /G:second/);
  });

  test("a gate that is due while another is pending", () => {
    const repo = makeRepo({ done: [FIRST, SECOND], ledger: { needsHuman: { gate: G_SECOND, reason: "asked", seq: 1 } } });
    assertRefuses(repo, () => approve(repo, G_FIRST), /G:first/);
    assert.equal(repo.ledger().needsHuman?.gate, G_SECOND, "the pending gate is still pending");
  });

  test("a gate already approved", () => {
    const repo = makeRepo();
    succeeded(approve(repo, G_FIRST));
    assertRefuses(repo, () => approve(repo, G_FIRST), /G:first/);
  });

  test("an auto pass is not overwritten", () => {
    const repo = makeRepo({ ledger: { gates: { [G_FIRST]: { source: "auto" } } } });
    assertRefuses(repo, () => approve(repo, G_FIRST), /G:first/);
  });

  test("the refusal names the gate that is waiting", () => {
    const repo = makeRepo();
    assertRefuses(repo, () => approve(repo, "G:nonsense"), /G:first/);
  });
});

describe("pb human approve refuses over a SHA mismatch", () => {
  test("it points to accept and leaves the ledger alone", () => {
    const { repo } = askedRepo();
    handEdit(repo);

    assertRefuses(repo, () => approve(repo, G_FIRST), /sha mismatch[\s\S]*human accept/);
  });

  test("the accept it points to clears the way", () => {
    const { repo } = askedRepo();
    handEdit(repo);
    succeeded(accept(repo));

    succeeded(approve(repo, G_FIRST));

    assert.equal(repo.ledger().gates[G_FIRST]?.source, "human-cli");
  });
});

describe("pb human approve usage", () => {
  test("no gate", () => {
    const repo = makeRepo();
    assertRefuses(repo, () => approve(repo), /usage: pb human approve <gate>/, 2);
  });

  test("a second argument", () => {
    const repo = makeRepo();
    assertRefuses(repo, () => approve(repo, G_FIRST, "extra"), /usage: pb human approve <gate>/, 2);
  });

  test("no run here", () => {
    const repo = makeRepo();
    const elsewhere = { dir: makeDir("pb-human-elsewhere-") };

    const result = approve(elsewhere, G_FIRST);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /no run/);
    assert.equal(repo.ledger().gates[G_FIRST], undefined);
  });
});

// ---------- accept ----------

describe("pb human accept re-signs an edited ledger", () => {
  test("the edited ledger reads again and keeps the edit", () => {
    const repo = makeRepo();
    handEdit(repo);

    succeeded(accept(repo));

    assert.equal(repo.ledger().task, "Edited by hand");
  });

  test("the acceptance is recorded with the old and new SHA", () => {
    const repo = makeRepo();
    const oldSha = repo.ledger().sha;
    handEdit(repo);
    const newSha = contentSha(disk(repo));
    assert.notEqual(newSha, oldSha);
    const seq = disk(repo).seq + 1;

    const output = succeeded(accept(repo));

    assert.deepEqual(output, { ok: true, oldSha, newSha, seq });
    assert.deepEqual(repo.ledger().acceptances, [{ oldSha, newSha, seq }]);
  });

  test("it advances seq, and the recorded fields are covered by the ledger's own sha", () => {
    const repo = makeRepo();
    handEdit(repo);
    const { seq } = disk(repo);

    succeeded(accept(repo));

    const ledger = repo.ledger();
    assert.equal(ledger.seq, seq + 1);
    assert.match(ledger.sha, HEX64);
    assert.equal(ledger.sha, contentSha(ledger));
    handEdit(repo, (text) => text.replace(/"oldSha": "[0-9a-f]{64}"/, `"oldSha": "${"1".repeat(64)}"`));
    assert.throws(() => repo.ledger(), /sha mismatch/, "tampering with the record is itself a mismatch");
  });

  test("an edit that changes seq is accepted from the edited value", () => {
    const repo = makeRepo();
    handEdit(repo, (text) => text.replace('"seq": 1', '"seq": 41'));

    assert.equal(succeeded(accept(repo)).seq, 42);
    assert.equal(repo.ledger().seq, 42);
  });

  test("ordinary writes go on working afterwards", () => {
    const { repo } = askedRepo();
    handEdit(repo);
    succeeded(accept(repo));

    succeeded(approve(repo, G_FIRST));

    assert.equal(repo.ledger().acceptances.length, 1, "later writes keep the acceptance");
  });

  test("a second edit adds a second acceptance after the first", () => {
    const repo = makeRepo();
    handEdit(repo);
    const first = succeeded(accept(repo));
    handEdit(repo, (text) => text.replace("Edited by hand", "Edited twice"));

    const second = succeeded(accept(repo));

    assert.equal(second.oldSha, repo.ledger().acceptances[1].oldSha);
    assert.notEqual(second.newSha, first.newSha);
    assert.deepEqual(repo.ledger().acceptances, [
      { oldSha: first.oldSha, newSha: first.newSha, seq: first.seq },
      { oldSha: second.oldSha, newSha: second.newSha, seq: second.seq },
    ]);
  });

  test("the gate hook reads the ledger again after an accept", () => {
    const repo = makeRepo();
    handEdit(repo);
    const before = decisionOf(runGate(repo, stageCall(repo, FIRST)));
    assert.equal(before?.permissionDecision, "deny", "a mismatch denies");
    assert.match(before.permissionDecisionReason, /sha mismatch/);

    succeeded(accept(repo));
    const after = decisionOf(runGate(repo, stageCall(repo, SECOND)));

    assert.doesNotMatch(after?.permissionDecisionReason ?? "", /sha mismatch/);
  });
});

describe("pb human accept refuses", () => {
  const brokenFiles = [
    ["corrupt JSON", () => '{"v":1,', /not valid JSON/],
    ["an empty file", () => "", /not valid JSON/],
    ["a JSON array", () => "[]\n", /invalid|version/],
    ["a JSON null", () => "null\n", /invalid|version/],
  ];

  for (const [name, contents, pattern] of brokenFiles) {
    test(name, () => {
      const repo = makeRepo();
      writeFileSync(repo.ledgerPath, contents());
      assertRefuses(repo, () => accept(repo), pattern);
    });
  }

  const badShapes = [
    ["a missing required key", (text) => text.replace('"stop": null,\n', ""), /stop is required/],
    ["an unknown key", (text) => text.replace('"task":', '"extra": 1,\n  "task":'), /extra is not allowed/],
    ["a wrong type", (text) => text.replace('"seq": 1', '"seq": -1'), /seq must be/],
    ["an unsupported version", (text) => text.replace('"v": 1', '"v": 2'), /\bv\b/],
    ["a malformed sha", (text) => text.replace(/"sha": "[0-9a-f]{64}"/, '"sha": "nope"'), /sha must be/],
    ["a number JSON cannot hold", (text) => text.replace('"attempt": 1', '"attempt": 1e999'), /non-finite/],
    ["a malformed acceptance", (text) => text.replace('"task":', '"acceptances": [{"oldSha": "x"}],\n  "task":'), /acceptances/],
  ];

  for (const [name, edit, pattern] of badShapes) {
    test(name, () => {
      const repo = makeRepo();
      handEdit(repo, edit);
      assertRefuses(repo, () => accept(repo), pattern);
    });
  }

  test("a ledger with no mismatch", () => {
    const repo = makeRepo();
    assertRefuses(repo, () => accept(repo), /no sha mismatch/i);
  });

  test("an accept with nothing new since the last one", () => {
    const repo = makeRepo();
    handEdit(repo);
    succeeded(accept(repo));
    assertRefuses(repo, () => accept(repo), /no sha mismatch/i);
  });

  test("any argument, so a later --legacy cannot re-sign by accident", () => {
    const repo = makeRepo();
    handEdit(repo);
    assertRefuses(repo, () => accept(repo, "--legacy", "unit-1"), /usage: pb human accept/, 2);
  });

  test("no run here", () => {
    const result = accept({ dir: makeDir("pb-human-elsewhere-") });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /no run/);
  });
});

// ---------- only a human ----------

const RUNNER_AGENT = "pairingbuddy:runner";
const CALLERS = [
  { caller: "the main context", agentType: undefined },
  { caller: "the runner agent", agentType: RUNNER_AGENT },
  { caller: "a pipeline subagent", agentType: "pairingbuddy:apply-config-change" },
  { caller: "a plain workflow agent", agentType: "workflow-subagent" },
];

const HUMAN_LINES = [`human approve ${G_FIRST}`, "human accept"];

const COMMAND_FORMS = [
  ["the printed path", (line) => `node ${CLI} ${line}`],
  ["a pasted ! line", (line) => `!node ${CLI} ${line}`],
  ["a pasted ! line with a space", (line) => `! node ${CLI} ${line}`],
  ["a bare pasted !pb", (line) => `!pb ${line}`],
];

function bashCall(repo, command, agentType) {
  const base = agentType === undefined ? fixture("pretooluse-workflow.json") : { ...fixture("pretooluse-workflow-agent-bash.json"), agent_type: agentType };
  return { ...base, session_id: SESSION, cwd: repo.dir, permission_mode: "default", tool_name: "Bash", tool_input: { command, description: "run it" } };
}

function assertToldToType(result) {
  assert.equal(result.code, 0, result.stderr);
  const decision = decisionOf(result);
  assert.equal(decision?.permissionDecision, "deny", `the hook must deny: ${result.stdout}`);
  assert.match(decision.permissionDecisionReason, /\btype\b/i, "the deny tells the human to type it");
  assert.match(decision.permissionDecisionReason, /!/, "the deny names the !");
  assert.doesNotMatch(decision.permissionDecisionReason, /abandon/i);
}

describe("a tool call cannot run either verb", () => {
  const shared = makeRepo();

  for (const { caller, agentType } of CALLERS) {
    for (const line of HUMAN_LINES) {
      for (const [form, command] of COMMAND_FORMS) {
        test(`${caller}, pb ${line}, as ${form}`, () => {
          const before = shared.bytes();

          assertToldToType(runGate(shared, bashCall(shared, command(line), agentType)));

          assert.equal(shared.bytes(), before, "the deny records nothing");
        });
      }
    }
  }

  test("the exact humanCommand that gate eval prints, pasted by the model, is denied", () => {
    const { repo, asked } = askedRepo();

    assertToldToType(runGate(repo, bashCall(repo, asked.humanCommand, undefined)));

    assert.equal(repo.ledger().needsHuman?.gate, G_FIRST, "the gate is still waiting");
    assert.equal(repo.ledger().gates[G_FIRST], undefined);
  });

  for (const { caller, agentType } of CALLERS) {
    test(`${caller} is denied accept on an edited ledger, which stays edited`, () => {
      const repo = makeRepo();
      handEdit(repo);
      const before = repo.bytes();

      assertToldToType(runGate(repo, bashCall(repo, `node ${CLI} human accept`, agentType)));

      assert.equal(repo.bytes(), before);
    });

    test(`${caller} is denied accept on a corrupt ledger`, () => {
      const repo = makeRepo();
      writeFileSync(repo.ledgerPath, "{");

      assertToldToType(runGate(repo, bashCall(repo, `node ${CLI} human accept`, agentType)));
    });
  }
});
