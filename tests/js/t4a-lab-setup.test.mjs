import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";

const { setupLab } = await import("../smoke/t4a-lab.mjs");
const { makeS2Repo, TASK, FEATURE_TASK } = await import("../smoke/s2.mjs");
const { BROKEN_MARKER } = await import("../smoke/broken-plugin.mjs");
const { REPO_ROOT, CHEAP_MODEL } = await import("../smoke/claude-run.mjs");

const git = (repo, ...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const branchOf = (repo) => git(repo, "branch", "--show-current");
const filesOf = (repo) => git(repo, "ls-files").split("\n").sort();

function withTempRoot(body) {
  const root = mkdtempSync(join(tmpdir(), "t4a-lab-setup-"));
  try {
    return body(realpathSync(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const PLACEHOLDER = "placeholder: not implemented";

describe("setup-builds-s2-repo", () => {
  it("builds the bug_fix repo inside the given root's lab dir", () => {
    withTempRoot((root) => {
      const labsRoot = join(root, "labs");
      const { repo: reference } = makeS2Repo(join(root, "reference"), "bug_fix");
      const bug = setupLab({ root: labsRoot, now: new Date(2026, 10, 4, 9, 8, 7) });

      assert.equal(branchOf(bug.repo), branchOf(reference), "the lab repo is on the branch makeS2Repo leaves");
      assert.deepEqual(filesOf(bug.repo), filesOf(reference), "the lab repo holds the files makeS2Repo makes");
      assert.ok(!relative(labsRoot, bug.repo).startsWith(".."), "the lab repo is inside the given root's lab dir");
      assert.equal(readFileSync(bug.task, "utf8").trim(), TASK, "task.txt holds the S2 task");
    });
  });

  it("gives the lab repo a bare origin holding main, with origin/HEAD at main", () => {
    withTempRoot((root) => {
      const lab = setupLab({ root: join(root, "labs"), now: new Date(2026, 10, 4, 9, 8, 6) });

      const origin = git(lab.repo, "remote", "get-url", "origin");
      assert.equal(git(origin, "rev-parse", "--is-bare-repository"), "true", "origin is a bare repo");
      assert.equal(git(origin, "rev-parse", "main"), git(lab.repo, "rev-parse", "main"), "origin holds the lab's main");
      assert.equal(git(lab.repo, "symbolic-ref", "refs/remotes/origin/HEAD"), "refs/remotes/origin/main", "origin/HEAD points at main");
    });
  });

  it("gives a new_feature lab FEATURE_TASK", () => {
    withTempRoot((root) => {
      const feature = setupLab({ root: join(root, "labs"), type: "new_feature", now: new Date(2026, 10, 4, 9, 8, 8) });

      assert.equal(readFileSync(feature.task, "utf8").trim(), FEATURE_TASK, "a new_feature lab gets FEATURE_TASK");
    });
  });
});

const SENTINELS = { CLAUDE_X: "1", PB_Y: "1", GIT_Z: "1", ANTHROPIC_W: "1", PAIRINGBUDDY_V: "1" };

function writeFakeClaude(binDir, dumpPath) {
  const body = `require("node:fs").writeFileSync(${JSON.stringify(dumpPath)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd() }));`;
  mkdirSync(binDir);
  writeFileSync(join(binDir, "claude"), `#!/usr/bin/env node\n${body}\n`);
  chmodSync(join(binDir, "claude"), 0o755);
}

function runStart(root, lab) {
  const name = basename(lab.dir);
  const fakeBin = join(root, `bin-${name}`);
  const dump = join(root, `dump-${name}.json`);
  writeFakeClaude(fakeBin, dump);
  execFileSync("sh", [lab.start], { env: { ...process.env, ...SENTINELS, PATH: `${fakeBin}:${process.env.PATH}` } });
  return JSON.parse(readFileSync(dump, "utf8"));
}

describe("setup-healthy-start-line", () => {
  it("starts an interactive claude in the lab repo with a cleared env and the cheap model", () => {
    withTempRoot((root) => {
      const lab = setupLab({ root: join(root, "labs"), now: new Date(2026, 10, 4, 9, 8, 9) });

      execFileSync("sh", ["-n", lab.start]);
      const seen = runStart(root, lab);

      assert.ok(readFileSync(lab.start, "utf8").startsWith("#!/bin/sh\n"), "start.sh is a sh script");
      assert.deepEqual(seen.argv, ["--plugin-dir", REPO_ROOT, "--model", "haiku", "--setting-sources", "project,local", "--strict-mcp-config", "--permission-mode", "auto", `/pairingbuddy:code ${TASK}`], "claude gets the interactive argv, with no -p");
      for (const name of Object.keys(SENTINELS)) {
        assert.ok(!(name in seen.env), `${name} is cleared before claude starts`);
      }
      assert.equal(seen.env.ANTHROPIC_DEFAULT_OPUS_MODEL, CHEAP_MODEL, "opus maps to the cheap model");
      assert.equal(seen.env.ANTHROPIC_DEFAULT_SONNET_MODEL, CHEAP_MODEL, "sonnet maps to the cheap model");
      assert.equal(realpathSync(seen.cwd), realpathSync(lab.repo), "claude starts in the lab repo");
    });
  });
});

describe("setup-gh-shim", () => {
  it("puts a recording gh shim inside the lab dir first on PATH, logging inside the lab dir", () => {
    withTempRoot((root) => {
      const lab = setupLab({ root: join(root, "labs"), now: new Date(2026, 10, 4, 9, 8, 5) });

      const seen = runStart(root, lab);
      const shimDir = seen.env.PATH.split(":")[0];
      execFileSync(join(shimDir, "gh"), ["pr", "create", "--head", "x"], { env: seen.env });
      const calls = readFileSync(seen.env.GH_SHIM_LOG, "utf8").trim().split("\n").map((line) => JSON.parse(line));

      assert.ok(!relative(lab.dir, shimDir).startsWith(".."), "the first PATH entry is inside the lab dir");
      assert.ok(!relative(lab.dir, seen.env.GH_SHIM_LOG).startsWith(".."), "the shim logs inside the lab dir");
      assert.deepEqual(calls.map(({ argv }) => argv), [["pr", "create", "--head", "x"]], "the gh there records its calls");
    });
  });
});

describe("setup-plugin-dir", () => {
  it("starts claude with the given plugin dir instead of REPO_ROOT, and the CLI takes --plugin-dir", () => {
    withTempRoot((root) => {
      const other = join(root, "other-checkout");
      mkdirSync(other);
      const lab = setupLab({ root: join(root, "labs"), pluginDir: other, now: new Date(2026, 10, 4, 9, 8, 4) });

      const seen = runStart(root, lab);
      const out = execFileSync("node", [join(REPO_ROOT, "tests/smoke/t4a-lab.mjs"), "setup", "--plugin-dir", other], { env: { ...process.env, T4A_LABS: join(root, "cli-labs") }, encoding: "utf8" }).trim();

      assert.equal(seen.argv[seen.argv.indexOf("--plugin-dir") + 1], other, "--plugin-dir is the given dir");
      assert.ok(readFileSync(out.slice("sh ".length), "utf8").includes(`--plugin-dir '${other}'`), "the CLI's start.sh uses the given dir");
    });
  });

  it("copies the given plugin dir, not REPO_ROOT, when broken", () => {
    withTempRoot((root) => {
      const other = join(root, "other-checkout");
      mkdirSync(join(other, "mod"), { recursive: true });
      writeFileSync(join(other, "mod/register.tsx"), "// other checkout\n");
      const lab = setupLab({ root: join(root, "labs"), pluginDir: other, broken: "load", now: new Date(2026, 10, 4, 9, 8, 3) });

      const seen = runStart(root, lab);
      const copy = join(lab.dir, "plugin");

      assert.equal(seen.argv[seen.argv.indexOf("--plugin-dir") + 1], copy, "the broken copy still wins");
      const copied = readFileSync(join(copy, "mod/register.tsx"), "utf8");
      assert.ok(copied.includes("// other checkout") && copied.includes(BROKEN_MARKER), "the broken copy is made from the given dir");
    });
  });
});

const BROKEN_FILES = { load: "mod/register.tsx", render: "mod/pane.tsx" };

describe("setup-broken-start-line", () => {
  for (const mode of ["load", "render"]) {
    it(`starts claude with --plugin-dir at the lab's ${mode}-broken copy, with the healthy env and argv`, () => {
      withTempRoot((root) => {
        const labsRoot = join(root, "labs");
        const healthy = setupLab({ root: labsRoot, now: new Date(2026, 10, 4, 9, 8, 10) });
        const lab = setupLab({ root: labsRoot, broken: mode, now: new Date(2026, 10, 4, 9, 8, 11) });

        const seen = runStart(root, lab);
        const healthySeen = runStart(root, healthy);
        const pluginDir = join(lab.dir, "plugin");
        const brokenFile = readFileSync(join(pluginDir, BROKEN_FILES[mode]), "utf8");

        assert.ok(lab.dir.endsWith(`-broken-${mode}`), `the lab dir name ends in -broken-${mode}`);
        assert.ok(brokenFile.includes(BROKEN_MARKER), `${BROKEN_FILES[mode]} in the lab's plugin copy holds the marker`);
        assert.equal(seen.argv[seen.argv.indexOf("--plugin-dir") + 1], pluginDir, "--plugin-dir is the lab's plugin copy");
        assert.ok(!seen.argv.includes(REPO_ROOT), "REPO_ROOT is not in the argv");
        assert.deepEqual(seen.argv.filter((a) => a !== pluginDir), healthySeen.argv.filter((a) => a !== REPO_ROOT), "the other argv is the healthy lab's");
        const { PATH: _p, PWD: _w, GH_SHIM_LOG: _l, GH_SHIM_OPENED: _o, ...env } = seen.env;
        const { PATH: _hp, PWD: _hw, GH_SHIM_LOG: _hl, GH_SHIM_OPENED: _ho, ...healthyEnv } = healthySeen.env;
        assert.deepEqual(env, healthyEnv, "the env, apart from the per-lab PATH, PWD and gh shim files, is the healthy lab's");
      });
    });
  }

  it("prints `sh <start.sh>` for a -broken-render lab from the CLI", () => {
    withTempRoot((root) => {
      const labsRoot = join(root, "labs");

      const out = execFileSync("node", [join(REPO_ROOT, "tests/smoke/t4a-lab.mjs"), "setup", "--broken", "render"], { env: { ...process.env, T4A_LABS: labsRoot }, encoding: "utf8" }).trim();

      assert.match(out, /^sh \S+\/start\.sh$/, "the CLI prints sh and the start script path");
      const start = out.slice("sh ".length);
      assert.ok(start.startsWith(labsRoot), "the lab is under T4A_LABS");
      assert.ok(start.includes("-broken-render/"), "the lab dir is a -broken-render lab");
    });
  });
});

const ALERT_SOUND_OFF = { pluginConfigs: { pairingbuddy: { options: { alertSound: false } }, "pairingbuddy@inline": { options: { alertSound: false } } } };

describe("setup-ask-and-sound-off", () => {
  it("passes --permission-mode acceptEdits for --ask and nothing else differently", () => {
    withTempRoot((root) => {
      const labsRoot = join(root, "labs");
      const plain = setupLab({ root: labsRoot, now: new Date(2026, 10, 4, 9, 8, 12) });
      const asking = setupLab({ root: labsRoot, ask: true, now: new Date(2026, 10, 4, 9, 8, 13) });

      const seen = runStart(root, asking);
      const plainSeen = runStart(root, plain);

      assert.equal(seen.argv[seen.argv.indexOf("--permission-mode") + 1], "acceptEdits", "--ask starts claude in acceptEdits mode");
      assert.deepEqual(seen.argv.filter((a) => a !== "acceptEdits"), plainSeen.argv.filter((a) => a !== "auto"), "the rest of the argv is the plain setup's");
    });
  });

  it("writes settings.json with alertSound false for both plugin names and passes it with --settings for sound off", () => {
    withTempRoot((root) => {
      const lab = setupLab({ root: join(root, "labs"), sound: false, now: new Date(2026, 10, 4, 9, 8, 14) });

      const seen = runStart(root, lab);
      const settings = join(lab.dir, "settings.json");

      assert.deepEqual(JSON.parse(readFileSync(settings, "utf8")), ALERT_SOUND_OFF, "settings.json turns alertSound off under both plugin names");
      assert.equal(seen.argv[seen.argv.indexOf("--settings") + 1], settings, "--settings is the lab's settings.json");
    });
  });

  it("keeps auto mode and passes no --settings for a plain setup", () => {
    withTempRoot((root) => {
      const lab = setupLab({ root: join(root, "labs"), now: new Date(2026, 10, 4, 9, 8, 15) });

      const seen = runStart(root, lab);

      assert.equal(seen.argv[seen.argv.indexOf("--permission-mode") + 1], "auto", "a plain setup starts claude in auto mode");
      assert.ok(!seen.argv.includes("--settings"), "a plain setup passes no --settings");
    });
  });

  it("prints the sh line from the CLI for `setup --ask --sound off`", () => {
    withTempRoot((root) => {
      const labsRoot = join(root, "labs");

      const out = execFileSync("node", [join(REPO_ROOT, "tests/smoke/t4a-lab.mjs"), "setup", "--ask", "--sound", "off"], { env: { ...process.env, T4A_LABS: labsRoot }, encoding: "utf8" }).trim();

      assert.match(out, /^sh \S+\/start\.sh$/, "the CLI prints sh and the start script path");
      const start = out.slice("sh ".length);
      assert.ok(start.startsWith(labsRoot), "the lab is under T4A_LABS");
      const script = readFileSync(start, "utf8");
      const settings = join(dirname(start), "settings.json");
      assert.deepEqual(JSON.parse(readFileSync(settings, "utf8")), ALERT_SOUND_OFF, "--sound off wrote settings.json with alertSound off");
      assert.ok(script.includes("--permission-mode acceptEdits"), "--ask put acceptEdits in start.sh");
      assert.ok(script.includes(settings), "start.sh passes the lab's settings.json");
    });
  });
});
