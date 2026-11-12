// Plan checkboxes: how the gate reads them, and the one writer, which only pb task end calls. Tasks are identified by
// title (D12), and the text around a box is the human's, so only its mark changes. Node built-ins only.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { isOutside } from "./checkpoint.mjs";

const CHECKBOX = /^\s*[-*+]\s+\[([ xX])\](.*)$/gm;
const BOLD = /^\*\*(.*)\*\*$/;
const TICKED_MARK = "x";

export class PlanRefused extends Error {}

export const checkboxes = (text) =>
  [...text.matchAll(CHECKBOX)].map(({ 0: line, 1: mark, 2: label, index }) => ({ ticked: mark !== " ", label: label.trim(), markAt: index + line.indexOf("[") + 1 }));

// A box's label as a task title: the bold a plan puts around it is not part of the title.
export const boxLabel = (label) => label.replace(BOLD, "$1");

export const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const PR_PREFIX = /^PR:\s*/;
export const isPrHeading = (text) => PR_PREFIX.test(text);
export const headingName = (text) => text.replace(PR_PREFIX, "").trim();

// The index of the line holding the unit's heading, or -1. A "PR:" prefix on the heading is not part of its name.
const unitHeadingIndex = (lines, unit) =>
  lines.findIndex((line) => {
    const heading = HEADING.exec(line);
    return heading !== null && headingName(heading[2]) === headingName(unit);
  });

// The labels of the boxes under the heading of a unit, up to the next heading of the same or a higher level. Null when
// the plan has no such heading.
export function boxLabelsUnder(text, unit) {
  const lines = text.split("\n");
  const start = unitHeadingIndex(lines, unit);
  if (start === -1) return null;
  const level = HEADING.exec(lines[start])[1].length;
  const end = lines.findIndex((line, i) => i > start && (HEADING.exec(line)?.[1].length ?? Infinity) <= level);
  return checkboxes(lines.slice(start + 1, end === -1 ? undefined : end).join("\n")).map(({ label }) => boxLabel(label));
}

// The "PR: <url>" line pb publish writes under a unit's heading; capture 1 is the url.
export const PR_LINE = /^PR:\s+(\S*)/;

// The text with "line" directly under the unit's heading, replacing a PR: line already there. Null with no such heading.
export function withPrLine(text, unit, line) {
  const lines = text.split("\n");
  const start = unitHeadingIndex(lines, unit);
  if (start === -1) return null;
  const replaces = PR_LINE.test(lines[start + 1] ?? "");
  lines.splice(start + 1, replaces ? 1 : 0, line);
  return lines.join("\n");
}

// Writes the PR: line under the unit's heading in the plan, atomically. False when the plan has no such heading.
export function writePrLine(root, plan, unit, line) {
  const file = planFile(root, plan);
  const text = withPrLine(readFileSync(file, "utf8"), unit, line);
  if (text === null) return false;
  replaceFile(file, text);
  return true;
}

// Every box in the whole text titled "title": what pb task end looks for, and what the plan parser counts.
export const boxesTitled = (text, title) => checkboxes(text).filter(({ label }) => boxLabel(label) === title);

// The real path of the plan under root. Refuses (PlanRefused) when it is outside the repo, unreadable, or a symlink that lands outside.
export function planFile(root, path) {
  const realRoot = realpathSync(root);
  if (isOutside(relative(realRoot, resolve(realRoot, path)))) throw new PlanRefused(`the plan ${path} is outside the repo`);
  let real;
  try {
    real = realpathSync(resolve(realRoot, path));
  } catch (e) {
    throw new PlanRefused(`the plan ${path} cannot be read: ${e.code}`);
  }
  if (isOutside(relative(realRoot, real))) throw new PlanRefused(`the plan ${path} is a symlink that lands outside the repo`);
  return real;
}

function boxOf(text, { path, title }) {
  const boxes = boxesTitled(text, title);
  if (boxes.length === 0) throw new PlanRefused(`the plan ${path} has no box titled ${JSON.stringify(title)}`);
  if (boxes.length > 1) throw new PlanRefused(`the plan ${path} has ${boxes.length} boxes titled ${JSON.stringify(title)}`);
  return boxes[0];
}

// Writes text to a temp file and renames it over file, which keeps its mode when it exists.
export function replaceFile(file, text) {
  const temp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temp, text, { mode: existsSync(file) ? statSync(file).mode : 0o644 });
  renameSync(temp, file);
}

// True when this call ticked the box. A box already ticked stays, so a repeat after a crash goes on to end the task.
export function tickPlanBox(root, plan) {
  const file = planFile(root, plan.path);
  const text = readFileSync(file, "utf8");
  const box = boxOf(text, plan);
  if (box.ticked) return false;
  replaceFile(file, `${text.slice(0, box.markAt)}${TICKED_MARK}${text.slice(box.markAt + 1)}`);
  return true;
}
