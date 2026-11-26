#!/usr/bin/env node
// Test tooling only: smoke S4 puts this in front of the sample repo's test command, so the first test run of the first
// safety-net fix goes red and the fix loop has to roll that fix back. Nothing in the plugin names it; only S4's own
// test-config.json does, by absolute path, in a throwaway repo.
//
//     node force-red.mjs [--always] <marker file> <real test command words...>
//
// It fails once, when the run's ledger is on code-safety-net, a fix return of that stage is filed and the marker does
// not exist yet: it writes the marker and exits 1. Every other call runs the real command and exits with its status.
// With --always it fails on every such call, so the fix loop runs out of attempts (smoke S9's forced stop).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const STAGE = "code-safety-net";
export const FORCED = "smoke S4 fixture: the first safety-net fix's test run is forced red";
const FIX_RETURN = new RegExp(`^${STAGE.replaceAll("-", "\\-")}\\.fix\\.`);

function onSafetyNetFix(repo) {
  const task = join(repo, ".pairingbuddy", "run", "task");
  try {
    const ledger = JSON.parse(readFileSync(join(task, "ledger.json"), "utf8"));
    return ledger.stage?.name === STAGE && readdirSync(join(task, "artifacts")).some((file) => FIX_RETURN.test(file));
  } catch {
    return false;
  }
}

const ALWAYS = "--always";
const args = process.argv.slice(2);
const always = args[0] === ALWAYS;
const [marker, ...command] = always ? args.slice(1) : args;
if (marker === undefined || command.length === 0) {
  process.stderr.write("usage: force-red.mjs [--always] <marker file> <test command...>\n");
  process.exit(2);
}
if ((always || !existsSync(marker)) && onSafetyNetFix(process.cwd())) {
  writeFileSync(marker, `${new Date().toISOString()}\n`);
  process.stdout.write(`${FORCED}\n`);
  process.exit(1);
}
const run = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
process.exit(run.status ?? 1);
