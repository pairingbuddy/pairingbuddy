// T4a lab: builds a throwaway S2 repo outside the worktree, with the task text and a start script beside it.
//   node tests/smoke/t4a-lab.mjs setup [--broken load|render] [--type bug_fix|new_feature] [--ask] [--sound on|off] [--plugin-dir <dir>]
// The repo has a bare origin with main (as S2), and start.sh puts a recording gh shim first on PATH. --plugin-dir runs
// another checkout instead of this one; with --broken, the broken copy is made from that checkout.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeS2Repo, TASK, FEATURE_TASK } from "./s2.mjs";
import { installGhShim } from "../js/gh-shim.mjs";
import { makeBrokenCopy } from "./broken-plugin.mjs";
import { CHEAP_MODEL, DROPPED_PREFIXES, REPO_ROOT } from "./claude-run.mjs";

const BROKEN_MODES = ["load", "render"];
const TASKS = { bug_fix: TASK, new_feature: FEATURE_TASK };
const shq = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;
const pad = (n) => String(n).padStart(2, "0");

const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

function startScript(repo, task, pluginDir, ghEnv, { ask = false, settings = null } = {}) {
  return `#!/bin/sh
for v in $(env | cut -d= -f1); do
  case "$v" in
    ${DROPPED_PREFIXES.map((p) => `${p}*`).join("|")}) unset "$v" 2>/dev/null || true ;;
  esac
done
${Object.entries(ghEnv).map(([k, v]) => `export ${k}=${k === "PATH" ? `${shq(v.split(":")[0])}:"$PATH"` : shq(v)}`).join("\n")}
export ANTHROPIC_DEFAULT_OPUS_MODEL=${shq(CHEAP_MODEL)}
export ANTHROPIC_DEFAULT_SONNET_MODEL=${shq(CHEAP_MODEL)}
cd ${shq(repo)} || exit 1
exec claude --plugin-dir ${shq(pluginDir)} --model haiku --setting-sources project,local --strict-mcp-config --permission-mode ${ask ? "acceptEdits" : "auto"}${settings ? ` --settings ${shq(settings)}` : ""} ${shq(`/pairingbuddy:code ${task}`)}
`;
}

const LABS_ROOT = () => process.env.T4A_LABS ?? join(tmpdir(), "pb-t4a-labs");

const labName = ({ now, broken, ask, sound }) => `${stamp(now)}${broken ? `-broken-${broken}` : ""}${ask ? "-ask" : ""}${sound ? "" : "-quiet"}`;

const parseLabName = (name) => ({
  broken: name.includes("-broken-") ? name.split("-broken-")[1].replace(/-ask|-quiet/g, "") : false,
  ask: name.includes("-ask"),
  quiet: name.endsWith("-quiet"),
});

export function setupLab({ root = LABS_ROOT(), broken = false, type = "bug_fix", ask = false, sound = true, pluginDir: given = REPO_ROOT, now = new Date() } = {}) {
  const dir = join(root, labName({ now, broken, ask, sound }));
  mkdirSync(dir, { recursive: true });
  const { repo } = makeS2Repo(dir, type);
  const task = join(dir, "task.txt");
  writeFileSync(task, `${TASKS[type]}\n`);
  const pluginDir = broken ? makeBrokenCopy({ mode: broken, into: join(dir, "plugin"), from: given }) : given;
  let settings = null;
  if (!sound) {
    settings = join(dir, "settings.json");
    const off = { options: { alertSound: false } };
    writeFileSync(settings, JSON.stringify({ pluginConfigs: { pairingbuddy: off, "pairingbuddy@inline": off } }));
  }
  const gh = installGhShim({ parent: dir, remember: true });
  const start = join(dir, "start.sh");
  writeFileSync(start, startScript(repo, TASKS[type], pluginDir, gh.env(), { ask, settings }), { mode: 0o755 });
  return { dir, repo, task, start };
}

const NO_LAB = "No lab yet. Run setup first.";
export function latestLab({ root = LABS_ROOT() } = {}) {
  let names = [];
  try {
    names = readdirSync(root);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return names.sort().reverse()[0] ?? null;
}

export function showLab({ root = LABS_ROOT() } = {}) {
  const name = latestLab({ root });
  if (name === null) return NO_LAB;
  const dir = join(root, name);
  const parsed = parseLabName(name);
  const flags = [parsed.ask ? "ask" : "", parsed.quiet ? "quiet" : ""].filter(Boolean).join(", ");
  const base = parsed.broken ? `broken ${parsed.broken}` : "healthy";
  const mode = flags ? `${base} (${flags})` : base;
  const repo = join(dir, "repo");
  const run = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const commits = run(repo, "log", "--format=%h %s", "origin/main..HEAD") || "none";
  let ledger = "no ledger yet";
  try {
    const { stage } = JSON.parse(readFileSync(join(repo, ".pairingbuddy/run/task/ledger.json"), "utf8"));
    ledger = `${stage.name} ${stage.status}`;
  } catch (error) {
    if (error.code !== "ENOENT") ledger = `ledger unreadable: ${error.message}`;
  }
  let reports = [];
  try {
    reports = readdirSync(join(repo, ".pairingbuddy/reports"));
  } catch {}
  return [`lab: ${dir}`, `mode: ${mode}`, `commits after base:\n${commits}`, `ledger: ${ledger}`, `reports: ${reports.join(", ") || "none"}`].join("\n");
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, ...rest] = process.argv.slice(2);
  const usage = "usage: t4a-lab.mjs setup [--broken load|render] [--type bug_fix|new_feature] [--ask] [--sound on|off] [--plugin-dir <dir>] | show";
  const flag = (name, fallback) => {
    const at = rest.indexOf(name);
    return at >= 0 ? rest[at + 1] : fallback;
  };
  const broken = flag("--broken", false);
  const type = flag("--type", "bug_fix");
  const ask = rest.includes("--ask");
  const sound = flag("--sound", "on");
  const pluginDir = flag("--plugin-dir", REPO_ROOT);
  if (command === "show") {
    if (latestLab() === null) {
      console.error(showLab());
      process.exitCode = 1;
    } else console.log(showLab());
  } else if (command !== "setup" || (broken !== false && !BROKEN_MODES.includes(broken)) || !Object.keys(TASKS).includes(type) || !["on", "off"].includes(sound)) {
    console.error(usage);
    process.exitCode = 2;
  } else {
    console.log(`sh ${setupLab({ broken, type, ask, sound: sound === "on", pluginDir }).start}`);
  }
}
