// Pure parts of pb snapshot.
// Every git call reads raw names and plain text: no quoting of non-ASCII names, no external diff driver or textconv, and
// the C locale, so the same commit gives the same bytes on any machine.
export const GIT_ENV = { LC_ALL: "C" };
const GIT_RAW = ["-c", "core.quotepath=off"];
export const subjectDiffArgv = (baseSha) => [...GIT_RAW, "diff", "--no-color", "--no-ext-diff", "--no-textconv", `${baseSha}..HEAD`];
export const subjectStatArgv = (baseSha) => [...GIT_RAW, "diff", "--stat=120", "--no-color", "--no-ext-diff", "--no-textconv", `${baseSha}..HEAD`];
export const SUBJECT_DIFF_FILE = "subject.diff";
export const CHANGED_FILE = "changed.json";
export const CORPUS_FILE = "corpus.json";
export const changedArgv = (baseSha) => [...GIT_RAW, "diff", "--name-status", "-z", "--no-ext-diff", "--no-textconv", "--no-renames", `${baseSha}..HEAD`];

// Code point order, the same on every machine. The default sort compares UTF-16 units, which puts a character outside the BMP before U+E000..U+FFFF.
export const byCodePoint = (a, b) => {
  const [x, y] = [[...a], [...b]];
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    if (x[i] !== y[i]) return x[i].codePointAt(0) - y[i].codePointAt(0);
  }
  return x.length - y.length;
};

const nulFields = (text) => text.split("\0").slice(0, -1);

// git diff --name-status -z --no-renames: STATUS NUL PATH NUL, repeated.
export const parseChanged = (text) => {
  const fields = nulFields(text);
  if (fields.length % 2 !== 0) throw new Error(`git diff --name-status -z gave an odd number of fields (${fields.length})`);
  const entries = [];
  for (let i = 0; i < fields.length; i += 2) entries.push({ path: fields[i + 1], status: fields[i] });
  return entries.sort((a, b) => byCodePoint(a.path, b.path));
};
export const buildCorpus = (candidates, isUsable) =>
  [...new Set(candidates.filter(isUsable))].sort(byCodePoint);

// The files at HEAD. .git, node_modules, .pairingbuddy and files deleted since are not in a tree, so nothing excludes them here.
export const trackedFilesArgv = () => ["ls-tree", "-r", "-z", "--name-only", "HEAD"];
export const parseTracked = nulFields;

export const NEAREST_PER_PATH = 5;
export const NEAREST_TOTAL_CAP = 200;
const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

// The closest files to each changed path (its own directory, then each parent), up to 5 per path, then the closest
// first across all changed paths, up to 200 files in all.
export const nearestFiles = (tracked, changedPaths) => {
  const changed = new Set(changedPaths);
  const candidates = [];
  for (const path of changedPaths) {
    const near = [];
    let distance = 0;
    for (let dir = dirOf(path); ; dir = dirOf(dir), distance += 1) {
      near.push(...tracked.filter((t) => dirOf(t) === dir && !changed.has(t)).sort(byCodePoint).map((file) => ({ file, distance })));
      if (dir === "") break;
    }
    candidates.push(...near.slice(0, NEAREST_PER_PATH));
  }
  const closestFirst = candidates.sort((a, b) => a.distance - b.distance).map(({ file }) => file);
  return [...new Set(closestFirst)].slice(0, NEAREST_TOTAL_CAP);
};
export const repoRelative = (realRoot, realPath) =>
  realPath.startsWith(`${realRoot}/`) ? realPath.slice(realRoot.length + 1) : null;

// The tracked files the task text names, by repo-relative path or by bare file name, sorted, up to 200.
// A word is a run of letters, digits and _ . - /; a leading ./ and trailing dots (sentence ends) are dropped.
const baseOf = (p) => p.slice(p.lastIndexOf("/") + 1);
export const namedFiles = (tracked, taskText) => {
  const words = String(taskText ?? "").match(/[\p{L}\p{N}_.\-/]+/gu) ?? [];
  const names = new Set(words.map((w) => w.replace(/^(\.\/)+/, "").replace(/\.+$/, "")).filter(Boolean));
  const named = tracked.filter((t) => names.has(t) || names.has(baseOf(t)));
  return [...new Set(named)].sort(byCodePoint).slice(0, NEAREST_TOTAL_CAP);
};

// How much of the unit's diff the agents get in subject.diff. A whole diff of tens of thousands of lines buries the change
// and has crashed a step; past these bounds the file holds the diffstat and each file's diff cut short.
export const SUBJECT_DIFF_MAX_LINES = 8000;
export const SUBJECT_FILE_MAX_LINES = 400;

const lineCount = (text) => text.split("\n").length;
const nameOfChunk = (chunk) => chunk.slice(0, chunk.indexOf("\n")).replace(/^diff --git a\/.* b\//, "");

// One file's diff, cut after its first SUBJECT_FILE_MAX_LINES lines with a line that says how many it left out.
const cutChunk = (chunk) => {
  const lines = chunk.replace(/\n$/, "").split("\n");
  if (lines.length <= SUBJECT_FILE_MAX_LINES) return lines.join("\n");
  return [...lines.slice(0, SUBJECT_FILE_MAX_LINES), `… ${lines.length - SUBJECT_FILE_MAX_LINES} more lines of ${nameOfChunk(chunk)}`].join("\n");
};

// The diff the agents read: whole while within SUBJECT_DIFF_MAX_LINES; past it, a note, the diffstat, then each file's
// diff in git's order, cut at SUBJECT_FILE_MAX_LINES, until the bound, and a last line counting the files left out.
export const boundDiff = (diff, stat, baseSha) => {
  if (lineCount(diff) <= SUBJECT_DIFF_MAX_LINES) return diff;
  const whole = `git diff ${baseSha}..HEAD`;
  const head = [`This change is too big to show whole (${lineCount(diff)} lines). Below: the diffstat, then each file's diff cut at ${SUBJECT_FILE_MAX_LINES} lines. Run ${whole} for the rest.`, "", stat.replace(/\n$/, ""), ""];
  const chunks = diff.split(/^(?=diff --git )/m).filter((chunk) => chunk.startsWith("diff --git "));
  const out = [...head];
  let used = lineCount(head.join("\n"));
  let shown = 0;
  for (const chunk of chunks) {
    const cut = cutChunk(chunk);
    if (used + lineCount(cut) > SUBJECT_DIFF_MAX_LINES) break;
    out.push(cut);
    used += lineCount(cut);
    shown += 1;
  }
  if (shown < chunks.length) out.push(`… ${chunks.length - shown} more files, see ${whole}`);
  return `${out.join("\n")}\n`;
};
