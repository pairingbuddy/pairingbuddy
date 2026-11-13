import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKIPPED = new Set([".git", "node_modules", ".pairingbuddy", "tests"]);

export const BROKEN_MARKER = "pairingbuddy-broken-copy";

const MODES = ["load", "render"];

function editFile(file, edit) {
  const source = readFileSync(file, "utf8");
  writeFileSync(file, edit(source));
}

function breakOnLoad(source) {
  return `${source}\nthrow new Error("${BROKEN_MARKER}")\n`;
}

function breakOnRender(source) {
  const anchor = /export function Pane\([\s\S]*?\}\)\s*\{/;
  if (!anchor.test(source)) throw new Error("broken-plugin: Pane signature not found in pane.tsx");
  return source.replace(anchor, (head) => `${head}\n  throw new Error("${BROKEN_MARKER}")`);
}

export function makeBrokenCopy({ mode = "load", into, from = PLUGIN_ROOT } = {}) {
  if (!MODES.includes(mode)) throw new Error(`broken-plugin: unknown mode "${mode}"`);
  const dest = into ?? mkdtempSync(join(tmpdir(), "broken-plugin-"));
  cpSync(from, dest, {
    recursive: true,
    filter: (src) => !(dirname(src) === from && SKIPPED.has(basename(src))),
  });
  if (mode === "load") editFile(join(dest, "mod", "register.tsx"), breakOnLoad);
  else editFile(join(dest, "mod", "pane.tsx"), breakOnRender);
  return dest;
}
