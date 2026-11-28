// Plan checkboxes: how the gate reads them, and the one writer, which only pb task end calls. Tasks are identified by
// title (D12), and the text around a box is the human's, so only its mark changes. Node built-ins only.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { isOutside } from "./checkpoint.mjs";
import { boxesTitled, boxesUnder, boxLabel, checkboxes, HEADING, headingName, isPrHeading, PR_LINE, unitHeadingIndex } from "./plan-text.mjs";

export { boxesTitled, boxesUnder, boxLabel, checkboxes, HEADING, headingName, isPrHeading, PR_LINE };

const TICKED_MARK = "x";

export class PlanRefused extends Error {}

// The labels of the boxes under the heading of a unit. Null when the plan has no such heading.
export const boxLabelsUnder = (text, unit) => boxesUnder(text, unit)?.map(({ label }) => label) ?? null;

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

export const HAND_DONE_LINE = "Done by hand: accepted";

// The text with the task's box ticked and HAND_DONE_LINE indented directly under it: the human's record that they
// finished the task themselves. Pure; refuses (PlanRefused) when no box or more than one has the title.
export function withHandDone(text, plan) {
  const box = boxOf(text, plan);
  const lineStart = text.lastIndexOf("\n", box.markAt) + 1;
  const newline = text.indexOf("\n", box.markAt);
  const lineEnd = newline === -1 ? text.length : newline;
  const indent = /^\s*/.exec(text.slice(lineStart, lineEnd))[0];
  const ticked = `${text.slice(0, box.markAt)}${TICKED_MARK}${text.slice(box.markAt + 1, lineEnd)}`;
  return `${ticked}\n${indent}  ${HAND_DONE_LINE}${text.slice(lineEnd)}`;
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
