// pb config propose: during a run the session cannot edit test-config.json or git-config.json. It proposes the change
// instead; pb checks it and keeps it pending, and only the human's typed pb human config apply writes it.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { updateLedger } from "../../shared-node/ledger.mjs";

import { makeRepo, pb } from "./cli-repo-fixture.mjs";

const gitConfigPath = (repo) => join(repo.dir, ".pairingbuddy", "git-config.json");
const gitConfigText = (repo) => readFileSync(gitConfigPath(repo), "utf8");
const hashOf = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

test("records a pending change with its old and new value, and writes nothing", () => {
  const repo = makeRepo({ configGlobs: [] });
  const before = gitConfigText(repo);

  const { code, stdout, stderr } = pb(repo, "config", "propose", "git-config.json", "pr.title_template", "KEY-1 {summary}", "--reason", "the team puts the ticket key first");

  assert.equal(code, 0, stderr);
  const { proposal, apply, refuse } = JSON.parse(stdout);
  const { at, ...rest } = proposal;
  assert.deepEqual(rest, { n: 1, file: "git-config.json", key: "pr.title_template", old: "{type}: {summary}", new: "KEY-1 {summary}", reason: "the team puts the ticket key first", status: "pending", lines: { apply, refuse } });
  assert.ok(Number.isFinite(Date.parse(at)), `when it was proposed: ${at}`);
  assert.deepEqual(JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "config-proposals.json"), "utf8")).proposals[0], proposal);
  assert.equal(gitConfigText(repo), before);
});

test("refuses a value the file would not accept, and records nothing", () => {
  const repo = makeRepo({ configGlobs: [] });

  const { code, stderr } = pb(repo, "config", "propose", "git-config.json", "pr.stack_depth", "deep", "--reason", "more stacking");

  assert.equal(code, 1);
  assert.match(stderr, /pr\.stack_depth" must be a non-negative integer/);
  assert.equal(existsSync(join(repo.dir, ".pairingbuddy", "run", "config-proposals.json")), false);
});

test("the human's apply writes the change and pins the new file in the unit and the run, so nothing reads it as changed", () => {
  const repo = makeRepo({ configGlobs: [] });
  const oldHash = hashOf(gitConfigPath(repo));
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "unit.json"), JSON.stringify({ unit: "TB1", plan: "docs/plan.md", gitConfigHash: oldHash, tasks: [], commits: [] }));
  updateLedger(join(repo.dir, ".pairingbuddy", "run", "task", "ledger.json"), (ledger) => ({ ...ledger, gitConfigHash: oldHash }));
  pb(repo, "config", "propose", "git-config.json", "pr.title_template", "KEY-1 {summary}", "--reason", "the team puts the ticket key first");

  const { code, stdout, stderr } = pb(repo, "human", "config", "apply", "1");

  assert.equal(code, 0, stderr);
  assert.equal(JSON.parse(gitConfigText(repo)).pr.title_template, "KEY-1 {summary}");
  const newHash = hashOf(gitConfigPath(repo));
  assert.equal(JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "unit.json"), "utf8")).gitConfigHash, newHash);
  assert.equal(repo.ledger().gitConfigHash, newHash);
  assert.equal(JSON.parse(stdout).proposal.status, "applied");
});

test("the human's refuse leaves the file as it was and closes the proposal", () => {
  const repo = makeRepo({ configGlobs: [] });
  const before = gitConfigText(repo);
  pb(repo, "config", "propose", "git-config.json", "pr.title_template", "KEY-1 {summary}", "--reason", "the team puts the ticket key first");

  const { code, stdout, stderr } = pb(repo, "human", "config", "refuse", "1");

  assert.equal(code, 0, stderr);
  assert.equal(gitConfigText(repo), before);
  assert.equal(JSON.parse(stdout).proposal.status, "refused");
  assert.equal(pb(repo, "human", "config", "apply", "1").code, 1);
});

test("an applied test-config change is accepted by the run, as the human's own edit would be", () => {
  const repo = makeRepo();
  pb(repo, "config", "propose", "test-config.json", "runners.fake.run_args", '["--quiet"]', "--reason", "less noise");

  const { code, stderr } = pb(repo, "human", "config", "apply", "1");

  assert.equal(code, 0, stderr);
  const path = join(repo.dir, ".pairingbuddy", "test-config.json");
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).runners.fake.run_args, ["--quiet"]);
  assert.equal(repo.ledger().configHash, hashOf(path));
});

test("tells the session the one line the human types to apply the change, and the one to refuse it", () => {
  const repo = makeRepo({ configGlobs: [] });

  const { stdout } = pb(repo, "config", "propose", "git-config.json", "pr.title_template", "KEY-1 {summary}", "--reason", "the team puts the ticket key first");

  const { apply, refuse } = JSON.parse(stdout);
  assert.match(apply, /^!.* human config apply 1$/);
  assert.match(refuse, /^!.* human config refuse 1$/);
});

test("with no run or unit open the file is not pinned, so pb says to edit it directly", () => {
  const repo = makeRepo({ configGlobs: [], openTask: false });
  rmSync(join(repo.dir, ".pairingbuddy", "run"), { recursive: true, force: true });

  const { code, stderr } = pb(repo, "config", "propose", "git-config.json", "pr.title_template", "KEY-1 {summary}", "--reason", "x");

  assert.equal(code, 1);
  assert.match(stderr, /no run or unit is open.*edit .*git-config\.json directly/);
});
