import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A lab run's human answered "Use skill pairingbuddy:intake?" before each stage: the Skill tool only loads the stage's
// instructions, so the gate lets this plugin's stage skills through. Any other skill keeps its normal permissions.
const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const BOOT = join(ROOT, "hooks", "gate-boot.mjs");
const PAYLOADS = join(ROOT, "tests", "probes", "fixtures", "payloads");
const fixture = (name) => JSON.parse(readFileSync(join(PAYLOADS, name), "utf8"));
const IN_PARALLEL = { concurrency: 8 };

const STAGE_SKILL_ALLOW = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    permissionDecisionReason: "Pairing Buddy stage skill, auto-allowed by the Pairing Buddy gate: it only loads instructions.",
  },
};

const tempDirs = [];
after(() => tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function makeRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "stage-skill-")));
  tempDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

function skillCall(skill, { cwd = makeRepo(), agentType } = {}) {
  const base = agentType === undefined ? fixture("pretooluse-workflow.json") : { ...fixture("pretooluse-workflow-agent-bash.json"), agent_type: agentType };
  return { ...base, session_id: "never-in-a-run", cwd, permission_mode: "default", tool_name: "Skill", tool_input: { skill, args: "{}" } };
}

function runGate(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BOOT], { cwd: payload.cwd, env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

function assertStageSkillAllowed(result) {
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  assert.deepEqual(result.stdout === "" ? null : JSON.parse(result.stdout), STAGE_SKILL_ALLOW);
}

describe("the gate lets this plugin's stage skills load without a prompt", IN_PARALLEL, () => {
  test("Skill pairingbuddy:intake with no run is auto-allowed", async () => {
    assertStageSkillAllowed(await runGate(skillCall("pairingbuddy:intake")));
  });

  // Every workflow that calls itself an internal stage, found the way the gate finds it, so a new stage is covered too.
  const STAGES = readdirSync(join(ROOT, "workflows")).filter((file) => file.endsWith(".js")).map((file) => file.slice(0, -3));

  test("the plugin ships internal stages", () => {
    assert.ok(STAGES.includes("intake") && STAGES.includes("code-tdd") && STAGES.includes("pr-draft"), STAGES.join(", "));
  });

  for (const stage of [...STAGES, "curating-guidance", "setting-up-spike"]) {
    test(`Skill pairingbuddy:${stage} is auto-allowed with no run`, async () => {
      assertStageSkillAllowed(await runGate(skillCall(`pairingbuddy:${stage}`)));
    });
  }

  test("Skill pairingbuddy:code-scenarios is auto-allowed during a run", async () => {
    const cwd = makeRepo();
    mkdirSync(join(cwd, ".pairingbuddy", "run"), { recursive: true });
    writeFileSync(join(cwd, ".pairingbuddy", "run", "unit.json"), "{}");

    assertStageSkillAllowed(await runGate(skillCall("pairingbuddy:code-scenarios", { cwd })));
  });

  test("a subagent's Skill pairingbuddy:code-tdd is auto-allowed", async () => {
    assertStageSkillAllowed(await runGate(skillCall("pairingbuddy:code-tdd", { agentType: "pairingbuddy:implement-code" })));
  });

  const NOT_STAGES = [
    ["the user-facing coding skill", "pairingbuddy:coding"],
    ["a reference skill", "pairingbuddy:writing-tests"],
    ["another plugin's skill of the same name", "other:intake"],
    ["a bare stage name", "intake"],
    ["a name that climbs out of workflows/", "pairingbuddy:../workflows/intake"],
    ["an unknown name", "pairingbuddy:nope"],
  ];

  for (const [shape, skill] of NOT_STAGES) {
    test(`${shape} gets no decision`, async () => {
      assert.deepEqual(await runGate(skillCall(skill)), { code: 0, stdout: "", stderr: "" });
    });
  }
});
