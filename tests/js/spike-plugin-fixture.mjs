import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ROOT, env } from "./cli-repo-fixture.mjs";

// A copy of the plugin whose stage contract treats spike as migrated, with the code-spike-unit node when the contract
// has no spike graph yet, so the CLI under test takes a spike task. The real contract flips later; this copy keeps the
// spike tests about the verbs and the setup, not the flip.
export function spikePlugin(t) {
  const plugin = join(realpathSync(mkdtempSync(join(tmpdir(), "pb-spike-plugin-"))), "plugin");
  t.after(() => rmSync(join(plugin, ".."), { recursive: true, force: true }));
  for (const dir of ["cli", "shared-node", "contracts"]) cpSync(join(ROOT, dir), join(plugin, dir), { recursive: true });
  const stagesPath = join(plugin, "contracts", "stages.json");
  const contract = JSON.parse(readFileSync(stagesPath, "utf8"));
  contract.taskTypes.spike ??= { nodes: [{ name: "code-spike-unit", gate: null, evidence: [] }], gates: {} };
  if (!contract.migratedTypes.includes("spike")) contract.migratedTypes.push("spike");
  writeFileSync(stagesPath, JSON.stringify(contract));
  return plugin;
}

// Runs the plugin copy's pb in the repo's directory; returns { code, stdout, stderr }.
export function pbFrom(plugin, repo, ...args) {
  const r = spawnSync(process.execPath, [join(plugin, "cli", "pb.mjs"), ...args], { cwd: repo.dir, encoding: "utf8", timeout: 30_000, env: env({ CLAUDE_PLUGIN_ROOT: plugin }) });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
