#!/usr/bin/env node
// Test tooling only: a smoke puts this in front of the sample repo's test command to turn chosen test runs red. Nothing
// in the plugin names it; only a smoke's own test-config.json does, by absolute path, in a throwaway repo.
//
//     node force-red.mjs [--always | --green] <marker file> <real test command words...>
//
// Default (smoke S4): it fails once, when the run's ledger is on code-safety-net, a fix return of that stage is filed
// and the marker does not exist yet: it writes the marker and exits 1.
// --always: the same safety-net case fails on every call.
// --green (smoke S9's forced stop): every test run of code-tdd fails once a GREEN return of the current attempt is on
// file. Every TDD task runs GREEN, so the fix loop always reaches its attempt cap, whatever the reviews find.
// Every other call runs the real command and exits with its status.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const STAGE = "code-safety-net";
export const FORCED = "smoke fixture: this test run is forced red";
const FIX_RETURN = new RegExp(`^${STAGE.replaceAll("-", "\\-")}\\.fix\\.`);
const TDD_STAGE = "code-tdd";
const GREEN_RETURN = /^code-tdd\.implement-code\..*\.a(\d+)\.json$/;

const MODES = { "--always": "always", "--green": "green" };

// Whether this test run goes red. Pure: the ledger, the artifact file names and whether the marker exists.
export function forcesRed({ mode, ledger, artifacts, markerExists }) {
  const stage = ledger?.stage;
  if (mode === "green") {
    return stage?.name === TDD_STAGE && artifacts.some((file) => GREEN_RETURN.exec(file)?.[1] === String(stage.attempt));
  }
  if (stage?.name !== STAGE || !artifacts.some((file) => FIX_RETURN.test(file))) return false;
  return mode === "always" || !markerExists;
}

function readRun(repo) {
  const task = join(repo, ".pairingbuddy", "run", "task");
  try {
    return { ledger: JSON.parse(readFileSync(join(task, "ledger.json"), "utf8")), artifacts: readdirSync(join(task, "artifacts")) };
  } catch {
    return { ledger: null, artifacts: [] };
  }
}

function main() {
  const args = process.argv.slice(2);
  const mode = MODES[args[0]] ?? "once";
  const [marker, ...command] = mode === "once" ? args : args.slice(1);
  if (marker === undefined || command.length === 0) {
    process.stderr.write("usage: force-red.mjs [--always | --green] <marker file> <test command...>\n");
    process.exit(2);
  }
  if (forcesRed({ mode, ...readRun(process.cwd()), markerExists: existsSync(marker) })) {
    writeFileSync(marker, `${new Date().toISOString()}\n`);
    process.stdout.write(`${FORCED}\n`);
    process.exit(1);
  }
  const run = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
  process.exit(run.status ?? 1);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main();
