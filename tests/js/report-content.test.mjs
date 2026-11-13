// Scenario report-content: a pure render function turns a recorded run into one self-contained HTML string (R5-3).
// Each test asserts on the report rendered from a recorded fixture (probe-2 shape) or from a partial or hostile variant of it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { readFile } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lensRow, writeCleanLensReturn } from "./lens-return-fixture.mjs";
import { buildReport } from "../../shared-node/stage-run.mjs";
import { graphFor } from "../../shared-node/stage-graph.mjs";
import { plainName } from "../../shared-node/plain-names.mjs";
import { renderReport } from "../../shared-node/report.mjs";
import { glance } from "../../shared-node/glance.mjs";
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
  // runner. It holds no exit code, no result and no commit (ledger.tests is empty), so the result cell reads "unknown" and the
  // Commit column, unknown on every row, is dropped from the card (test-card-drops-column-unknown-for-every-row).
  test("report-lists-every-try-of-every-test", async () => {
    const cards = cardsOf(renderReport(await recordedReportInput("probe-2", { outcome: "stopped" })));

    assert.equal(cards.length, 2, "the run touched 2 tests, so 2 cards");
    const [first, second] = cards;
    assert.ok(first.includes("ten-percent-off-hundred"), "the first card names the first test by its id");
    assert.ok(second.includes("zero-percent-keeps-full-price"), "the second card names the second test by its id");
    // step, try, time, writing time, running time, result with exit code (the cells match the card's headings; no Commit)
    assert.deepEqual(rowsOf(first), [
      ["RED", "1", "0:11", "0:07", "0:03", "unknown"],
      ["GREEN", "1", "0:11", "0:07", "0:03", "unknown"],
    ], "the first test has one RED and one GREEN try, with no result recorded");
    assert.deepEqual(rowsOf(second), [
      ["RED", "1", "0:13", "0:10", "0:03", "unknown"],
      ["RED", "2", "0:11", "0:08", "0:02", "unknown"],
      ["RED", "3", "0:11", "0:08", "0:02", "unknown"],
    ], "the second test has three RED tries, with no result recorded");
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
      { name: "intake", status: "done", attempt: 1, startedAt: "2026-11-03T02:16:08.000Z", end: "2026-11-03T02:16:08.000Z" },
      { name: "code-scenarios", status: "done", attempt: 1, startedAt: "2026-11-03T02:16:08.000Z", end: "2026-11-03T02:16:26.000Z" },
      { name: "code-tdd", status: "failed", attempt: 1, startedAt: "2026-11-03T02:16:26.000Z" },
    ];
    const graph = graphFor(await readStagesContract(), "bug_fix").stages;
    assert.deepEqual(graph, ["intake", "code-scenarios", "code-tdd", "code-safety-net"], "the bug fix graph order the report must follow");

    const report = renderReport({ ...input, ledger: { ...input.ledger, taskType: "bug_fix", stages } });
    const section = sectionOf(report, "STEPS");
    const rows = rowsOf(section);

    assert.deepEqual(rows.map(([name]) => name), graph.map(plainName), "one row per stage in graph order, named in plain words");
    assert.deepEqual(rows[1], ["write scenarios", "0:00", "0:18", "0:18"], "a finished stage shows start, end and duration");
    assert.deepEqual(rows[2], ["build test by test", "0:18", "unknown", "unknown"], "a stage with no recorded end shows unknown for end and duration");
    assert.deepEqual(rows[3], [plainName("code-safety-net"), "not reached", "", ""], "a stage after the stop is marked not reached");
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

    const glanceSection = sectionOf(renderReport({ ...input, tests, testsComplete: true }), "AT A GLANCE");

    assert.match(glanceSection, /<strong>Where it is<\/strong>[^<]*test 2 of 4/, "the step line reads 'test 2 of 4' from the tests passed in");
    assert.match(glanceSection, /<strong>Left<\/strong>\s*2 more tests(?:, then [^<]*)?</, "the LEFT row is the count of tests after the current one, not their ids");
  });

  test("report-claims-no-total-or-left-for-an-incomplete-tests-list", async () => {
    const tests = ["ten-percent-off-hundred", "zero-percent-keeps-full-price"];
    const input = await recordedReportInput("probe-2", { outcome: "running" });

    const incomplete = sectionOf(renderReport({ ...input, tests, testsComplete: false }), "AT A GLANCE");
    const omitted = sectionOf(renderReport({ ...input, tests }), "AT A GLANCE");

    for (const [name, section] of [["testsComplete false", incomplete], ["testsComplete omitted", omitted]]) {
      assert.doesNotMatch(section, /test \d+ of \d+/, `${name}: no "test N of M" total is shown`);
      assert.doesNotMatch(section, /\d+ more tests?/, `${name}: no count left is shown`);
    }
  });

  // The plan's tests list is the source of truth for numbering. Here the plan lists the current test third, while the run spawned
  // it second (the plan's second test was never spawned), so a number taken from first-spawn order would be 2, not 3.
  test("report-numbers-each-test-the-same-everywhere", async () => {
    const CURRENT = "zero-percent-keeps-full-price";
    const tests = ["ten-percent-off-hundred", "negative-percent-is-refused", CURRENT];
    // A stopped run shows the stop in AT A GLANCE instead of "test N of M", so the glance is read from the same run while it is going.
    const running = await recordedReportInput("probe-2", { outcome: "running" });
    const input = await recordedReportInput("probe-2", { outcome: "stopped" });

    const html = renderReport({ ...input, tests, testsComplete: true });
    const glance = sectionOf(renderReport({ ...running, tests, testsComplete: true }), "AT A GLANCE");
    const rerun = sectionOf(html, "WHAT YOU CAN DO");
    const card = cardsOf(html).find((candidate) => candidate.includes(CURRENT));

    assert.ok(card, "the current test has a card");
    assert.match(glance, /test 3 of 3/, "AT A GLANCE numbers the current test 3 by the plan's list");
    assert.ok(rerun.includes("continues from test 3"), "the rerun step numbers the current test 3, as AT A GLANCE does");
    assert.match(card, /test 3\b/i, "the TESTS card numbers the current test 3, as AT A GLANCE does");
  });
});

// Finding 13: a real healthy run (t59-healthy) ends with perTest holding red and green for a test whose spawns carry no labels the report can match.
const HEALTHY_ID = "apply-discount-100-by-10-returns-90";
const LEGACY_ID = "apply-discount-100-by-10-percent";
const healthyRecord = (exitCode) => ({ stage: "code-tdd", attempt: 1, done: true, passed: true, timedOut: false, excerpt: "", head: "abc1234", sha: null, exitCodes: [exitCode] });
const healthyPerTest = {
  [HEALTHY_ID]: {
    selector: { runner_id: "node", test_file: "tests/js/discount.test.mjs", test_function: HEALTHY_ID },
    red: healthyRecord(1),
    green: healthyRecord(0),
  },
};
const healthyReport = (tests) => renderReport({ ledger: { stage: { name: "code-tdd", status: "done" }, tests: { perTest: healthyPerTest } }, spawns: [], tests });
const cardFor = (html, id) => cardsOf(html).find((card) => card.includes(id));

test('ledger-result-shown-without-spawn-labels', async () => {
  const html = healthyReport([]);

  const card = cardFor(html, HEALTHY_ID);

  assert.ok(card, "the ledger test gets a card");
  assert.ok(card.includes("failed, as it should (exit 1)"), "the card shows the RED result from the ledger");
  assert.ok(card.includes("passed (exit 0)"), "the card shows the GREEN result from the ledger");
  assert.ok(!card.includes("not reached"), "a test with a ledger result is not marked not reached");
});

test('perTest-wins-over-disagreeing-legacy-list', async () => {
  const html = healthyReport([LEGACY_ID]);

  const legacyCard = cardFor(html, LEGACY_ID);

  assert.ok(cardFor(html, HEALTHY_ID)?.includes("passed (exit 0)"), "the perTest test shows its result");
  assert.ok(!legacyCard || !legacyCard.includes("not reached"), "the legacy-only id is not shown as not reached");
  assert.ok(!sectionOf(html, "TESTS").includes("not reached"), "no card in the report says not reached");
});

// The t59-healthy recording (a finished bug-fix run) holds, per stage in ledger.stages: name, status, attempt, startedAt and spend.
// It holds no end for a stage (no finishedAt or end field). Its timing snapshot holds { seconds, stageSeconds }. So the tests below
// add `end` to the stages themselves, visibly, and pass no timing, to prove the run time comes from the ledger's stage times.
const HEALTHY_RUN = new URL("../fixtures/recordings/t59-healthy/", import.meta.url);
const finishedLedger = async () => {
  const lines = (await readFile(new URL("ledger.jsonl", HEALTHY_RUN), "utf8")).trim().split("\n");
  return JSON.parse(lines.at(-1)).ledger;
};
const withEnds = (ledger, ends) => ({ ...ledger, stages: ledger.stages.map((stage, i) => ({ ...stage, end: ends[i] })) });
// First start 08:13:26.472; last end 08:15:06.472, so the run took exactly 100 seconds (1:40).
const ENDS = ["2026-11-04T08:13:42.543Z", "2026-11-04T08:14:38.797Z", "2026-11-04T08:15:06.472Z"];

test('run-time-derived-from-stage-times', async () => {
  const ledger = withEnds(await finishedLedger(), ENDS);
  const bare = await finishedLedger();

  const html = renderReport({ ledger, spawns: [] });
  const noTimes = renderReport({ ledger: { ...bare, stages: [] }, spawns: [] });

  assert.ok(headerOf(html).includes("1:40"), "the header shows the first start to the last end");
  assert.ok(!headerOf(html).includes("time unknown"), "the header does not say time unknown");
  assert.match(sectionOf(html, "AT A GLANCE"), /<strong>Spent<\/strong>\s*\d+ agents? · 1:40 ·/);
  const real = renderReport({ ledger: bare, spawns: [], endedAt: "2026-11-04T08:15:06.472Z" });
  const realNoEnd = renderReport({ ledger: bare, spawns: [] });
  assert.ok(headerOf(real).includes("1:40"), "real shape: the run time is endedAt minus the first startedAt");
  assert.match(sectionOf(real, "AT A GLANCE"), /<strong>Spent<\/strong>[^<]* · 1:40 ·/);
  assert.ok(headerOf(realNoEnd).includes("time unknown"), "real shape without endedAt stays unknown");
  assert.ok(headerOf(noTimes).includes("unknown"), "with no stage times and no timing the header stays unknown");
  assert.match(sectionOf(noTimes, "AT A GLANCE"), /<strong>Spent<\/strong>[^<]*unknown/);
});

const headersOf = (html) => [...sectionOf(html, "STEPS").matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(([, cell]) => cell.trim().toLowerCase());
const stepRows = (html) =>
  [...sectionOf(html, "STEPS").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map(([, row]) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => cell.trim()))
    .filter((cells) => cells.length > 0);

test('steps-columns-all-labelled', async () => {
  const full = renderReport({ ledger: withEnds(await finishedLedger(), ENDS), spawns: [] });
  const noEnds = renderReport({ ledger: await finishedLedger(), spawns: [] });

  assert.deepEqual(headersOf(full), ["step", "start", "end", "took"], "every column of the STEPS table is named");
  assert.deepEqual(headersOf(noEnds), ["step", "started"], "end and took have no source in the recording, so they are dropped");
  assert.ok(!sectionOf(noEnds, "STEPS").includes("unknown"), "real shape (startedAt only): no unlabelled unknown column");
  assert.ok(stepRows(noEnds).every((cells) => cells.length === 2), "each row has only the columns that are named");
  assert.ok(!sectionOf(noEnds, "STEPS").includes("unknown"), "no column reads unknown in every row");
});

test('where-it-is-reads-finished-on-done-run', async () => {
  const done = await finishedLedger();
  const running = { ...done, stage: { ...done.stage, status: "active" } };

  const doneGlance = sectionOf(renderReport({ ledger: done, spawns: [] }), "AT A GLANCE");
  const runningGlance = sectionOf(renderReport({ ledger: running, spawns: [] }), "AT A GLANCE");

  assert.match(doneGlance, /<strong>Where it is<\/strong>\s*finished/, "a done run reads finished");
  assert.ok(!doneGlance.includes("safety-net review"), "a done run no longer names the safety-net review");
  assert.match(runningGlance, /<strong>Where it is<\/strong>[^<]*safety-net review/, "a running ledger still names its step");
});

// Scenario report-what-you-can-do-for-finished-run (placeholders)
test("done-run-does-not-ask-for-sign-off", async () => {
  // The ledger shape `pb human approve G:task-end` leaves behind (recordApproval): the gate answered approve by the human, no pending gate, no stop.
  const recorded = await finishedLedger();
  const signedOff = {
    ...recorded,
    stage: { ...recorded.stage, status: "done" },
    needsHuman: null,
    stop: null,
    gates: { ...recorded.gates, "G:task-end": { source: "human-cli", answer: "approve" } },
  };

  const section = sectionOf(renderReport({ ledger: signedOff, spawns: [] }), "WHAT YOU CAN DO");

  assert.ok(!section.includes("Review the result and give your sign-off."), "a signed-off run does not tell the human to review and sign off");
  assert.ok(!/sign-?off/i.test(section), "a signed-off run does not ask for a sign-off in any words");
});

test("done-run-says-nothing-is-needed", async () => {
  const recorded = await finishedLedger();
  const signedOff = {
    ...recorded,
    stage: { ...recorded.stage, status: "done" },
    needsHuman: null,
    stop: null,
    gates: { ...recorded.gates, "G:task-end": { source: "human-cli", answer: "approve" } },
  };

  const section = sectionOf(renderReport({ ledger: signedOff, spawns: [] }), "WHAT YOU CAN DO");

  assert.match(section, /Nothing to do: the run is done\./, "a signed-off run says plainly that nothing is left to do");
});

test("done-run-still-awaiting-sign-off-asks-for-it", async () => {
  const recorded = await finishedLedger();
  const awaiting = {
    ...recorded,
    stage: { ...recorded.stage, status: "done" },
    needsHuman: { gate: "G:task-end" },
    stop: null,
    gates: {},
  };

  const section = sectionOf(renderReport({ ledger: awaiting, spawns: [] }), "WHAT YOU CAN DO");

  assert.match(section, /Review the result and give your sign-off\./, "a run still waiting on the task-end gate asks for the sign-off");
  assert.ok(!section.includes("Nothing to do: the run is done."), "a run that is not signed off never says nothing is left to do");
});

test("stopped-and-running-next-steps-unchanged", async () => {
  const stopped = sectionOf(renderReport(await recordedReportInput("probe-2", { outcome: "stopped" })), "WHAT YOU CAN DO");
  const running = sectionOf(renderReport(await recordedReportInput("probe-2", { outcome: "running" })), "WHAT YOU CAN DO");

  assert.ok(stopped.includes("1. Re-run /pairingbuddy:code. It continues from test 2 and keeps test 1 and its commits."), "a stopped run still shows the re-run guidance");
  assert.ok(running.includes("Nothing to do yet: the run is still going."), "a running run still says nothing is to be done yet");
  assert.ok(!running.includes("sign-off"), "a running run does not ask for a sign-off");
});

// Scenario report-test-card-column-headings (placeholders)
test("test-card-has-column-headings", async () => {
  const [card] = cardsOf(renderReport(await recordedReportInput("probe-2", { outcome: "stopped" })));

  const headings = [...card.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(([, cell]) => cell.trim());

  assert.deepEqual(headings.slice(0, 6), ["Step", "Try", "Total", "Writing", "Running", "Result"], "the card header row names the first six columns in cell order");
  assert.equal(headings.length, rowsOf(card)[0].length, "every cell of a try row has a heading above it");
});

test("test-card-drops-column-unknown-for-every-row", async () => {
  const headingsOf = (card) => [...card.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(([, cell]) => cell.trim());
  const isUnknown = (cell) => cell === "unknown" || cell === "time unknown";
  const input = await recordedReportInput("probe-2", { outcome: "stopped" });
  const untimed = { ...input, spawns: input.spawns.map((spawn) => ({ ...spawn, seconds: NaN })) };
  const [timed] = cardsOf(renderReport(input));
  const untimedCards = cardsOf(renderReport(untimed));

  assert.equal(rowsOf(timed).every((row) => row.at(-1) === "unknown"), true, "precondition: the last cell is unknown on every try row");
  assert.equal(headingsOf(timed).includes("Commit"), false, "the Commit heading is not drawn when its cell is unknown for every row");
  assert.equal(headingsOf(timed).length, rowsOf(timed)[0].length, "dropping the column removes its heading and its cells together");

  for (const card of untimedCards) {
    const rows = rowsOf(card);
    const headings = headingsOf(card);

    assert.equal(rows.every((row) => row.slice(2, 5).every(isUnknown)), true, "precondition: Total, Writing and Running are unknown on every try row");
    assert.deepEqual(headings.filter((name) => ["Total", "Writing", "Running", "Commit"].includes(name)), [], "no time or commit heading is drawn when its cells are unknown on every row");
    assert.ok(rows.every((row) => row.length === headings.length), "every try row has exactly one cell per heading");
  }
});

test("test-card-keeps-column-with-some-known-values", async () => {
  const headingsOf = (card) => [...card.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(([, cell]) => cell.trim());
  const input = await recordedReportInput("probe-2", { outcome: "stopped" });
  // Only the runner agent of the first RED try of the first test loses its time; every other try keeps it.
  const runnerOfFirstTry = input.spawns.findIndex((spawn) => spawn.name === "pb1 code-tdd RED runner ten-percent-off-hundred r1");
  const partial = { ...input, spawns: input.spawns.map((spawn, i) => (i === runnerOfFirstTry ? { ...spawn, seconds: NaN } : spawn)) };

  const [card] = cardsOf(renderReport(partial));
  const rows = rowsOf(card);
  const headings = headingsOf(card);
  const running = headings.indexOf("Running");

  assert.ok(runnerOfFirstTry >= 0, "precondition: the recorded runner spawn is found");
  assert.ok(running >= 0, "the Running heading is kept when at least one row has a known value");
  assert.equal(rows[0][running], "time unknown", "the row that lacks the value reads unknown");
  assert.equal(rows[1][running], "0:03", "the row that has the value keeps it");
  assert.ok(rows.every((row) => row.length === headings.length), "every try row still has exactly one cell per heading");
});

test("test-card-headings-on-every-card", async () => {
  const headingsOf = (card) => [...card.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(([, cell]) => cell.trim());
  const input = await recordedReportInput("probe-2", { outcome: "stopped" });
  const untimed = { ...input, spawns: input.spawns.map((spawn) => ({ ...spawn, seconds: NaN })) };
  const timedCards = cardsOf(renderReport(input));
  const untimedCards = cardsOf(renderReport(untimed));

  assert.ok(timedCards.length > 1, "precondition: the run has several tests, so several cards");
  assert.ok(timedCards.some((card) => rowsOf(card).length > 1), "precondition: at least one card looped, with several try rows");

  for (const card of [...timedCards, ...untimedCards]) {
    const headings = headingsOf(card);

    assert.ok(headings.length > 0, "every card carries its own header row");
    assert.deepEqual(headings.slice(0, 2), ["Step", "Try"], "every card header starts with Step and Try");
    assert.ok(headings.includes("Result"), "every card header names the Result column");
    assert.ok(rowsOf(card).every((row) => row.length === headings.length), "every try row has one cell per heading of its own card");
  }
});

test("test-card-headings-escape-and-not-reached-card", async () => {
  const HOSTILE = `<script>alert("x")</script> & 'q'`;
  const input = await recordedReportInput("probe-2", { outcome: "stopped" });
  const perTest = {
    ...input.ledger.tests?.perTest,
    "never-ran-test": { selector: { runner_id: "node", test_file: "tests/js/discount.test.mjs", test_function: "never-ran-test" } },
    [HOSTILE]: { selector: { runner_id: "node", test_file: "tests/js/discount.test.mjs", test_function: HOSTILE } },
  };
  const html = renderReport({ ...input, ledger: { ...input.ledger, tests: { ...input.ledger.tests, perTest } } });

  const notReached = cardsOf(html).filter((card) => card.includes("not reached"));

  assert.ok(notReached.length >= 2, "precondition: the tests that never ran each get a card saying not reached");
  assert.ok(notReached.some((card) => card.includes("never-ran-test")), "precondition: the plain never-ran test has its card");
  for (const card of notReached) {
    assert.deepEqual(rowsOf(card), [], "a not reached card has no try rows");
    assert.ok(!/<th[\s>]/.test(card), "a not reached card draws no column headings");
    assert.ok(!card.includes("<table"), "a not reached card draws no empty heading-only table");
  }
  assert.ok(!html.includes("<script>"), "the raw script tag from a test id is absent from the whole report");
});

// Scenario report-title-keeps-description-context-break (placeholders)
test("title-shows-break-between-description-and-context", () => {
  const task = ["Add a discount rule", "Context: orders over 100 get 10 percent off"].join("\n\n");

  const html = renderReport({ ledger: { task, stage: { name: "code-tdd", status: "done" } }, spawns: [] });

  const title = headerOf(html).match(/<h1>([\s\S]*?)<\/h1>/)[1];
  assert.ok(title.includes("Add a discount rule"), "precondition: the title holds the description");
  assert.ok(title.includes("Context: orders over 100 get 10 percent off"), "precondition: the title holds the context");
  assert.ok(/<br\s*\/?>|<\/(p|div|span)>\s*<(p|div|span)/.test(title), "the description and the context are separated by a break or by separate blocks inside the title");
  assert.ok(!title.includes("Add a discount rule Context"), "the description and the context are not run together");
});

test("title-single-paragraph-has-no-break", () => {
  const task = "Add a discount rule for orders over 100";

  const html = renderReport({ ledger: { task, stage: { name: "code-tdd", status: "done" } }, spawns: [] });

  const title = headerOf(html).match(/<h1>([\s\S]*?)<\/h1>/)[1];
  assert.ok(title.includes(task), "precondition: the title holds the whole task on one line");
  assert.ok(!/<br\s*\/?>/.test(title), "a task with no blank line has no break element in the title");
});

test("title-break-escapes-text", () => {
  const task = ["Fix <b>bold</b> & \"quoted\" rule", "Context: it's <script>alert(1)</script> & more"].join("\n\n");

  const html = renderReport({ ledger: { task, stage: { name: "code-tdd", status: "done" } }, spawns: [] });

  const title = headerOf(html).match(/<h1>([\s\S]*?)<\/h1>/)[1];
  assert.equal(
    title,
    "Fix &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; rule<br>Context: it&#39;s &lt;script&gt;alert(1)&lt;/script&gt; &amp; more",
    "both paragraphs are escaped and the break is the only markup in the title",
  );
  assert.ok(!html.includes("<script>"), "the raw script tag from the task is absent from the whole report");
});

test("title-missing-task-unchanged", () => {
  const withoutTask = { stage: { name: "code-tdd", status: "done" } };

  const html = renderReport({ ledger: withoutTask, spawns: [] });
  const htmlNullTask = renderReport({ ledger: { ...withoutTask, task: null }, spawns: [] });

  assert.match(html, /<h1><\/h1>/, "a ledger with no task renders an empty title");
  assert.ok(!html.includes("undefined") && !html.includes("<br>"), "the empty title shows no 'undefined' and no break");
  assert.match(htmlNullTask, /<h1><\/h1>/, "a null task renders an empty title too");
});

// Placeholders for scenario report-done-signoff-text (Finding 18b) and scenario live-report-measures-to-now (Finding 23).
// Each fails until the implementation lands. They never skip.

test("done-auto-passed-task-end-gate-says-nothing-to-do", async () => {
  // The record an auto-passed gate leaves behind: source "auto" and no answer.
  const recorded = await finishedLedger();
  const autoPassed = {
    ...recorded,
    stage: { ...recorded.stage, status: "done" },
    needsHuman: null,
    stop: null,
    gates: { ...recorded.gates, "G:task-end": { source: "auto" } },
  };

  const section = sectionOf(renderReport({ ledger: autoPassed, spawns: [] }), "WHAT YOU CAN DO");

  assert.match(section, /Nothing to do: the run is done\./, "an auto-passed run says plainly that nothing is left to do");
  assert.ok(!section.includes("Review the result and give your sign-off."), "an auto-passed run does not ask for a sign-off");
});

test("done-human-approved-task-end-gate-says-nothing-to-do", async () => {
  const recorded = await finishedLedger();
  const humanApproved = {
    ...recorded,
    stage: { ...recorded.stage, status: "done" },
    needsHuman: null,
    stop: null,
    gates: { ...recorded.gates, "G:task-end": { source: "human", answer: "approve" } },
  };

  const section = sectionOf(renderReport({ ledger: humanApproved, spawns: [] }), "WHAT YOU CAN DO");

  assert.match(section, /Nothing to do: the run is done\./, "a human-approved run says plainly that nothing is left to do");
  assert.ok(!section.includes("Review the result and give your sign-off."), "a human-approved run does not ask for a sign-off");
});

test("done-pending-task-end-gate-still-asks-for-signoff", async () => {
  const recorded = await finishedLedger();
  const finished = { ...recorded, stage: { ...recorded.stage, status: "done" }, stop: null };
  const noGateRecorded = { ...finished, needsHuman: null, gates: {} };
  const gateStillPending = { ...finished, needsHuman: { gate: "G:task-end" }, gates: { "G:task-end": { source: "auto" } } };

  const withoutGate = sectionOf(renderReport({ ledger: noGateRecorded, spawns: [] }), "WHAT YOU CAN DO");
  const withPendingGate = sectionOf(renderReport({ ledger: gateStillPending, spawns: [] }), "WHAT YOU CAN DO");

  assert.match(withoutGate, /Review the result and give your sign-off\./, "a finished run with no recorded task-end gate asks for the sign-off");
  assert.match(withPendingGate, /Review the result and give your sign-off\./, "a finished run whose task-end gate is still pending asks for the sign-off");
  assert.ok(!withoutGate.includes("Nothing to do: the run is done.") && !withPendingGate.includes("Nothing to do: the run is done."), "neither run says nothing is left to do");
});

test("live-report-header-and-spent-show-elapsed-to-now", () => {
  const START = "2026-11-04T08:13:26.000Z";
  const now = Date.parse(START) + 51_000;
  const ledger = { task: "Fix the bug", taskType: "bug-fix", stage: { name: "code-tdd", status: "active", startedAt: START }, stages: [{ name: "code-tdd", status: "active", startedAt: START }] };
  const input = { ledger, spawns: [], now };

  const html = renderReport(input);

  assert.ok(headerOf(html).includes("0:51"), "the header shows the elapsed time from the first start to now");
  assert.ok(!headerOf(html).includes("time unknown"), "the header does not say time unknown");
  assert.match(sectionOf(html, "AT A GLANCE"), /<strong>Spent<\/strong>[^<]* · 0:51 ·/, "SPENT shows the same elapsed time");
  assert.ok(!sectionOf(html, "AT A GLANCE").includes("time unknown"), "SPENT does not say time unknown");
  assert.ok(glance({ ledger, spawns: [], now }).rows.spent.includes(" · 0:51 · "), "the pane shows the same elapsed text for the same ledger and now");
});

test("live-report-with-no-start-stays-unknown", () => {
  const now = Date.parse("2026-11-04T08:14:17.000Z");
  const ledger = { task: "Fix the bug", taskType: "bug-fix", stage: { name: "code-tdd", status: "active" }, stages: [{ name: "code-tdd", status: "active" }] };

  const html = renderReport({ ledger, spawns: [], now });

  assert.ok(headerOf(html).includes("time unknown"), "the header says time unknown when the run has no recorded start");
  assert.match(sectionOf(html, "AT A GLANCE"), /<strong>Spent<\/strong>[^<]* · (time )?unknown ·/, "SPENT says unknown for the time");
  assert.ok(!html.includes("NaN"), "no NaN leaks into the report");
});

test("finished-report-still-measures-to-end-not-now", () => {
  const START = "2026-11-04T08:13:26.000Z";
  const laterNow = Date.parse(START) + 3_600_000;
  const running = { name: "code-tdd", status: "active", startedAt: START };
  const withEndedAt = { task: "Fix the bug", taskType: "bug-fix", stage: running, stages: [running] };
  const finishedStage = { name: "code-tdd", status: "done", startedAt: START, end: new Date(Date.parse(START) + 51_000).toISOString() };
  const withStageEnd = { task: "Fix the bug", taskType: "bug-fix", stage: finishedStage, stages: [finishedStage] };

  const byEndedAt = renderReport({ ledger: withEndedAt, spawns: [], endedAt: new Date(Date.parse(START) + 51_000).toISOString(), now: laterNow });
  const byStageEnd = renderReport({ ledger: withStageEnd, spawns: [], now: laterNow });

  assert.ok(headerOf(byEndedAt).includes("0:51"), "a run with endedAt shows its recorded length");
  assert.ok(!headerOf(byEndedAt).includes("1:00:00"), "a run with endedAt is not stretched to the later now");
  assert.ok(headerOf(byStageEnd).includes("0:51"), "a run with a stage end shows the length to the last stage end");
  assert.ok(!headerOf(byStageEnd).includes("1:00:00"), "a run with a stage end is not stretched to the later now");
});

// Scenario report-in-progress-step-start-time (Finding 26). Placeholders: fail until implemented.
test("in-progress-stage-shows-start-time", async () => {
  // The real running shape: the active stage is only in ledger.stage (with startedAt); ledger.stages holds the closed ones.
  const recorded = await finishedLedger();
  const running = {
    ...recorded,
    stage: { name: "code-tdd", status: "active", runId: "wf_running", attempt: 1, startedAt: "2026-11-04T08:13:42.543Z" },
    stages: recorded.stages.slice(0, 1),
  };

  const rows = stepRows(renderReport({ ledger: running, spawns: [] }));

  const row = rows.find((cells) => cells[0] === "build test by test");
  assert.ok(row, "the STEPS table lists the running step");
  assert.notEqual(row[1], "not reached", "a step that is running is not 'not reached'");
  assert.equal(row[1], "0:16", "its start is measured from the first stage's start (16s)");
});

test("later-stages-still-not-reached", async () => {
  const recorded = await finishedLedger();
  const finished = { ...recorded.stages[0], end: "2026-11-04T08:13:42.543Z" };
  const running = {
    ...recorded,
    stage: { name: "code-tdd", status: "active", runId: "wf_running", attempt: 1, startedAt: "2026-11-04T08:13:42.543Z" },
    stages: [finished],
  };

  const rows = stepRows(renderReport({ ledger: running, spawns: [] }));

  const row = (name) => rows.find((cells) => cells[0] === plainName(name));
  assert.ok(row("code-safety-net"), "the STEPS table lists the stage after the running one");
  assert.equal(row("code-safety-net")[1], "not reached", "a stage after the running one is still not reached");
  assert.deepEqual(row("code-scenarios"), [plainName("code-scenarios"), "0:00", "0:16", "0:16"], "a finished stage keeps its start, end and took columns");
});

// Scenario report-follows-color-scheme (Finding 27). Placeholders: fail until implemented.
test("report-has-light-palette-under-prefers-color-scheme", async () => {
  const html = renderReport(await recordedReportInput("probe-2", { outcome: "stopped" }));
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  const mediaStart = css.search(/@media\s*\(\s*prefers-color-scheme:\s*light\s*\)/);
  const open = mediaStart < 0 ? -1 : css.indexOf("{", mediaStart);
  let depth = 0;
  let end = open;
  for (; end >= 0 && end < css.length; end++) {
    if (css[end] === "{") depth++;
    if (css[end] === "}" && --depth === 0) break;
  }
  const lightBlock = open < 0 ? "" : css.slice(open + 1, end);
  const customProps = (text) => new Set([...text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const lightProps = customProps(lightBlock);
  const baseCss = open < 0 ? css : css.slice(0, mediaStart) + css.slice(end + 1);
  const baseProps = customProps(baseCss);
  const body = baseCss.match(/body\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.ok(open >= 0, "the stylesheet has a @media (prefers-color-scheme: light) block");
  assert.match(css, /color-scheme:\s*(light dark|dark light)/, "color-scheme declares both light and dark so the browser follows the viewer");
  assert.ok(lightProps.size >= 2, "the light block redefines custom properties (page background and text)");
  assert.ok([...lightProps].every((name) => baseProps.has(name)), "every property the light block redefines has a dark default in the base styles");
  assert.match(body, /background:\s*var\(--[\w-]+\)/, "the page background comes from a custom property");
  assert.match(body, /(^|[;\s])color:\s*var\(--[\w-]+\)/, "the page text colour comes from a custom property");
});

test("report-stays-self-contained-with-light-palette", async () => {
  const html = renderReport(await recordedReportInput("probe-2", { outcome: "stopped" }));
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  const lightBlock = css.match(/@media\s*\(\s*prefers-color-scheme:\s*light\s*\)\s*\{\s*:root\s*\{([^}]*)\}/)?.[1] ?? "";
  const definedInLight = (name) => new RegExp(`${name}\\s*:\\s*#[0-9a-fA-F]{3,8}\\b`).test(lightBlock);
  const usedBy = (selector, name) => new RegExp(`${selector.replace(/\./g, "\\.")}[^{]*\\{[^}]*var\\(${name}\\)`).test(css);

  assert.match(css, /prefers-color-scheme:\s*light/, "the light palette is present, so the self-contained check covers it");
  assert.doesNotMatch(html, /https?:\/\//i, "the page names no http(s) URL");
  assert.doesNotMatch(html, /\b(src|href)\s*=/i, "the page has no src or href attribute");
  assert.doesNotMatch(html, /<script|<link/i, "the page has no script or link tag");
  assert.doesNotMatch(html, /@import|url\s*\(/i, "the CSS imports nothing and loads no url() resource");
  for (const name of ["--stopped", "--done", "--running", "--badge-ink", "--amber"]) {
    assert.ok(definedInLight(name), `${name} is defined as a colour in the light palette`);
  }
  assert.ok(usedBy(".badge.stopped", "--stopped"), "the STOPPED badge background uses the --stopped colour");
  assert.ok(usedBy(".badge.done", "--done"), "the DONE badge background uses the --done colour");
  assert.ok(usedBy(".looped p strong", "--amber"), "the amber looping label uses the --amber colour");
});

// buildReport merges the lens row of the ledger's taskType, the row the workflow ran.
test("build-report-merges-by-ledger-task-type", async () => {
  const [{ name: returned }, { name: notReturned }] = lensRow("code-safety-net", "config_change").lenses;
  const attempt = 3;
  const artifactsDir = mkdtempSync(join(tmpdir(), "report-task-type-"));
  writeCleanLensReturn(artifactsDir, "code-safety-net", returned, attempt);
  const ledger = { taskType: "config_change", stage: { name: "code-safety-net", status: "active", runId: "wf_1", attempt, startedAt: null }, tests: {}, checkpoints: [] };

  let report;
  try {
    report = buildReport(ledger, artifactsDir);
  } finally {
    rmSync(artifactsDir, { recursive: true, force: true });
  }

  assert.deepEqual(report.uncovered, [notReturned], "the config_change row's other lens has no return, so it alone is uncovered");
});

// The pr-draft stage wires both of its lenses, so a lens with no return shows up as uncovered, the same as in the workflow.
test("build-report-wires-both-pr-draft-lenses", () => {
  const attempt = 1;
  const finding = { rule: "claims-match-record", severity: "high", kind: "fix-here", claim: "says tests ran on CI", where: "pr-body.md" };
  const pbKey = `pr-draft.lens.claims.r1.a${attempt}`;
  const artifactsDir = mkdtempSync(join(tmpdir(), "report-pr-draft-"));
  writeFileSync(join(artifactsDir, `${pbKey}.json`), JSON.stringify({ pb_key: pbKey, ambiguity: null, findings: [finding] }));
  const ledger = { stage: { name: "pr-draft", status: "active", runId: "wf_1", attempt, startedAt: null }, tests: {}, checkpoints: [] };

  let report;
  try {
    report = buildReport(ledger, artifactsDir);
  } finally {
    rmSync(artifactsDir, { recursive: true, force: true });
  }

  assert.deepEqual(report.survivors.map((s) => s.id), ["claims-1"], "the claims finding survives, with the claims lens's id");
  assert.deepEqual(report.uncovered, ["permanence"], "the permanence lens has no return, so it alone is uncovered");
});
