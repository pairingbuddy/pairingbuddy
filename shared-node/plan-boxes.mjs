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

const hasTitle = ({ label }, title) => label === title || label.replace(BOLD, "$1") === title;

function planFile(root, path) {
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
  const boxes = checkboxes(text).filter((box) => hasTitle(box, title));
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
