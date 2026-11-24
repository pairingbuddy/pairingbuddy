// The whole plan as a page: every tracer, unit and task, with the states the pane's PLAN block gives them, which shows only a
// window of it. /pb-plan writes it under the reports folder and opens it. Pure; no I/O, no node: imports.
import { planFocus, STATE_SEPARATOR, taskMark, unitWords, WAITING_ON_PERSON } from "./plan-window.mjs";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);

// The report's look: one monospace face, the pane's accent for the task being built, dim for what is done.
const STYLE = `:root{color-scheme:light dark;--bg:#15161a;--fg:#e3e4e8;--muted:#8a8d96;--rule:#2b2d34;--link:#39c5cf;--accent:#39c5cf;--needs-you:#e3b341}
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
@media (max-width:600px){body{padding:28px 16px 48px}}`;

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

// The open unit's facts: its branch, base and every commit, the page having room for them all.
function openFacts(open) {
  return [...(open.branch ? [`branch ${open.branch}`] : []), ...(open.base ? [`base ${open.base}`] : []), ...(open.commits ?? []).map((sha) => `commit ${sha.slice(0, 7)}`)];
}

// One task's row: its mark and title, ▸ and lit for the one being built, and waiting on a person for a [HUMAN] task that is
// its unit's next unticked one. The focus is the row the page opens at.
function taskItem(task, { inProgress, isNext, isFocus }) {
  const waiting = task.human && isNext && !task.checked;
  const kind = task.checked ? "ticked" : inProgress ? "building" : waiting ? "waiting" : "unticked";
  const words = waiting ? `${STATE_SEPARATOR}${WAITING_ON_PERSON}` : "";
  return `<li class="${kind}"${isFocus ? ' id="now"' : ""}>${taskMark(task, inProgress)} ${escape(task.title)}${words}</li>`;
}

function unitSection(unit, { state, open, building, publishing, focusTask }) {
  const isOpen = Boolean(open && open.unit === unit.unit);
  const words = unitWords(state, isOpen, publishing);
  const next = unit.tasks.find((task) => !task.checked);
  const facts = [...(unit.dependsOn ? [escape(`based on ${unit.dependsOn}`)] : []), ...(isOpen ? openFacts(open).map(escape) : []), ...(unit.pr ? [`PR ${prLink(unit.pr)}`] : [])];
  const tasks = unit.tasks.map((task) => taskItem(task, { inProgress: !task.checked && task.title === building, isNext: task === next, isFocus: task === focusTask }));
  return `<h3>${escape(unit.unit)}${words ? escape(`${STATE_SEPARATOR}${words}`) : ""}</h3>
<ul>
${facts.map((fact) => `<li class="facts">${fact}</li>`).join("\n")}${facts.length ? "\n" : ""}${tasks.join("\n")}
</ul>`;
}

// plan: parsePlan's result; states: each unit's state, by position (unitStates); open: the open unit's record, resolved to
// its plan unit; building: the title of the task the live run builds; publishing: a live publish run writes the open unit's
// pull request; path: where the plan is, named in the header.
export function renderPlanPage({ plan, states = [], open, building, publishing = false, path } = {}) {
  const units = plan?.units ?? [];
  const at = planFocus(units, building);
  const focusTask = at ? units[at.unit].tasks[at.task] : undefined;
  const all = units.flatMap(({ tasks }) => tasks);
  const done = all.filter(({ checked }) => checked).length;
  const groups = tracerGroups(units).map(({ tracer, units: grouped }) => {
    const body = grouped.map(({ unit, index }) => unitSection(unit, { state: states[index], open, building, publishing, focusTask })).join("\n");
    return `<section>\n${tracer ? `<h2>${escape(tracer)}</h2>\n` : ""}${body}\n</section>`;
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
</header>
${problemList}${groups.join("\n")}
</body></html>`;
}
