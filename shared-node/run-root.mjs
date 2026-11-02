// Finds the run a path belongs to. Hooks import this, so it uses only built-ins and never calls git.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// The first directory at or above `start` whose .pairingbuddy/run/ holds run state. An empty run/ is not a run.
export function findRunRoot(start) {
  for (let dir = start; ; dir = dirname(dir)) {
    const run = join(dir, ".pairingbuddy", "run");
    if (existsSync(join(run, "task", "ledger.json")) || existsSync(join(run, "unit.json"))) return dir;
    if (dir === dirname(dir)) return null;
  }
}
