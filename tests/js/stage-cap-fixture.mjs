import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

// Copies a built stage bundle with its inlined stageMaxAgents cap for one stage replaced; the copy is removed through t.after.
export function withStageMaxAgents(stagePath, stageName, cap, t) {
  const bundle = readFileSync(stagePath, "utf8");
  const inlined = /^const STAGES = (.*);$/m;
  if (!inlined.test(bundle)) throw new Error("the stage must inline stages.json for its cap");
  const stages = JSON.parse(inlined.exec(bundle)[1]);
  const dir = mkdtempSync(join(tmpdir(), `${stageName}-cap-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cappedPath = join(dir, basename(stagePath));
  writeFileSync(cappedPath, bundle.replace(inlined, `const STAGES = ${JSON.stringify({ ...stages, stageMaxAgents: { ...stages.stageMaxAgents, [stageName]: cap } })};`));
  return cappedPath;
}
