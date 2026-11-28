// Scenario page-design: every page pb writes (the report, the plan, the questions) shares one look: the colour tokens with a
// dark mode, the five states (done, failed, waiting for you, running, to come), status boxes, pills, cards, progress bars,
// folds and a frame slider.
import { test } from "node:test";
import assert from "node:assert/strict";

import { PAGE_CSS, pill, progressBar, slider, SLIDER_FRAMES } from "../../shared-node/page-design.mjs";

test("the shared stylesheet holds the colour tokens, a dark mode and one colour per state", () => {
  assert.match(PAGE_CSS, /:root\{[^}]*--bg:/, "tokens on :root");
  assert.match(PAGE_CSS, /@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{/, "dark mode follows the system");
  assert.match(PAGE_CSS, /:root\[data-theme="dark"\]\{/, "dark mode can be forced");
  for (const state of ["done", "failed", "waiting", "running", "todo"]) assert.match(PAGE_CSS, new RegExp(`\\.is-${state}\\{[^}]*--state:`), `${state} sets its colour`);
});

test("a pill says a state with its mark and its colour, and escapes the words", () => {
  assert.equal(pill("done", "done"), '<span class="pill is-done">✓ done</span>');
  assert.equal(pill("failed", "stopped"), '<span class="pill is-failed">✕ stopped</span>');
  assert.equal(pill("waiting", "needs you"), '<span class="pill is-waiting">▲ needs you</span>');
  assert.equal(pill("running", "building"), '<span class="pill is-running">● building</span>');
  assert.equal(pill("todo", "<to do>"), '<span class="pill is-todo">○ &lt;to do&gt;</span>');
});

test("a progress bar fills to the share done, says the count, and reads to a screen reader", () => {
  const bar = progressBar(3, 4, "tasks");
  assert.match(bar, /<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="4" aria-valuenow="3" aria-label="3 of 4 tasks done">/);
  assert.match(bar, /<span class="fill" style="width:75%"><\/span>/);
  assert.ok(bar.includes("3 of 4 tasks done"));
  assert.match(progressBar(0, 0, "tasks"), /style="width:0%"/, "nothing to do fills nothing");
  assert.match(progressBar(1, 3, "steps"), /style="width:33%"/, "rounded to a whole percent");
});

test("a slider steps through frames with no script: one radio per frame, the last chosen, a dot per frame, each frame with its own step buttons", () => {
  const html = slider({ id: "steps", label: "Steps", frames: [{ when: "0:00", state: "done", title: "one", html: "<p>one</p>" }, { when: "1:10", state: "failed", title: "two", html: "<p>two</p>" }, { when: "2:05", state: "todo", title: "<three>", html: "<p>three</p>" }] });
  assert.match(html, /^<div class="slider" role="group" aria-label="Steps">/);
  assert.equal(html.match(/<input type="radio" name="steps" id="steps-\d" class="pick"[^>]*>/g).length, 3);
  assert.ok(html.includes('<input type="radio" name="steps" id="steps-2" class="pick" checked>'), "the last frame shows first");
  assert.ok(html.includes('<label for="steps-1" class="dot is-failed" title="two">2</label>'), "a dot per frame, in the frame's state");
  assert.ok(html.includes('title="&lt;three&gt;"'), "a title is escaped");
  assert.ok(html.includes('<div class="frame"><p class="nav"><label for="steps-0" class="step" aria-label="Previous">◀</label><span class="when">2 of 3 · 1:10</span><label for="steps-2" class="step" aria-label="Next">▶</label></p><p>two</p></div>'), "each frame steps to its neighbours");
  assert.ok(!/<script/.test(html), "no script: the pages stay script-free where they must");
});

test("the stylesheet shows the chosen frame and lights its dot, for every frame up to the bound", () => {
  assert.match(PAGE_CSS, /\.slider>input:nth-of-type\(1\):checked~div:nth-of-type\(1\)/);
  assert.match(PAGE_CSS, new RegExp(`\\.slider>input:nth-of-type\\(${SLIDER_FRAMES}\\):checked~nav label:nth-of-type\\(${SLIDER_FRAMES}\\)`));
});

test("a slider keeps the last frames up to its bound and says how many came before; one frame or none draws no slider", () => {
  const frames = Array.from({ length: SLIDER_FRAMES + 5 }, (_, n) => ({ when: `${n}`, state: "done", title: `f${n}`, html: `<p>f${n}</p>` }));
  const html = slider({ id: "s", label: "Steps", frames });
  assert.equal(html.match(/class="pick"/g).length, SLIDER_FRAMES);
  assert.ok(html.includes("<p>f5</p>") && !html.includes("<p>f4</p>"), "the last ones are kept");
  assert.ok(html.includes('<p class="muted">5 earlier not shown</p>'));
  assert.equal(slider({ id: "s", label: "Steps", frames: [frames[0]] }), "<p>f0</p>", "one frame is drawn as it is");
  assert.equal(slider({ id: "s", label: "Steps", frames: [] }), "");
});

test("a slider can open on a chosen frame instead of the last", () => {
  const frames = ["a", "b", "c"].map((title) => ({ when: "", state: "done", title, html: `<p>${title}</p>` }));
  const html = slider({ id: "s", label: "Steps", frames, chosen: 1 });
  assert.ok(html.includes('id="s-1" class="pick" checked>'));
  assert.equal(html.match(/ checked>/g).length, 1);
});
