#!/usr/bin/env node
// A test command for a Claude Code mod, for .pairingbuddy/test-config.json. `claude plugin test .` has no name filter, so
// this runs the whole suite and speaks for one test: `node mod-test-one.mjs <test_file> <test_function>` exits 0 when every
// row of that name in that file passed (a parametrized test's cases are `<name>: <case>`), and 1 when one failed or none
// was found. With no arguments it is the whole suite, with the suite's own exit code.
import { spawnSync } from "node:child_process";
import { normalize } from "node:path";

const FILE_HEAD = /^(\S.*\.test\.[cm]?[jt]sx?):$/;
const ROW = /^\((pass|fail|skip|todo)\) (.+?)(?: \[[\d.]+m?s\])?$/;

// The rows of the suite's output that belong to the named test in the named file.
export function rowsFor(output, file, name) {
  const wanted = normalize(file);
  const rows = [];
  let inFile = false;
  for (const line of output.split("\n")) {
    const head = FILE_HEAD.exec(line);
    if (head) {
      inFile = normalize(head[1]) === wanted;
      continue;
    }
    const row = inFile ? ROW.exec(line) : null;
    if (row && (row[2] === name || row[2].startsWith(`${name}: `))) rows.push({ status: row[1], line });
  }
  return rows;
}

function main([file, name]) {
  const run = spawnSync("claude", ["plugin", "test", "."], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.error) {
    process.stderr.write(`mod-test-one: cannot run claude: ${run.error.code ?? run.error.message}\n`);
    return 1;
  }
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  if (file === undefined || name === undefined) {
    process.stdout.write(output);
    return run.status ?? 1;
  }
  const rows = rowsFor(output, file, name);
  if (rows.length === 0) {
    process.stdout.write(`${output}\nmod-test-one: no test named ${JSON.stringify(name)} in ${file}\n`);
    return 1;
  }
  const passed = rows.every(({ status }) => status === "pass");
  const lines = rows.map(({ line }) => line).join("\n");
  process.stdout.write(passed ? `${lines}\n` : `${output}\n${lines}\n`);
  return passed ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
