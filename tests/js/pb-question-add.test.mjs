// pb question add: under auto the session never asks the human on its own. A doubt it has goes to the unit's questions for
// the human (/pb-questions), and the run keeps going.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { makeRepo, pb } from "./cli-repo-fixture.mjs";

const unitPath = (repo) => join(repo.dir, ".pairingbuddy", "run", "unit.json");
const unitOf = (repo) => JSON.parse(readFileSync(unitPath(repo), "utf8"));
const openUnit = (repo) => writeFileSync(unitPath(repo), JSON.stringify({ unit: "TB1", plan: "docs/plan.md", tasks: [], commits: [] }));

test("adds the session's doubt to the open unit's questions, with the task it arose in", () => {
  const repo = makeRepo();
  openUnit(repo);

  const { code, stdout, stderr } = pb(repo, "question", "add", "--text", "Should", "the", "report", "count", "re-runs?");

  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), { ok: true, added: true, open: 1 });
  const [question] = unitOf(repo).questions;
  assert.equal(question.ambiguity, "Should the report count re-runs?");
  assert.equal(question.gate, "session");
  assert.equal(question.step, "the session");
  assert.equal(typeof question.task, "string");
});
