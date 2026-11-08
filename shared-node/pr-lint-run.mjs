// Runs the PR draft lint against the files of the open unit and writes run/pr-lint.json. Shared by `pb pr lint` and by
// the G:publish approval, which re-runs it so the binding speaks for the body the human approved. Node built-ins only.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readGitConfig } from "./gitconf.mjs";
import { lintDraft } from "./pr-lint.mjs";

export class PrLintRunRefused extends Error {}

const runDirOf = (root) => join(root, ".pairingbuddy", "run");
export const prBodyPath = (root) => join(runDirOf(root), "pr-body.md");
export const prLintPath = (root) => join(runDirOf(root), "pr-lint.json");
export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function readUnit(root) {
  const path = join(runDirOf(root), "unit.json");
  if (!existsSync(path)) throw new PrLintRunRefused("no unit is open (run/unit.json is missing), so there is no draft to lint");
  return JSON.parse(readFileSync(path, "utf8"));
}

// The draft artifact the tap filed for this attempt of pr-draft.
export function readDraftArtifact(root, stage) {
  const pbKey = `pr-draft.draft-pull-request.-.r1.a${stage.attempt}`;
  const path = join(root, ".pairingbuddy", "run", "task", "artifacts", `${pbKey}.json`);
  if (!existsSync(path)) throw new PrLintRunRefused(`no draft artifact ${pbKey} under run/task/artifacts, so there is nothing to lint`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function diffLinesSince(root, baseSha) {
  let out;
  try {
    out = execFileSync("git", ["diff", "--numstat", `${baseSha}...HEAD`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    throw new PrLintRunRefused(`git diff --numstat ${baseSha}...HEAD failed: ${String(e.stderr ?? "").trim() || e.message}`);
  }
  return out.split("\n").filter(Boolean).reduce((sum, row) => sum + row.split("\t").slice(0, 2).reduce((n, count) => n + (Number(count) || 0), 0), 0);
}

export function runPrLint(root, title) {
  const unit = readUnit(root);
  if (!existsSync(prBodyPath(root))) throw new PrLintRunRefused("run/pr-body.md is missing, so there is no draft to lint");
  const body = readFileSync(prBodyPath(root), "utf8");
  const { pr } = readGitConfig(root);
  const { ok, failures } = lintDraft({ title, body, diffLines: diffLinesSince(root, unit.baseSha), titleTemplate: pr.title_template, config: pr.lint });
  const result = { ok, failures, bodyHash: sha256(body) };
  const temp = `${prLintPath(root)}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(result, null, 2)}\n`);
  renameSync(temp, prLintPath(root));
  return result;
}
