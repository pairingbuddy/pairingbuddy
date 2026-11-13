// A recording `gh`, shared by the tests of pb publish (through gh-shim-fixture.mjs) and by smoke S3. installGhShim() writes
// an executable `gh` into a temp dir of its own; pass shim.env() as the extra environment of a pb (or claude) call and
// that `gh` is the first on PATH. Every call appends one JSON line to the log: { argv, bodyFile } where bodyFile is the
// content of the file named by --body-file, read at call time (pb publish removes it afterwards), or null. `gh pr create`
// prints a fake PR URL. A call fails when the shim is told to, through the environment: GH_SHIM_FAIL is a subcommand
// prefix ("pr create", "pr comment"). GH_SHIM_URL replaces the URL `gh pr create` prints. `gh pr view` answers with the
// JSON in GH_SHIM_VIEW (see viewEnv); when that is unset it answers with the PR a successful `gh pr create` opened, if
// the shim was installed with { remember: true }, and otherwise fails with "no pull requests found".
//
// GH_SHIM_VIEWS (see viewsEnv) is an optional JSON map from the last argument of `gh pr view` (the branch or PR url) to
// its answer; an argument it does not name falls back to the rules above.
//
// This module touches no TMPDIR of its own: a test file imports isolated-tmpdir.mjs first (gh-shim-fixture.mjs does),
// and smoke passes the parent directory it wants the shim in.
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FAKE_PR_URL = "https://github.com/example/repo/pull/7";
export const GH_FAILURE = "gh shim: simulated failure";

const SCRIPT = `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const at = argv.indexOf("--body-file");
let bodyFile = null;
if (at !== -1) {
  try { bodyFile = readFileSync(argv[at + 1], "utf8"); } catch { bodyFile = null; }
}
appendFileSync(process.env.GH_SHIM_LOG, JSON.stringify({ argv, bodyFile }) + "\\n");
const fail = process.env.GH_SHIM_FAIL;
if (fail && argv.join(" ").startsWith(fail)) {
  process.stderr.write(${JSON.stringify(GH_FAILURE)} + "\\n");
  process.exit(1);
}
const opened = process.env.GH_SHIM_OPENED;
if (argv[0] === "pr" && argv[1] === "view") {
  const views = process.env.GH_SHIM_VIEWS ? JSON.parse(process.env.GH_SHIM_VIEWS) : {};
  const mapped = views[argv[argv.length - 1]];
  const view = (mapped && JSON.stringify(mapped)) ?? process.env.GH_SHIM_VIEW ?? (opened && existsSync(opened) ? readFileSync(opened, "utf8").trim() : "");
  if (!view) {
    process.stderr.write("no pull requests found for branch\\n");
    process.exit(1);
  }
  process.stdout.write(view + "\\n");
}
if (argv[0] === "pr" && argv[1] === "create") {
  const url = process.env.GH_SHIM_URL ?? ${JSON.stringify(FAKE_PR_URL)};
  const flag = (name) => argv[argv.indexOf(name) + 1];
  if (opened) writeFileSync(opened, JSON.stringify({ url, headRefName: flag("--head"), baseRefName: flag("--base") }));
  process.stdout.write(url + "\\n");
}
`;

// The environment that makes `gh pr view` report a PR: the fake URL, from head into base, unless over changes a field.
export const viewEnv = ({ head, base = "main", ...over }) => ({
  GH_SHIM_VIEW: JSON.stringify({ url: FAKE_PR_URL, headRefName: head, baseRefName: base, ...over }),
});

// The environment that makes `gh pr view <key>` answer per key: views maps the last argv (a PR url or branch) to the
// fields viewEnv takes ({ head, base, ...over }). Merge it with viewEnv to give the other keys a default answer.
export const viewsEnv = (views) => ({
  GH_SHIM_VIEWS: JSON.stringify(
    Object.fromEntries(Object.entries(views).map(([key, { head, base = "main", ...over }]) => [key, { url: FAKE_PR_URL, headRefName: head, baseRefName: base, ...over }])),
  ),
});

// parent is where the shim's own dir is made; remember makes `gh pr view` answer with the PR `gh pr create` opened.
export function installGhShim({ parent = tmpdir(), remember = false } = {}) {
  const dir = realpathSync(mkdtempSync(join(parent, "pb-gh-shim-")));
  const logPath = join(dir, "gh.log");
  writeFileSync(join(dir, "gh.mjs"), SCRIPT);
  writeFileSync(join(dir, "gh"), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, "gh.mjs")}" "$@"\n`);
  chmodSync(join(dir, "gh"), 0o755);
  writeFileSync(logPath, "");
  const remembered = remember ? { GH_SHIM_OPENED: join(dir, "opened.json") } : {};
  // env(extra) is the environment to hand to pb: the shim first on PATH, the log path, and extra (for example { GH_SHIM_FAIL: "pr create" }).
  const env = (extra = {}) => ({ PATH: `${dir}:${process.env.PATH}`, GH_SHIM_LOG: logPath, ...remembered, ...extra });
  const calls = () => (existsSync(logPath) ? readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  const prCalls = (verb) => () => calls().filter(({ argv }) => argv[0] === "pr" && argv[1] === verb);
  return { dir, env, calls, prCreates: prCalls("create"), prComments: prCalls("comment"), prViews: prCalls("view") };
}

// The values after every occurrence of flag in an argv, in order.
export const flagValues = (argv, flag) => argv.flatMap((arg, i) => (arg === flag ? [argv[i + 1]] : []));
