import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, makeRepo, pbWithEnv } from "./cli-repo-fixture.mjs";

// Scenarios: git-doctor-cli and unit-open-doctor-surfacing.
// The CLI derives owner/repo from `gh repo view --json nameWithOwner` (the fixture's remote is a local bare repo, not
// GitHub), then reads `gh api repos/o/r` and `gh api repos/o/r/branches/main/protection`. The recording gh shim answers
// exactly those three calls with canned JSON and logs every argv; any other call is logged and fails.

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const RISKY_REPO = { default_branch: "main", squash_merge_commit_title: "COMMIT_OR_PR_TITLE", squash_merge_commit_message: "COMMIT_MESSAGES" };
const NOT_PROTECTED = { message: "Branch not protected", status: "404" };
const NOT_FOUND = { message: "Not Found" };
const RISKY_WARNINGS = [
  "squash_merge_commit_title is COMMIT_OR_PR_TITLE, expected PR_TITLE: a squash commit will not use the PR title.",
  "squash_merge_commit_message is COMMIT_MESSAGES, expected PR_BODY: a squash commit will not use the PR body.",
  "The default branch has no protection: anyone with write access can push to it directly.",
];

// A temp bin dir holding a fake `gh`, and the file it appends one line per call to.
function makeGhShim({ protectionAnswer = NOT_PROTECTED } = {}) {
  const bin = tempDir("pb-gh-bin-");
  const log = join(bin, "gh-calls.log");
  const script = `#!/bin/sh
echo "$@" >> "${log}"
case "$*" in
  "repo view"*) echo '{"nameWithOwner":"o/r"}' ;;
  "api repos/o/r/branches/main/protection"*) echo '${JSON.stringify(protectionAnswer)}'; exit 1 ;;
  "api repos/o/r"*) echo '${JSON.stringify(RISKY_REPO)}' ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`;
  writeFileSync(join(bin, "gh"), script);
  chmodSync(join(bin, "gh"), 0o755);
  return { path: `${bin}:${process.env.PATH}`, calls: () => readCalls(log) };
}

function readCalls(log) {
  try {
    return readFileSync(log, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// A PATH that holds git and nothing else, so no gh is found wherever the machine installed it.
function pathWithoutGh() {
  const bin = tempDir("pb-nogh-bin-");
  symlinkSync(execFileSync("which", ["git"], { env: env(), encoding: "utf8" }).trim(), join(bin, "git"));
  return bin;
}

// The values of every -X/--method flag in a gh call, whether written "-X GET", "--method GET" or "--method=GET".
function methodValues(argv) {
  const values = [];
  argv.forEach((arg, i) => {
    if (arg === "-X" || arg === "--method") values.push(argv[i + 1]);
    else if (arg.startsWith("--method=")) values.push(arg.slice("--method=".length));
    else if (arg.startsWith("-X") && arg.length > 2) values.push(arg.slice(2));
  });
  return values;
}

const output = (result) => `${result.stdout}\n${result.stderr}`;

test("doctor-prints-warnings-and-exits-zero", () => {
  const repo = makeRepo();
  const gh = makeGhShim();

  const result = pbWithEnv(repo, { PATH: gh.path }, "git", "doctor");

  assert.equal(result.code, 0, `pb git doctor exits 0 even with warnings: ${result.stderr}`);
  for (const warning of RISKY_WARNINGS) assert.ok(output(result).includes(warning), `prints the warning: ${warning}`);
  assert.ok(gh.calls().length > 0, "the checks went through gh");
});

test("doctor-without-gh-says-so", () => {
  const repo = makeRepo();

  const result = pbWithEnv(repo, { PATH: pathWithoutGh() }, "git", "doctor");

  assert.equal(result.code, 0, `pb git doctor exits 0 without gh: ${result.stderr}`);
  assert.match(output(result), /gh is unavailable/i, "says gh is unavailable");
  for (const warning of RISKY_WARNINGS) assert.ok(!output(result).includes(warning), `runs no checks, so no warning: ${warning}`);
});

test("doctor-makes-only-read-calls", () => {
  const repo = makeRepo();
  const gh = makeGhShim();

  pbWithEnv(repo, { PATH: gh.path }, "git", "doctor");

  const calls = gh.calls();
  assert.ok(calls.some((call) => call.startsWith("api repos/o/r")), "doctor did read the repo through gh api");
  for (const call of calls) {
    const argv = call.split(" ");
    assert.ok(["api", "repo"].includes(argv[0]), `only api or repo view subcommands: gh ${call}`);
    if (argv[0] === "repo") assert.equal(argv[1], "view", `repo is only ever viewed: gh ${call}`);
    for (const method of methodValues(argv)) assert.equal(method, "GET", `only the GET method: gh ${call}`);
    assert.ok(!argv.some((arg) => /^(-f|-F|--field|--raw-field|--input)/.test(arg)), `no request body: gh ${call}`);
    assert.ok(!argv.some((arg) => ["edit", "create", "delete"].includes(arg)), `no edit/create/delete: gh ${call}`);
  }
});

const branchOf = (dir) => execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir, env: env(), encoding: "utf8" });

test("unit-open-prints-doctor-warnings-and-still-succeeds", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  const gh = makeGhShim();

  const result = pbWithEnv(repo, { PATH: gh.path }, "unit", "open", "--type", "feat", "--slug", "x", "--yes");

  assert.equal(result.code, 0, `unit open exits 0 despite warnings: ${result.stderr}`);
  for (const warning of RISKY_WARNINGS) assert.ok(output(result).includes(warning), `unit open prints the warning: ${warning}`);
  assert.match(branchOf(repo.dir), /^feat\/x$/m, "the unit branch was still opened");
});

test("unit-open-without-gh-still-succeeds-with-no-warnings", () => {
  const repo = makeRepo({ openTask: false, remote: true });

  const result = pbWithEnv(repo, { PATH: pathWithoutGh() }, "unit", "open", "--type", "feat", "--slug", "x", "--yes");

  assert.equal(result.code, 0, `unit open still succeeds without gh: ${result.stderr}`);
  assert.match(branchOf(repo.dir), /^feat\/x$/m, "the unit branch was opened without gh too");
  for (const warning of RISKY_WARNINGS) assert.ok(!output(result).includes(warning), `no gh means no doctor warnings: ${warning}`);
});

test("doctor-unreadable-protection-gives-note-not-warning", () => {
  const repo = makeRepo();
  const gh = makeGhShim({ protectionAnswer: NOT_FOUND });

  const result = pbWithEnv(repo, { PATH: gh.path }, "git", "doctor");

  assert.equal(result.code, 0, `pb git doctor exits 0: ${result.stderr}`);
  assert.ok(!output(result).includes(RISKY_WARNINGS[2]), "an unreadable protection is not reported as unprotected");
  assert.match(output(result), /branch protection could not be read/i, "says branch protection could not be read");
});
