// Shared helpers for tests that need the lens rows of contracts/lenses.json and clean lens returns on disk.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { lensSlug } from "../../shared-node/keys.mjs";

const LENSES = fileURLToPath(new URL("../../contracts/lenses.json", import.meta.url));

// The lens row the workflow runs for a stage and task type.
export function lensRow(stage, taskType) {
  const { rows } = JSON.parse(readFileSync(LENSES, "utf8"));
  const row = rows.find((r) => r.stage === stage && r.taskTypes?.includes(taskType));
  if (!row) throw new Error(`contracts/lenses.json has no row for stage "${stage}" and task type "${taskType}"`);
  return row;
}

// Writes the clean return of one lens of a stage, at the given attempt, into an artifacts directory.
export function writeCleanLensReturn(artifactsDir, stage, lensName, attempt) {
  const pbKey = `${stage}.lens.${lensSlug(lensName)}.r1.a${attempt}`;
  writeFileSync(join(artifactsDir, `${pbKey}.json`), JSON.stringify({ pb_key: pbKey, ambiguity: null, findings: [] }));
}
