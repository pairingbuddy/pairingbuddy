// Closing a unit on disk (D19): the I/O half of the unit rules in unit.mjs, which stays pure. Node built-ins only.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// The files that belong to one unit: its record and the PR draft's body and lint result.
export const UNIT_FILES = ["unit.json", "pr-body.md", "pr-lint.json"];

function removeNamed(runDir, wanted) {
  const present = existsSync(runDir) ? readdirSync(runDir).filter((name) => name !== ".gitignore") : [];
  const names = wanted === null ? present : present.filter((name) => wanted.includes(name));
  for (const name of names) rmSync(join(runDir, name), { recursive: true, force: true });
  return names;
}

// Abandon: everything under run/ goes, the task included, except run/.gitignore. Commits, branch and refs are not touched.
// Returns the names removed.
export const abandonRun = (runDir) => removeNamed(runDir, null);

// Keep local: only the unit's own files go, so a later unit cannot pick up this one's body or lint result. The task stays.
export const closeUnit = (runDir) => removeNamed(runDir, UNIT_FILES);

// Ends the run that closed its unit: only run/task goes. Used for a publish run, which has nothing left to do once the unit is closed.
export const endRun = (runDir) => removeNamed(runDir, ["task"]);
