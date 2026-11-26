// pb guidance record: the curating-guidance skill runs before the task's run opens, so it records what it did on the open
// unit; pb run open moves that record onto the run, where the report shows it, and sets any doubt aside as a question.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { makeRepo, pb } from "./cli-repo-fixture.mjs";

const unitPath = (repo) => join(repo.dir, ".pairingbuddy", "run", "unit.json");
const unitOf = (repo) => JSON.parse(readFileSync(unitPath(repo), "utf8"));

function repoWithUnit() {
  const repo = makeRepo({ openTask: false });
  writeFileSync(unitPath(repo), JSON.stringify({ unit: "T1a Solo", plan: "docs/plan.md", tasks: [], commits: [] }));
  return repo;
}

test("records how the guidance was carried over on the open unit", () => {
  const repo = repoWithUnit();

  const { code, stdout, stderr } = pb(repo, "guidance", "record", "--mode", "auto", "--kept", "3", "--dropped", "1");

  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), { ok: true, recorded: true });
  assert.deepEqual(unitOf(repo).curated, { mode: "auto", kept: 3, dropped: 1 });
});

test("keeps a doubt the curation leaves for the human, its words joined as one question", () => {
  const repo = repoWithUnit();

  const { code, stderr } = pb(repo, "guidance", "record", "--mode", "auto", "--kept", "2", "--dropped", "0", "--doubt", "Entries 1 and 2 contradict: which runner holds?");

  assert.equal(code, 0, stderr);
  assert.deepEqual(unitOf(repo).curated, { mode: "auto", kept: 2, dropped: 0, doubt: "Entries 1 and 2 contradict: which runner holds?" });
});

test("with no unit open it records nothing and says so, so the skill's task goes on", () => {
  const repo = makeRepo({ openTask: false });

  const { code, stdout, stderr } = pb(repo, "guidance", "record", "--mode", "auto", "--kept", "0", "--dropped", "0");

  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), { ok: true, recorded: false, reason: "no unit is open, so there is no run to report it on" });
});
