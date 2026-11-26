import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPT_PATH = fileURLToPath(new URL("../../scripts/solo-buddy.sh", import.meta.url));

// Runs scripts/solo-buddy.sh in a throwaway repo with stubbed binaries on PATH.
// `stubs` is a function of { realGit, calls } returning a map of binary name to bash body;
// `files` maps a path under the repo to its text, or to a JSON value that is written as JSON;
// `env` adds environment variables.
// Returns the spawn result, the stubs' call log ("" when none) and the status file the script wrote ("" when none).
export function runSolo({ stubs, files = {}, env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), "solo-script-"));
  try {
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const repo = join(dir, "repo");
    const bin = join(dir, "bin");
    const calls = join(dir, "calls.log");
    mkdirSync(bin);
    mkdirSync(repo);
    execFileSync(realGit, ["init", "-q", "-b", "feature/x", repo]);
    writeFileSync(join(repo, "plan.md"), "# plan\n");
    for (const [path, value] of Object.entries(files)) {
      const full = join(repo, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, typeof value === "string" ? value : JSON.stringify(value));
    }
    for (const [name, body] of Object.entries(stubs({ realGit, calls }))) {
      writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    }

    const result = spawnSync("bash", [SCRIPT_PATH, "plan.md"], {
      cwd: repo,
      env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
      timeout: 60000,
    });

    const statusPath = join(repo, ".pairingbuddy", "solo-status");
    return {
      result,
      log: existsSync(calls) ? readFileSync(calls, "utf8") : "",
      status: existsSync(statusPath) ? readFileSync(statusPath, "utf8") : "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
