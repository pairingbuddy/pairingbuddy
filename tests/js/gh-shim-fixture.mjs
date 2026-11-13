// A recording `gh` for the tests of pb publish. installGhShim() writes an executable `gh` into its own temp dir; pass
// shim.env as the extra environment of a pb call and that `gh` is the first on PATH. Every call appends one JSON line to
// the log: { argv, bodyFile } where bodyFile is the content of the file named by --body-file, read at call time (pb
// publish removes it afterwards), or null. `gh pr create` prints a fake PR URL. A call fails when the shim is told to,
// through the environment: GH_SHIM_FAIL is a subcommand prefix ("pr create", "pr comment"). GH_SHIM_URL replaces the URL `gh pr create`
// prints. `gh pr view` answers with the JSON in GH_SHIM_VIEW (see viewEnv), and fails with "no pull requests found" when it is unset.
import "./isolated-tmpdir.mjs";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FAKE_PR_URL = "https://github.com/example/repo/pull/7";
export const GH_FAILURE = "gh shim: simulated failure";

const SCRIPT = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
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
if (argv[0] === "pr" && argv[1] === "view") {
  if (!process.env.GH_SHIM_VIEW) {
    process.stderr.write("no pull requests found for branch\\n");
    process.exit(1);
  }
  process.stdout.write(process.env.GH_SHIM_VIEW + "\\n");
}
if (argv[0] === "pr" && argv[1] === "create") {
  process.stdout.write((process.env.GH_SHIM_URL ?? ${JSON.stringify(FAKE_PR_URL)}) + "\\n");
}
`;

// The environment that makes `gh pr view` report a PR: the fake URL, from head into base, unless over changes a field.
export const viewEnv = ({ head, base = "main", ...over }) => ({
  GH_SHIM_VIEW: JSON.stringify({ url: FAKE_PR_URL, headRefName: head, baseRefName: base, ...over }),
});

// The shim dir is made under the per-file TMPDIR, which isolated-tmpdir.mjs removes on exit.
export function installGhShim() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pb-gh-shim-")));
  const logPath = join(dir, "gh.log");
  writeFileSync(join(dir, "gh.mjs"), SCRIPT);
  writeFileSync(join(dir, "gh"), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, "gh.mjs")}" "$@"\n`);
  chmodSync(join(dir, "gh"), 0o755);
  writeFileSync(logPath, "");
  // env(extra) is the environment to hand to pb: the shim first on PATH, the log path, and extra (for example { GH_SHIM_FAIL: "pr create" }).
  const env = (extra = {}) => ({ PATH: `${dir}:${process.env.PATH}`, GH_SHIM_LOG: logPath, ...extra });
  const calls = () => (existsSync(logPath) ? readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  const prCreates = () => calls().filter(({ argv }) => argv[0] === "pr" && argv[1] === "create");
  const prComments = () => calls().filter(({ argv }) => argv[0] === "pr" && argv[1] === "comment");
  const prViews = () => calls().filter(({ argv }) => argv[0] === "pr" && argv[1] === "view");
  return { env, calls, prCreates, prComments, prViews };
}

// The values after every occurrence of flag in an argv, in order.
export const flagValues = (argv, flag) => argv.flatMap((arg, i) => (arg === flag ? [argv[i + 1]] : []));
