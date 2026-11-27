// The whole plan as a page: every tracer, unit and task, with the states the pane's PLAN block gives them, which shows only a
// window of it. /pb-plan writes it under the reports folder and opens it. Pure; no I/O, no node: imports.
import { firstUnticked, holdsBuilding, humanWords, planFocus, STATE_SEPARATOR, taskMark, unitWords } from "./plan-window.mjs";
import { openQuestions, taskTitle } from "./questions.mjs";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);

// The report's look: one monospace face, the pane's accent for the task being built, dim for what is done.
export const STYLE = `:root{color-scheme:light dark;--bg:#15161a;--fg:#e3e4e8;--muted:#8a8d96;--rule:#2b2d34;--link:#39c5cf;--accent:#39c5cf;--needs-you:#e3b341}
@media (prefers-color-scheme:light){:root{--bg:#fbfbf9;--fg:#1c1d21;--muted:#696c74;--rule:#e1e2e5;--link:#0a6f78;--accent:#0a6f78;--needs-you:#8a5a00}}
*{font-size:inherit}
body{background:var(--bg);color:var(--fg);font:14px/1.65 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;margin:0 auto;padding:48px 32px 64px;max-width:110ch}
h1,h2,h3,p,ul{margin:0}
h1{font-weight:700}
header{border-bottom:1px solid var(--rule);padding-bottom:10px;margin-bottom:24px}
header p{color:var(--muted)}
a{color:var(--link);text-underline-offset:3px}
section{margin:0 0 20px}
h2{font-weight:700}
h3{font-weight:400;margin-top:6px}
ul{list-style:none;padding:0 0 0 2ch}
.facts{color:var(--muted)}
.ticked{color:var(--muted)}
.building{color:var(--accent);font-weight:700}
.waiting{color:var(--needs-you);font-weight:700}
.problems li{color:var(--needs-you)}
summary{cursor:pointer}
summary h2,summary h3{display:inline}
summary::marker{color:var(--muted)}
.intro,.body{color:var(--fg);border-left:2px solid var(--rule);margin:4px 0 8px 1ch;padding:2px 0 2px 2ch;font-weight:400}
.intro{color:var(--muted)}
.body p,.intro p{margin:0 0 6px}
.body ul{list-style:disc;padding-left:3ch;margin:0 0 6px}
.ticked .body,.waiting .body,.building .body{color:var(--fg);font-weight:400}
code{background:var(--rule);border-radius:3px;padding:0 3px}
.controls{margin-top:6px}
.controls button{font:inherit;color:var(--link);background:none;border:1px solid var(--rule);border-radius:4px;padding:1px 8px;cursor:pointer}
.controls button:hover{border-color:var(--link)}
@media (max-width:600px){body{padding:28px 16px 48px}}`;

// Expand all and Collapse all: hidden in the markup, shown by the page's own script, so a page whose script does not run
// shows no button that does nothing; its folds still open by hand.
const CONTROLS = `<p class="controls" hidden><button type="button" data-open="true">Expand all</button> <button type="button" data-open="false">Collapse all</button></p>`;
const CONTROLS_SCRIPT = `<script>(() => { const c = document.querySelector(".controls"); c.removeAttribute("hidden"); c.addEventListener("click", (e) => { const open = e.target.dataset && e.target.dataset.open; if (open) document.querySelectorAll("details").forEach((d) => { d.open = open === "true"; }); }); })();</script>`;

// Consecutive units of one tracer form a group, as the pane groups them; a unit under no tracer is its own group.
function tracerGroups(units) {
  const groups = [];
  for (const [index, unit] of units.entries()) {
    const last = groups.at(-1);
    if (last && unit.tracer && last.tracer === unit.tracer) last.units.push({ unit, index });
    else groups.push({ tracer: unit.tracer, units: [{ unit, index }] });
  }
  return groups;
}

// A unit's PR link: an anchor for a url, the text as written otherwise.
const prLink = (pr) => (/^https?:\/\//.test(pr) ? `<a href="${escape(pr)}">${escape(pr)}</a>` : escape(pr));

// The open unit's facts: its branch and base. Its commits have their own fold.
function openFacts(open) {
  return [...(open.branch ? [`branch ${open.branch}`] : []), ...(open.base ? [`base ${open.base}`] : [])];
}

// One commit's row: its short hash, then its subject when one is known.
const commitRow = (sha, subjects) => `<li>${escape(sha.slice(0, 7))}${subjects[sha] ? ` ${escape(subjects[sha])}` : ""}</li>`;

const AFTER_LAST_TASK = "after the last finished task";

// The commits by the task they belong to, in order: a task's commits run up to its recorded last commit (headSha), the
// commits after every task's last one under AFTER_LAST_TASK. Null when no task's last commit is among them, so the fold is
// one flat list.
function commitsByTask(commits, tasks = []) {
  const ends = tasks.map(({ title, headSha }) => ({ title, end: commits.indexOf(headSha) })).filter(({ end }) => end >= 0).sort((a, b) => a.end - b.end);
  if (ends.length === 0) return null;
  let from = 0;
  const groups = ends.map(({ title, end }) => {
    const group = { title, commits: commits.slice(from, end + 1) };
    from = Math.max(from, end + 1);
    return group;
  });
  if (from < commits.length) groups.push({ title: AFTER_LAST_TASK, commits: commits.slice(from) });
  return groups.filter((group) => group.commits.length > 0);
}

const newestFirst = (commits, subjects) => [...commits].reverse().map((sha) => commitRow(sha, subjects)).join("\n");

// The open unit's commits in one fold, folded, that counts them; inside, newest first, under their task when the unit record
// tells each task's last commit. subjects: each commit's first line, by its full hash, where the caller could read it.
function commitsFold(open, subjects = {}) {
  const commits = open.commits ?? [];
  if (commits.length === 0) return "";
  const groups = commitsByTask(commits, open.tasks);
  const list = groups
    ? groups.reverse().map(({ title, commits: own }) => `<li class="task-commits">${escape(title)}\n<ul>\n${newestFirst(own, subjects)}\n</ul></li>`).join("\n")
    : newestFirst(commits, subjects);
  return `<li class="facts"><details class="commits">\n<summary>${commits.length} commit${commits.length === 1 ? "" : "s"}</summary>\n<ul>\n${list}\n</ul>\n</details></li>`;
}

// A line of plan text as HTML: escaped first, then `code` and **bold** only, so no markup in the plan reaches the page.
function inline(text) {
  return text
    .split(/(`[^`]+`)/)
    .map((part) => (/^`[^`]+`$/.test(part) ? `<code>${escape(part.slice(1, -1))}</code>` : escape(part).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")))
    .join("");
}

const LIST_ITEM = /^\s*(?:[-*]|\d+\.)\s+(.*)$/;

// A task body as HTML: paragraphs and lists, with inline code and bold; a blank line ends a paragraph, a "- " or "1. " line is
// a list item, and an indented line under an item continues it. Nothing else of markdown is read.
function bodyHtml(body) {
  const blocks = [];
  let block = null;
  for (const line of body.split("\n")) {
    const item = LIST_ITEM.exec(line);
    if (!line.trim()) block = null;
    else if (item) {
      if (block?.kind !== "list") blocks.push((block = { kind: "list", lines: [] }));
      block.lines.push(item[1]);
    } else if (block?.kind === "list" && /^\s/.test(line)) block.lines[block.lines.length - 1] += ` ${line.trim()}`;
    else {
      if (block?.kind !== "para") blocks.push((block = { kind: "para", lines: [] }));
      block.lines.push(line.trim());
    }
  }
  return blocks
    .map(({ kind, lines }) => (kind === "list" ? `<ul>\n${lines.map((text) => `<li>${inline(text)}</li>`).join("\n")}\n</ul>` : `<p>${inline(lines.join(" "))}</p>`))
    .join("\n");
}

// One task's row: its mark and title, ▸ and lit for the one being built, and lit in the needs-you colour with humanWords for
// an unticked [HUMAN] task. The focus is the row the page opens at.
function taskItem(task, { inProgress, reached, isFocus }) {
  const human = inProgress ? "" : humanWords(task, reached);
  const kind = task.checked ? "ticked" : inProgress ? "building" : human ? "waiting" : "unticked";
  const words = human ? `${STATE_SEPARATOR}${human}` : "";
  const row = `${taskMark(task, inProgress)} ${escape(task.title)}${words}`;
  const attrs = `class="${kind}"${isFocus ? ' id="now"' : ""}`;
  if (!task.body?.trim()) return `<li ${attrs}>${row}</li>`;
  return `<li ${attrs}><details${isFocus ? " open" : ""}>\n<summary>${row}</summary>\n<div class="body">\n${bodyHtml(task.body)}\n</div>\n</details></li>`;
}

// The open unit's questions for you: the doubts auto passes set aside, which G:publish asks before the pull request. The
// unit keeps at most QUESTIONS_KEPT in full, so the list is bounded; the rest are counted.
function questionsItems(open) {
  const { kept, more, count } = openQuestions(open);
  if (count === 0) return [];
  const head = `<li class="waiting">${count} ${count === 1 ? "question" : "questions"} for you, asked before the pull request</li>`;
  const each = kept.map(({ ambiguity, task }) => `<li class="facts">${escape(`${ambiguity}${task ? ` (${taskTitle(task)})` : ""}`)}</li>`);
  return [head, ...each, ...(more > 0 ? [`<li class="facts">+${more} more in the report</li>`] : [])];
}

function unitSection(unit, { state, open, building, publishing, focusTask, reached, subjects }) {
  const isOpen = Boolean(open && open.unit === unit.unit);
  const words = unitWords(state, isOpen || holdsBuilding(unit, building), publishing);
  const facts = [...(unit.dependsOn ? [escape(`based on ${unit.dependsOn}`)] : []), ...(isOpen ? openFacts(open).map(escape) : []), ...(unit.pr ? [`PR ${prLink(unit.pr)}`] : [])];
  const tasks = [...(isOpen ? questionsItems(open) : []), ...unit.tasks.map((task) => taskItem(task, { inProgress: !task.checked && task.title === building, reached, isFocus: task === focusTask }))];
  // A unit always starts open, so opening its tracer shows its tasks at once; the tracer and each task's body stay folded.
  return `<details open>
<summary><h3>${escape(unit.unit)}${words ? escape(`${STATE_SEPARATOR}${words}`) : ""}</h3></summary>
<ul>
${[...facts.map((fact) => `<li class="facts">${fact}</li>`), ...(isOpen ? [commitsFold(open, subjects)].filter(Boolean) : []), ...tasks].join("\n")}
</ul>
</details>`;
}

// A tracer's Goal and Verification lines, as the plan wrote them, or nothing when it has neither.
function tracerIntro(intro) {
  const lines = [["Goal", intro?.goal], ["Verification", intro?.verification]].filter(([, words]) => words);
  return lines.length ? `<div class="intro">\n${lines.map(([label, words]) => `<p>${inline(`**${label}:** ${words}`)}</p>`).join("\n")}\n</div>\n` : "";
}

// One tracer's group: a details whose summary is its name, opening to its intro and then its units.
function tracerSection(tracer, intro, body, { holdsFocus, done, total }) {
  if (!tracer) return `<section>\n${body}\n</section>`;
  return `<section>\n<details${holdsFocus ? " open" : ""}>\n<summary><h2>${escape(tracer)}${STATE_SEPARATOR}${done} of ${total} done</h2></summary>\n${tracerIntro(intro)}${body}\n</details>\n</section>`;
}

// plan: parsePlan's result; states: each unit's state, by position (unitStates); open: the open unit's record, resolved to
// its plan unit; building: the title of the task the live run builds; publishing: a live publish run writes the open unit's
// pull request; path: where the plan is, named in the header; subjects: each open-unit commit's first line, by full hash.
// A plan can be reordered to the order it runs while its tracers keep their ids, so the page says how to read the order.
const ORDER_NOTE = `<p class="order-note">Tracer bullets are listed in the order they run; their numbers are the ids they got when the plan was written.</p>`;

export function renderPlanPage({ plan, states = [], open, building, publishing = false, path, subjects = {} } = {}) {
  const units = plan?.units ?? [];
  const at = planFocus(units, building);
  const focusTask = at ? units[at.unit].tasks[at.task] : undefined;
  const reached = firstUnticked(units);
  const all = units.flatMap(({ tasks }) => tasks);
  const done = all.filter(({ checked }) => checked).length;
  const groups = tracerGroups(units).map(({ tracer, units: grouped }) => {
    const body = grouped.map(({ unit, index }) => unitSection(unit, { state: states[index], open, building, publishing, focusTask, reached, subjects })).join("\n");
    const holdsFocus = grouped.some(({ unit }) => unit.tasks.includes(focusTask));
    const tasks = grouped.flatMap(({ unit }) => unit.tasks);
    const progress = { holdsFocus, done: tasks.filter(({ checked }) => checked).length, total: tasks.length };
    return tracerSection(tracer, plan?.tracers?.find(({ name }) => name === tracer), body, progress);
  });
  const problems = plan?.problems ?? [];
  const problemList = problems.length ? `<section class="problems">\n<h2>Plan problems</h2>\n<ul>\n${problems.map((problem) => `<li>${escape(problem)}</li>`).join("\n")}\n</ul>\n</section>\n` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plan</title>
<style>
${STYLE}
</style></head>
<body>
<header>
<h1>PLAN</h1>
<p>${escape(path ?? "")}${path ? STATE_SEPARATOR : ""}${done} of ${all.length} tasks done${focusTask ? `${STATE_SEPARATOR}<a href="#now">where the plan is</a>` : ""}</p>
${(plan?.tracers ?? []).length > 0 ? `${ORDER_NOTE}\n` : ""}${CONTROLS}
</header>
${problemList}${groups.join("\n")}
${CONTROLS_SCRIPT}
</body></html>`;
}
