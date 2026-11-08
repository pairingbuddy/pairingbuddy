// Scenario reports-survive-task-end: the reports folder is a kept location in R5's list of kept files.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeLedger } from "../../shared-node/ledger.mjs";
import { baseLedger } from "./ledger-fixture.mjs";
import { ROOT, env, makeRepo, pb } from "./cli-repo-fixture.mjs";

const NET = "code-safety-net";
const REPORT_TEXT = "<!doctype html><title>Task 31</title><p>What changed, kept for the human.</p>\n";

// A repo whose task is finished, so `pb task end` is allowed to remove run/task.
function finishedRepo() {
  const repo = makeRepo({ configGlobs: ["**"] });
  const pairing = join(repo.dir, ".pairingbuddy");
  writeFileSync(join(repo.dir, ".gitignore"), ".pairingbuddy/\n");
  execFileSync("git", ["add", ".gitignore"], { cwd: repo.dir, env: env() });
  execFileSync("git", ["commit", "-q", "-m", "ignore state"], { cwd: repo.dir, env: env() });
  const configText = readFileSync(join(pairing, "test-config.json"), "utf8");
  writeLedger(join(pairing, "run", "task", "ledger.json"), {
    ...baseLedger(),
    plan: { path: "", title: "" },
    seq: repo.ledger().seq,
    sha: repo.ledger().sha,
    configHash: createHash("sha256").update(configText).digest("hex"),
    stage: { name: NET, status: "done", runId: "wf_2", attempt: 1, startedAt: null },
    stages: [{ name: "code-config", status: "done", attempt: 1 }, { name: NET, status: "done", attempt: 1 }],
    gates: { "G:task-end": { source: "auto" } },
  });
  return { repo, pairing };
}

describe("reports-survive-task-end", () => {
  test("task-end-keeps-reports-folder", () => {
    const { repo, pairing } = finishedRepo();
    mkdirSync(join(pairing, "reports"), { recursive: true });
    const reportPath = join(pairing, "reports", "2026-11-04-101500-task-31.html");
    writeFileSync(reportPath, REPORT_TEXT);

    const result = pb(repo, "task", "end");

    assert.equal(result.code, 0, result.stderr);
    assert.equal(existsSync(join(pairing, "run", "task")), false, "run/task is removed");
    assert.equal(existsSync(reportPath), true, "the report file survives");
    assert.equal(readFileSync(reportPath, "utf8"), REPORT_TEXT, "the report content is unchanged");
  });

  test("kept-files-lists-reports-in-docs-and-skill", () => {
    const REPORTS = ".pairingbuddy/reports/";
    const KEPT_NEIGHBOURS = ["test-config.json", "doc-config.json", "human-guidance.json"];
    const skill = readFileSync(join(ROOT, "skills/coding/SKILL.md"), "utf8").split("\n");
    const claude = readFileSync(join(ROOT, "CLAUDE.md"), "utf8").split("\n");
    const headingIndex = skill.findIndex((l) => l.startsWith("### State File Management"));
    assert.notEqual(headingIndex, -1, "skills/coding/SKILL.md has a '### State File Management' heading");
    const section = skill.slice(headingIndex);
    const places = {
      "the _cleanup_state_files row of skills/coding/SKILL.md": skill.find((l) => l.startsWith("| `_cleanup_state_files()`")),
      "the delete step of State File Management in skills/coding/SKILL.md": section.find((l) => /^\d+\. Delete all `\.pairingbuddy\/\*\.json`/.test(l)),
      "the 'State is cleaned' line of CLAUDE.md": claude.find((l) => l.includes("State is cleaned at task start")),
    };

    for (const [where, sentence] of Object.entries(places)) {
      assert.ok(sentence, `${where} exists`);
      assert.ok(sentence.includes(REPORTS), `${where} names ${REPORTS} as kept`);
      for (const name of KEPT_NEIGHBOURS) assert.ok(sentence.includes(name), `${where} still names ${name}`);
    }
  });
});
