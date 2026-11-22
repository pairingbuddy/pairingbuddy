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
