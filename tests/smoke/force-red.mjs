#!/usr/bin/env node
// Test tooling only: smoke S4 puts this in front of the sample repo's test command, so the first test run of the first
// safety-net fix goes red and the fix loop has to roll that fix back. Nothing in the plugin names it; only S4's own
// test-config.json does, by absolute path, in a throwaway repo.
//
//     node force-red.mjs <marker file> <real test command words...>
//
// It fails once, when the run's ledger is on code-safety-net, a fix return of that stage is filed and the marker does
// not exist yet: it writes the marker and exits 1. Every other call runs the real command and exits with its status.
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

const [marker, ...command] = process.argv.slice(2);
if (marker === undefined || command.length === 0) {
  process.stderr.write("usage: force-red.mjs <marker file> <test command...>\n");
  process.exit(2);
}
if (!existsSync(marker) && onSafetyNetFix(process.cwd())) {
  writeFileSync(marker, `${new Date().toISOString()}\n`);
  process.stdout.write(`${FORCED}\n`);
  process.exit(1);
}
const run = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
process.exit(run.status ?? 1);
