// Runs the PR draft lint against the files of the open unit and writes run/pr-lint.json. Shared by `pb pr lint` and by
// the G:publish approval, which re-runs it so the binding speaks for the body the human approved. Node built-ins only.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readGitConfig } from "./gitconf.mjs";
import { lintDraft } from "./pr-lint.mjs";
import { returnsAt } from "./stage-run.mjs";

export class PrLintRunRefused extends Error {}

const runDirOf = (root) => join(root, ".pairingbuddy", "run");
export const prBodyPath = (root) => join(runDirOf(root), "pr-body.md");
export const prLintPath = (root) => join(runDirOf(root), "pr-lint.json");
export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function readUnit(root) {
  const path = join(runDirOf(root), "unit.json");
  if (!existsSync(path)) throw new PrLintRunRefused(`no unit is open (${path} is missing)`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new PrLintRunRefused(`${path} is unreadable: ${e.message}`);
  }
}

// The newest standing draft key of a pr-draft attempt: the highest-round draft-pull-request or fix artifact, or null when
// there is none. exceptKey leaves one key out, for the draft being rolled back. A redraft that `pb rollback --artifact` set
// aside (after a bad course-checker verdict or a failed lint) is no longer in the artifacts dir, so it is never seen here.
export function newestDraftKey(artifactsDir, stage, exceptKey = null) {
  // returnsAt sorts by key string, so r10 comes before r2: pick the newest by numeric round.
  const drafts = existsSync(artifactsDir) ? returnsAt(artifactsDir, stage) : [];
  return drafts
    .filter((key) => key.pbKey !== exceptKey && (key.role === "draft-pull-request" || key.role === "fix"))
    .reduce((best, key) => (!best || key.round > best.round ? key : best), null);
}

// The newest standing draft for this attempt of pr-draft.
export function readDraftArtifact(root, stage) {
  const dir = join(root, ".pairingbuddy", "run", "task", "artifacts");
  const firstKey = `pr-draft.draft-pull-request.-.r1.a${stage.attempt}`;
  const newest = newestDraftKey(dir, { name: "pr-draft", attempt: stage.attempt });
  if (!newest) throw new PrLintRunRefused(`no draft artifact ${firstKey} under run/task/artifacts, so there is nothing to lint`);
  return JSON.parse(readFileSync(join(dir, `${newest.pbKey}.json`), "utf8"));
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
