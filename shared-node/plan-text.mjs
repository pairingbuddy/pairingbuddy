// Plan text rules: how a plan's checkboxes, headings and PR: lines read. Pure, with no imports, so the mod can load them
// (plan-boxes.mjs adds the file writer on top and re-exports these).
const CHECKBOX = /^\s*[-*+]\s+\[([ xX])\](.*)$/gm;
const BOLD = /^\*\*(.*)\*\*$/;

export const checkboxes = (text) =>
  [...text.matchAll(CHECKBOX)].map(({ 0: line, 1: mark, 2: label, index }) => ({ ticked: mark !== " ", label: label.trim(), markAt: index + line.indexOf("[") + 1 }));

// A box's label as a task title: the bold a plan puts around it is not part of the title.
export const boxLabel = (label) => label.replace(BOLD, "$1");

export const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const PR_PREFIX = /^PR:\s*/;
export const isPrHeading = (text) => PR_PREFIX.test(text);
export const headingName = (text) => text.replace(PR_PREFIX, "").trim();

// The "PR: <url>" line pb publish writes under a unit's heading; capture 1 is the url.
export const PR_LINE = /^PR:\s+(\S*)/;

// Every box in the whole text titled "title": what pb task end looks for, and what the plan parser counts.
export const boxesTitled = (text, title) => checkboxes(text).filter(({ label }) => boxLabel(label) === title);

// The index of the line holding the unit's heading, or -1. A "PR:" prefix on the heading is not part of its name.
export const unitHeadingIndex = (lines, unit) =>
  lines.findIndex((line) => {
    const heading = HEADING.exec(line);
    return heading !== null && headingName(heading[2]) === headingName(unit);
  });

// The boxes ({ label, ticked }) under the heading of a unit, up to the next heading of the same or a higher level. Null
// when the plan has no such heading.
export function boxesUnder(text, unit) {
  const lines = text.split("\n");
  const start = unitHeadingIndex(lines, unit);
  if (start === -1) return null;
  const level = HEADING.exec(lines[start])[1].length;
  const end = lines.findIndex((line, i) => i > start && (HEADING.exec(line)?.[1].length ?? Infinity) <= level);
  return checkboxes(lines.slice(start + 1, end === -1 ? undefined : end).join("\n")).map(({ label, ticked }) => ({ label: boxLabel(label), ticked }));
}

const HUMAN_TITLE = /^(?:Task\s+[^:\s]+:\s*)?\[HUMAN\]/; // [HUMAN] opens a title, or follows a leading "Task <id>:"
export const isHumanTitle = (title) => HUMAN_TITLE.test(title);

// The unit's [HUMAN] tasks still unticked: only a person does one and ticks its box, and pb publish refuses while any is left.
export const humanTasksLeft = (boxes) => (boxes ?? []).filter(({ label, ticked }) => !ticked && isHumanTitle(label)).map(({ label }) => label);
