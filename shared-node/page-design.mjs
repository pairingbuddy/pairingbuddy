// The one look of every page pb writes (the report, the plan, the questions): colour tokens with a dark mode, a colour per
// state, status boxes, pills, cards, progress bars, folds and a frame slider. Each page inlines PAGE_CSS, so it stays one
// self-contained file. Pure; no I/O.

// The most frames a slider keeps; the stylesheet has a rule for each.
export const SLIDER_FRAMES = 40;

// Light first; the dark set follows the system unless the page is forced light, and data-theme="dark" forces it.
const DARK = "--bg:#12161d;--surface:#181d26;--fg:#e3e7ee;--muted:#98a2b3;--line:#2a313d;--term:#0a0d12;--termfg:#d8dee9;--blue:#7aa7f0;--pass:#5cc98a;--fail:#f08a80;--amber:#e8b04a;--todo:#7d8798;color-scheme:dark";

export const PAGE_CSS = `:root{--bg:#f6f7f9;--surface:#ffffff;--fg:#1b2230;--muted:#5d6778;--line:#d9dee6;--term:#11161f;--termfg:#d8dee9;--blue:#2f6fd6;--pass:#1d7a46;--fail:#b3261e;--amber:#9a6200;--todo:#8a93a3;color-scheme:light;
--sans:"Atkinson Hyperlegible",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font:16px/1.55 var(--sans);margin:0}
main{max-width:900px;margin:0 auto;padding:32px max(16px,env(safe-area-inset-right,0px)) 64px max(16px,env(safe-area-inset-left,0px));display:flex;flex-direction:column;gap:20px}
h1{font-size:1.75rem;margin:0;text-wrap:balance}
h2{font-size:1.2rem;margin:0}
h3{font-size:1.02rem;margin:0}
p{margin:0}
a{color:var(--blue);text-underline-offset:3px}
code,kbd,samp{font:.86em var(--mono);background:color-mix(in srgb,var(--line) 55%,transparent);border-radius:4px;padding:0 4px}
small,.muted,.facts{color:var(--muted)}
a:focus-visible,summary:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.is-done{--state:var(--pass)}
.is-failed{--state:var(--fail)}
.is-waiting{--state:var(--amber)}
.is-running{--state:var(--blue)}
.is-todo{--state:var(--todo)}
.pill{display:inline-flex;align-items:center;gap:4px;font:600 .72rem/1 var(--mono);padding:4px 7px;border-radius:4px;border:1.5px solid var(--state,var(--muted));color:var(--state,var(--muted));letter-spacing:.04em;white-space:nowrap;text-transform:uppercase;vertical-align:middle}
.box{border:1px solid var(--line);border-left:4px solid var(--state,var(--line));background:color-mix(in srgb,var(--state,var(--line)) 7%,var(--surface));border-radius:6px;padding:12px 14px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:14px 16px}
.bar{display:flex;align-items:center;gap:10px;font:.8rem var(--mono);color:var(--muted);font-variant-numeric:tabular-nums}
.bar .track{flex:1;min-width:80px;max-width:260px;height:8px;border-radius:4px;background:color-mix(in srgb,var(--line) 80%,transparent);overflow:hidden}
.bar .fill{display:block;height:100%;background:var(--state,var(--pass));border-radius:4px}
details>summary{cursor:pointer}
details>summary::marker{color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{text-align:left;padding:6px 10px 6px 0;border-bottom:1px solid var(--line);vertical-align:top}
th{font:600 .72rem var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
td.is-done,td.is-failed,td.is-waiting,td.is-running{color:var(--state);font-weight:600}
.slider{display:flex;flex-direction:column;gap:10px}
.slider>.pick{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.slider>nav{display:flex;flex-wrap:wrap;gap:4px}
.slider .dot{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 6px;border-radius:13px;border:1.5px solid var(--state,var(--line));color:var(--state,var(--muted));font:600 .72rem var(--mono);cursor:pointer;background:var(--surface)}
.slider .dot:hover{background:color-mix(in srgb,var(--state,var(--line)) 15%,var(--surface))}
.slider>div{display:none;flex-direction:column;gap:8px}
.slider .nav{display:flex;align-items:center;gap:10px}
.slider .step{font:inherit;padding:0 10px;border:1px solid var(--line);border-radius:4px;cursor:pointer;user-select:none}
.slider span.step{opacity:.35;cursor:default}
.slider .when{font:.85rem var(--mono);color:var(--muted);font-variant-numeric:tabular-nums}
.slider>.pick:focus-visible~nav{outline:2px solid var(--blue);outline-offset:3px;border-radius:6px}
${Array.from({ length: SLIDER_FRAMES }, (_, n) => `.slider>input:nth-of-type(${n + 1}):checked~div:nth-of-type(${n + 1}){display:flex}`).join("\n")}
${Array.from({ length: SLIDER_FRAMES }, (_, n) => `.slider>input:nth-of-type(${n + 1}):checked~nav label:nth-of-type(${n + 1}){background:var(--state,var(--blue));color:var(--surface)}`).join("\n")}
.term{background:var(--term);color:var(--termfg);border-radius:6px;padding:12px;overflow-x:auto}
.term pre{margin:0;font:12.5px/1.45 var(--mono);white-space:pre}
.controls{display:flex;gap:8px}
.controls[hidden]{display:none}
.controls button{font:inherit;font-size:.85rem;color:var(--blue);background:none;border:1px solid var(--line);border-radius:4px;padding:2px 10px;cursor:pointer}
.controls button:hover{border-color:var(--blue)}
@media (max-width:600px){main{padding-top:24px}h1{font-size:1.45rem}}`;

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);

// Each state's mark, as the pane draws it: done, failed, waiting for you, running, to come.
export const MARKS = { done: "✓", failed: "✕", waiting: "▲", running: "●", todo: "○" };

// A state as a pill: its mark and words, in the state's colour.
export const pill = (state, words) => `<span class="pill is-${state}">${MARKS[state]} ${escape(words)}</span>`;

// How far a list of work is: a bar filled to the share done, with the count beside it.
export function progressBar(done, total, what) {
  const share = total > 0 ? Math.round((done / total) * 100) : 0;
  const words = `${done} of ${total} ${what} done`;
  return `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-label="${escape(words)}"><span class="track"><span class="fill" style="width:${share}%"></span></span><span>${escape(words)}</span></div>`;
}

// A slider through frames (the steps of a run, or recorded screens), with no script: one radio per frame, the last chosen,
// a row of dots to pick one, and step buttons in each frame. The stylesheet shows the chosen frame. A slider keeps the last
// SLIDER_FRAMES frames and counts the rest. frames: [{ when, state, title, html }], html already safe. One frame is drawn as
// it is; none draws nothing. chosen: the frame it opens on, by its index in frames; the last when not given or not kept.
export function slider({ id, label, frames = [], chosen }) {
  if (frames.length === 0) return "";
  if (frames.length === 1) return frames[0].html;
  const earlier = Math.max(0, frames.length - SLIDER_FRAMES);
  const kept = frames.slice(earlier);
  const last = kept.length - 1;
  const open = Number.isInteger(chosen) && chosen - earlier >= 0 && chosen - earlier <= last ? chosen - earlier : last;
  const radio = (n) => `${id}-${n}`;
  const picks = kept.map((_, n) => `<input type="radio" name="${escape(id)}" id="${escape(radio(n))}" class="pick"${n === open ? " checked" : ""}>`).join("");
  const dots = kept.map(({ state, title }, n) => `<label for="${escape(radio(n))}" class="dot is-${state}" title="${escape(title)}">${n + 1 + earlier}</label>`).join("");
  const step = (n, words, mark) => (n < 0 || n > last ? `<span class="step" aria-hidden="true">${mark}</span>` : `<label for="${escape(radio(n))}" class="step" aria-label="${words}">${mark}</label>`);
  const view = kept.map(({ when, html }, n) => `<div class="frame"><p class="nav">${step(n - 1, "Previous", "◀")}<span class="when">${n + 1 + earlier} of ${frames.length}${when ? ` · ${escape(when)}` : ""}</span>${step(n + 1, "Next", "▶")}</p>${html}</div>`).join("\n");
  const more = earlier > 0 ? `<p class="muted">${earlier} earlier not shown</p>\n` : "";
  return `<div class="slider" role="group" aria-label="${escape(label)}">${picks}\n${more}<nav>${dots}</nav>\n${view}\n</div>`;
}
