// Scenario report-content: a pure render function turns a recorded run into one self-contained HTML string (R5-3).
// Each test asserts on the report rendered from a recorded fixture (probe-2 shape) or from a partial or hostile variant of it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { readFile } from "node:fs/promises";
import { graphFor } from "../../shared-node/stage-graph.mjs";
import { plainName } from "../../shared-node/plain-names.mjs";
import { renderReport } from "../../shared-node/report.mjs";
import { RECORDED_STOP, recordedReportInput, headerOf, sectionOf, cardsOf, rowsOf, noteOf } from "./report-fixture.mjs";

describe("report-content", () => {
  test("report-header-states-task-outcome-and-time", async () => {
    const stopped = headerOf(renderReport(await recordedReportInput("probe-2", { outcome: "stopped" })));
    const done = headerOf(renderReport(await recordedReportInput("probe-2", { outcome: "done" })));

    assert.ok(stopped.includes("Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90"), "the header shows the task text");
    assert.ok(stopped.includes("STOPPED"), "a stopped run carries the STOPPED badge");
    assert.ok(!stopped.includes("DONE"), "a stopped run does not say DONE");
    assert.ok(stopped.includes("bug fix"), "the header names the task type in plain words");
    assert.ok(stopped.includes("2:36"), "the header shows the elapsed time from the recording (156s)");
    assert.ok(done.includes("DONE"), "a finished run carries the DONE badge");
    assert.ok(!done.includes("STOPPED"), "a finished run does not say STOPPED");
  });

  test("report-at-a-glance-has-five-answers", async () => {
    const section = sectionOf(renderReport(await recordedReportInput("probe-2", { outcome: "stopped" })), "AT A GLANCE");

    assert.match(section, /<strong>Where it stopped<\/strong>\s*stopped: a step kept failing/);
    assert.match(section, /<strong>Spent<\/strong>\s*18 agents · 2:36 · tokens unknown · % of plan unknown/);
    assert.match(section, /<strong>Left<\/strong>\s*unknown/);
    assert.match(section, /<strong>Looping<\/strong>\s*yes: 3 tries at the same step/);
    assert.match(section, /<strong>Off track<\/strong>\s*unknown/);
  });

  const readStagesContract = async () => JSON.parse(await readFile(new URL("../../contracts/stages.json", import.meta.url), "utf8"));

  const WHAT_YOU_CAN_DO = "report-what-you-can-do-follows-the-run-state";

  test(`${WHAT_YOU_CAN_DO}: stopped lists the re-run step`, async () => {
    const section = sectionOf(renderReport(await recordedReportInput("probe-2", { outcome: "stopped" })), "WHAT YOU CAN DO");

    assert.ok(section.includes("1. Re-run /pairingbuddy:code. It continues from test 2 and keeps test 1 and its commits."), "a stopped run offers the re-run step from R5-3");
    assert.ok(!section.includes("sign-off"), "a stopped run does not ask for a sign-off");
  });

  test(`${WHAT_YOU_CAN_DO}: done lists the sign-off step`, async () => {
    const section = sectionOf(renderReport(await recordedReportInput("probe-2", { outcome: "done" })), "WHAT YOU CAN DO");

    assert.ok(section.includes("1. Review the result and give your sign-off."), "a finished run lists the sign-off step");
    assert.doesNotMatch(section, /re-run/i, "a finished run does not offer a re-run");
  });

  // The probe-2 recording holds, per try: the step (RED/GREEN), the try number, the seconds of the writing agent and of the
  // runner. It holds no exit code, no result and no commit (ledger.tests is empty), so those cells must read "unknown".
  test("report-lists-every-try-of-every-test", async () => {
    const cards = cardsOf(renderReport(await recordedReportInput("probe-2", { outcome: "stopped" })));

    assert.equal(cards.length, 2, "the run touched 2 tests, so 2 cards");
    const [first, second] = cards;
    assert.ok(first.includes("ten-percent-off-hundred"), "the first card names the first test by its id");
    assert.ok(second.includes("zero-percent-keeps-full-price"), "the second card names the second test by its id");
    // step, try, time, writing time, running time, result with exit code, commit
    assert.deepEqual(rowsOf(first), [
      ["RED", "1", "0:11", "0:07", "0:03", "unknown", "unknown"],
      ["GREEN", "1", "0:11", "0:07", "0:03", "unknown", "unknown"],
    ], "the first test has one RED and one GREEN try, with no result or commit recorded");
    assert.deepEqual(rowsOf(second), [
      ["RED", "1", "0:13", "0:10", "0:03", "unknown", "unknown"],
      ["RED", "2", "0:11", "0:08", "0:02", "unknown", "unknown"],
      ["RED", "3", "0:11", "0:08", "0:02", "unknown", "unknown"],
    ], "the second test has three RED tries, with no result or commit recorded");
  });

  // The result source is ledger.tests.perTest[id].{red,green}: one record per step, the latest try (see stage-run.mjs and the
  // header of pb-red-green.test.mjs). A record's `passed` says the step was met: for RED that the test failed as it should.
  // So a record describes the LATEST try of its step; earlier tries of that step stay "unknown", as the source says nothing about them.
  // The probe-2 recording has tests: {}, so each test below writes its own perTest, visible here.
  const WORDING = "report-test-result-wording";
  const SELECTOR = { runner_id: "node", test_file: "tests/js/discount.test.mjs" };
  const record = (fields) => ({ stage: "code-tdd", attempt: 1, done: false, timedOut: false, excerpt: "", head: "abc1234", sha: null, ...fields });
  const RESULT_COLUMN = 5;

  async function withPerTest(perTest) {
    const input = await recordedReportInput("probe-2", { outcome: "stopped" });
    return renderReport({ ...input, ledger: { ...input.ledger, tests: { ...input.ledger.tests, perTest } } });
  }
  const resultsOf = (card) => rowsOf(card).map((cells) => cells[RESULT_COLUMN]);

  test(`${WORDING}: a RED that failed reads 'failed, as it should'`, async () => {
    const html = await withPerTest({
      "ten-percent-off-hundred": {
        selector: { ...SELECTOR, test_function: "ten-percent-off-hundred" },
        red: record({ passed: true, done: true, exitCodes: [1] }),
      },
    });

    const [red] = rowsOf(cardsOf(html)[0]);

    assert.equal(red[0], "RED", "the first row is the RED try");
    assert.equal(red[RESULT_COLUMN], "failed, as it should (exit 1)");
  });

  test(`${WORDING}: a GREEN that passed reads 'passed'`, async () => {
    const html = await withPerTest({
      "ten-percent-off-hundred": {
        selector: { ...SELECTOR, test_function: "ten-percent-off-hundred" },
        red: record({ passed: true, done: true, exitCodes: [1] }),
        green: record({ passed: true, done: true, exitCodes: [0] }),
      },
    });

    const [, green] = rowsOf(cardsOf(html)[0]);

    assert.equal(green[0], "GREEN", "the second row is the GREEN try");
    assert.equal(green[RESULT_COLUMN], "passed (exit 0)");
  });

  test(`${WORDING}: a RED that passed at once reads 'passed straight away, refused' on the latest try only`, async () => {
    const html = await withPerTest({
      "zero-percent-keeps-full-price": {
        selector: { ...SELECTOR, test_function: "zero-percent-keeps-full-price" },
        red: record({ passed: false, done: false, exitCodes: [0] }),
      },
    });

    const results = resultsOf(cardsOf(html)[1]);

    assert.equal(results.length, 3, "the test has 3 RED tries");
    assert.ok(results[2].includes("passed straight away, refused"), `the latest RED try reads passed straight away, refused, got: ${results[2]}`);
    assert.deepEqual(results.slice(0, 2), ["unknown", "unknown"], "the record covers the latest try only, so the earlier tries stay unknown");
  });

  test(`${WORDING}: a test that never ran is marked as not reached`, async () => {
    const html = await withPerTest({
      "never-ran-test": { selector: { ...SELECTOR, test_function: "never-ran-test" } },
    });

    const card = cardsOf(html).find((candidate) => candidate.includes("never-ran-test"));

    assert.ok(card, "a test that is in the ledger but never ran still gets a card");
    assert.ok(card.includes("not reached"), "its card says not reached");
    assert.deepEqual(rowsOf(card), [], "it has no try rows, since it had no tries");
  });

  // R5-3: the looping test's card ends with a 'Why it looped' note that says why RED was refused, how many tries it took, and the stop.
  test("report-explains-why-a-test-looped", async () => {
    const cards = cardsOf(renderReport(await recordedReportInput("probe-2", { outcome: "stopped" })));
    const calm = cards.find((card) => card.includes("ten-percent-off-hundred"));
    const looping = cards.find((card) => card.includes("zero-percent-keeps-full-price"));

    assert.ok(calm, "the calm test has a card");
    assert.ok(looping, "the looping test has a card");
    const note = noteOf(looping);
    assert.ok(note.includes("RED must start from a test that fails"), "the note says why RED was refused");
    assert.match(note, /third refused try/, "the note names the repeat count, 3 RED tries in the recording");
    assert.ok(note.includes("a step kept failing"), "the note names the stop in the plain wording of its code");
    assert.ok(!note.includes(RECORDED_STOP.code), "the note does not show the raw stop code");
    assert.ok(!calm.includes("Why it looped"), "a test that did not loop has no note");
  });

  // The probe-2 recording's stages[] holds no startedAt or end, so the times are written here as literals. The run began at the
  // first stage's start; times are shown from there. A stage the recording lacks a time for shows "unknown".
  test("report-steps-with-times", async () => {
    const input = await recordedReportInput("probe-2", { outcome: "stopped" });
    const stages = [
      { name: "code-scenarios", status: "done", attempt: 1, startedAt: "2026-11-03T02:16:08.000Z", end: "2026-11-03T02:16:26.000Z" },
      { name: "code-tdd", status: "failed", attempt: 1, startedAt: "2026-11-03T02:16:26.000Z" },
    ];
    const graph = graphFor(await readStagesContract(), "bug_fix").stages;
    assert.deepEqual(graph, ["code-scenarios", "code-tdd", "code-safety-net"], "the bug fix graph order the report must follow");

    const report = renderReport({ ...input, ledger: { ...input.ledger, taskType: "bug_fix", stages } });
    const section = sectionOf(report, "STEPS");
    const rows = rowsOf(section);

    assert.deepEqual(rows.map(([name]) => name), graph.map(plainName), "one row per stage in graph order, named in plain words");
    assert.deepEqual(rows[0], ["write scenarios", "0:00", "0:18", "0:18"], "a finished stage shows start, end and duration");
    assert.deepEqual(rows[1], ["build test by test", "0:18", "unknown", "unknown"], "a stage with no recorded end shows unknown for end and duration");
    assert.deepEqual(rows[2], [plainName("code-safety-net"), "not reached", "", ""], "a stage after the stop is marked not reached");
    assert.deepEqual(graph.filter((id) => section.includes(id)), [], "the section shows no stage ids");
  });

  // renderReport is pure: the mod reads git ($.process.run) and passes the result in as `commits`, a list of { sha, subject } in
  // run order, or null when the git call failed. That read is tested on the mod side (open-report).
  const COMMITS = "report-commits-from-git";
  const FULL_SHA = "3f2a9c1d8e7b6a5f4c3d2e1f0a9b8c7d6e5f4a3b";
  const OTHER_SHA = "b81e0d47c9a2f6e5d4c3b2a1908f7e6d5c4b3a29";
  const itemsOf = (section) => [...section.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, item]) => item.trim());

  test(`${COMMITS}: each commit shows its short hash and subject, in run order`, async () => {
    const input = await recordedReportInput("probe-2", { outcome: "stopped" });
    const commits = [
      { sha: FULL_SHA, subject: "test: ten percent off a hundred" },
      { sha: OTHER_SHA, subject: "fix: apply the discount" },
    ];

    const section = sectionOf(renderReport({ ...input, commits }), "COMMITS");
    const items = itemsOf(section);

    assert.equal(items.length, 2, "one entry per commit");
    assert.ok(items[0].includes(FULL_SHA.slice(0, 7)), "the first entry shows the short hash");
    assert.ok(!items[0].includes(FULL_SHA), "the hash is shortened, not shown in full");
    assert.ok(items[0].includes("test: ten percent off a hundred"), "the first entry shows the subject");
    assert.ok(items[1].includes(OTHER_SHA.slice(0, 7)), "the second entry shows the short hash");
    assert.ok(items[1].includes("fix: apply the discount"), "the second entry shows the subject");
  });

  test(`${COMMITS}: a failed git read leaves the section unknown and the report intact`, async () => {
    const input = await recordedReportInput("probe-2", { outcome: "stopped" });

    const html = renderReport({ ...input, commits: null });
    const section = sectionOf(html, "COMMITS");

    assert.deepEqual(itemsOf(section), [], "no commit entries are invented");
    assert.ok(section.includes("unknown"), "the section says the commits are unknown");
    assert.match(sectionOf(html, "AT A GLANCE"), /<strong>Where it stopped<\/strong>/, "the rest of the report still renders");
  });

  // Every recorded string the report prints: the task text, a test id and a commit subject. (A stop prints the plain name of its
  // code, never the recorded reason text, so it carries no recorded string.) Each is injected hostile and must come out escaped.
  const HOSTILE = `<script>alert("x")</script> & 'q'`;
  const ESCAPED = "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;";
  const ESCAPING = "report-escapes-recorded-text";

  const RECORDED_TEXT_SOURCES = {
    "task text": {
      render: async () => {
        const input = await recordedReportInput("probe-2", { outcome: "stopped" });
        return renderReport({ ...input, ledger: { ...input.ledger, task: HOSTILE } });
      },
      where: (html) => headerOf(html),
    },
    "test id": {
      render: () => withPerTest({ [HOSTILE]: { selector: { ...SELECTOR, test_function: HOSTILE } } }),
      where: (html) => sectionOf(html, "TESTS"),
    },
    "commit subject": {
      render: async () => {
        const input = await recordedReportInput("probe-2", { outcome: "stopped" });
        return renderReport({ ...input, commits: [{ sha: FULL_SHA, subject: HOSTILE }] });
      },
      where: (html) => sectionOf(html, "COMMITS"),
    },
  };

  for (const [source, { render, where }] of Object.entries(RECORDED_TEXT_SOURCES)) {
    test(`${ESCAPING}: the ${source} appears escaped`, async () => {
      const html = await render();

      const shown = where(html);

      assert.ok(shown.includes(ESCAPED), `the ${source} shows in its escaped form`);
      assert.ok(!html.includes("<script>"), `the raw script tag from the ${source} is absent from the whole report`);
    });
  }

  // An empty or partial recording must still give a whole page: every section present, every missing value worded as unknown.
  const SECTIONS = ["AT A GLANCE", "STEPS", "TESTS", "COMMITS", "WHAT YOU CAN DO"];
  const PARTIAL_RUNS = {
    "an empty object": {},
    "a null ledger": { ledger: null },
    "a ledger with no stages, tests or spend": { ledger: {} },
    "a ledger with a task but no spawns and no timing": { ledger: { task: "Fix a bug", taskType: "bug_fix" } },
    "a ledger with empty stages and tests, and no spawns or timing": { ledger: { stages: [], tests: {} }, spawns: [], timing: null },
  };

  for (const [name, input] of Object.entries(PARTIAL_RUNS)) {
    test(`report-tolerates-partial-run: ${name} renders a page with unknown values`, () => {
      const html = renderReport(input);

      assert.equal(typeof html, "string", "the report is a string");
      assert.match(html, /^<!doctype html>/i, "the report is a whole page");
      assert.match(html, /<\/html>\s*$/, "the page is closed");
      for (const title of SECTIONS) {
        assert.doesNotThrow(() => sectionOf(html, title), `the page has the ${title} section`);
      }
      const glance = sectionOf(html, "AT A GLANCE");
      assert.match(glance, /<strong>Where it is<\/strong>\s*unknown/, "where the run is reads unknown");
      assert.match(glance, /<strong>Spent<\/strong>[^<]*time unknown · tokens unknown · % of plan unknown/, "the spend reads unknown for time, tokens and plan");
      assert.match(glance, /<strong>Looping<\/strong>\s*unknown/, "looping reads unknown");
      assert.match(headerOf(html), /time unknown/, "the header says the time is unknown");
      assert.match(sectionOf(html, "COMMITS"), /<p>unknown<\/p>/, "the commits section says unknown when no commits were passed");
      assert.ok(!/undefined|NaN|\[object Object\]/.test(html), "no raw undefined, NaN or object leaks into the page");
    });
  }

  // R5-3 and DIRECTION ask for one self-contained page: inline CSS, no network. Neither calls for a dark-mode rule (R5-3 is a
  // single dark design, with no light/dark switch), so no prefers-color-scheme assertion is made.
  test("report-is-self-contained", async () => {
    const html = renderReport({ ...(await recordedReportInput("probe-2", { outcome: "stopped" })), commits: [{ sha: FULL_SHA, subject: "test: ten percent off a hundred" }] });

    assert.doesNotMatch(html, /https?:\/\//i, "the page names no http(s) URL");
    assert.doesNotMatch(html, /\bsrc\s*=/i, "the page has no src attribute");
    assert.doesNotMatch(html, /\bhref\s*=/i, "the page has no href attribute");
    assert.doesNotMatch(html, /<script/i, "the page has no script tag");
    assert.doesNotMatch(html, /<link/i, "the page has no link tag");
    assert.doesNotMatch(html, /<img/i, "the page has no img tag");
    assert.doesNotMatch(html, /@import/i, "the page imports no stylesheet");
    assert.doesNotMatch(html, /url\s*\(/i, "the CSS loads no url() resource");
    assert.match(html, /<style[^>]*>[\s\S]*?<\/style>/i, "the CSS is inline, in a style block");
    assert.ok(html.includes("nothing loaded from the network"), "the footer says nothing is loaded from the network");
  });

  const EXTRA = "report-test-result-wording-extra";
  const ZERO = "zero-percent-keeps-full-price";
  const latestResult = async (entry) => {
    const html = await withPerTest({ [ZERO]: { selector: { ...SELECTOR, test_function: ZERO }, ...entry } });
    const zeroCard = cardsOf(html).find((card) => card.includes(ZERO));
    return resultsOf(zeroCard).at(-1);
  };

  test(`${EXTRA}: a step that timed out reads 'timed out'`, async () => {
    const result = await latestResult({ red: record({ passed: false, timedOut: true, exitCodes: [null] }) });

    assert.ok(result.includes("timed out"), `the latest RED try reads timed out, got: ${result}`);
    assert.ok(!result.includes("passed straight away"), `a timeout is not a pass, got: ${result}`);
  });

  test(`${EXTRA}: a RED that passed with a covered record reads as already covered`, async () => {
    const covered = record({ passed: true, done: true, exitCodes: [0] });
    const result = await latestResult({ red: record({ passed: false, exitCodes: [0] }), covered });

    assert.ok(result.includes("already covered"), `the RED try reads already covered, got: ${result}`);
    assert.ok(!result.includes("refused"), `a covered test is not refused, got: ${result}`);
  });

  test(`${EXTRA}: an unmet RED with a non-plan non-zero exit does not read 'passed straight away'`, async () => {
    const result = await latestResult({ red: record({ passed: false, exitCodes: [2] }) });

    assert.ok(!result.includes("passed straight away"), `exit 2 is a failure, not a pass, got: ${result}`);
    assert.ok(result.includes("exit 2"), `the exit code stays visible, got: ${result}`);
  });

  test("report-uses-tests-input-for-left-and-test-n-of-m", async () => {
    const tests = ["ten-percent-off-hundred", "zero-percent-keeps-full-price", "negative-percent-is-refused", "over-hundred-percent-is-refused"];
    const input = await recordedReportInput("probe-2", { outcome: "running" });

    const glanceSection = sectionOf(renderReport({ ...input, tests }), "AT A GLANCE");

    assert.match(glanceSection, /<strong>Where it is<\/strong>[^<]*test 2 of 4/, "the step line reads 'test 2 of 4' from the tests passed in");
    assert.match(glanceSection, /<strong>Left<\/strong>\s*2 more tests(?:, then [^<]*)?</, "the LEFT row is the count of tests after the current one, not their ids");
  });

  // The plan's tests list is the source of truth for numbering. Here the plan lists the current test third, while the run spawned
  // it second (the plan's second test was never spawned), so a number taken from first-spawn order would be 2, not 3.
  test("report-numbers-each-test-the-same-everywhere", async () => {
    const CURRENT = "zero-percent-keeps-full-price";
    const tests = ["ten-percent-off-hundred", "negative-percent-is-refused", CURRENT];
    // A stopped run shows the stop in AT A GLANCE instead of "test N of M", so the glance is read from the same run while it is going.
    const running = await recordedReportInput("probe-2", { outcome: "running" });
    const input = await recordedReportInput("probe-2", { outcome: "stopped" });

    const html = renderReport({ ...input, tests });
    const glance = sectionOf(renderReport({ ...running, tests }), "AT A GLANCE");
    const rerun = sectionOf(html, "WHAT YOU CAN DO");
    const card = cardsOf(html).find((candidate) => candidate.includes(CURRENT));

    assert.ok(card, "the current test has a card");
    assert.match(glance, /test 3 of 3/, "AT A GLANCE numbers the current test 3 by the plan's list");
    assert.ok(rerun.includes("continues from test 3"), "the rerun step numbers the current test 3, as AT A GLANCE does");
    assert.match(card, /test 3\b/i, "the TESTS card numbers the current test 3, as AT A GLANCE does");
  });
});
