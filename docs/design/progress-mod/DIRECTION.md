# Progress mod direction

This is the record for plan Task 54 (mod mockups from real runs). It took five rounds of static mockups built from `tests/smoke/recordings/`: [round 1](round-1/), [round 2](round-2/), [round 3](round-3/), [round 4](round-4/), [round 5](round-5/). Each folder has its PNGs, a README and the generator.

## Verdict

The human approved this direction on 2026-11-03 after round 5 ("Looking good. Let's go!"). That covers Task 55. Rounds 1 to 3 keep only their README and generator; rerun `python3 src/mocks.py <outdir>` in a round's folder to get its PNGs back.

## Task 60 verdict

Date: 2026-11-05. Verdict: **pass after fixes**.

The human checked wide dark (rounds 1 to 5), narrow (about 55 to 66 columns in a zellij pane) and light (the light colorblind theme on a light terminal), the alert sound and its off switch, and mid-run and finished reports. Findings 24 to 27 were fixed in this round (see [round 6](t4a-smoke/README.md)); 27 (report light mode) was included at the human's request.

Remaining step: a quick narrow re-look by the human before Task 60 is ticked.

## Chosen direction

- **The band is the default.** One row above the prompt, always visible, answers five questions: where, spent, left, looping, off track. It also shows "needs you". See [R4-1](round-4/R4-1-band-tdd-calm.png).
- **The pane holds the details.** The band's `▸ details` button (click, or ctrl+x tab then enter) or `/pb` opens the pane, and esc or × closes it. The pane also opens by itself when the run stops or needs you, and the band then reads "needs you · opened details". See [R4-7](round-4/R4-7-switching-storyboard.png).
- **The HTML report gives depth.** The pane's `open report` writes a self-contained page and opens it in the browser. There is one report for a TDD run and one for a planning run. See [R5-3](round-5/R5-3-report-tdd.png) and [R5-4](round-5/R5-4-report-plan.png).

## The five rows

The pane opens with "at a glance". Each row is a plain sentence.

| Row | Calm example | In trouble |
|---|---|---|
| NOW | writing a failing test for the 0% discount · test 3 of 4 | writing a failing test …, 3rd try |
| SPENT | 12 agents · 1:55 · ≈0.4% of plan | same form |
| LEFT | 1 more test, then the safety-net review and your sign-off | this test, then … |
| LOOPING | no · this step: try 1 of 3 | yes: 3 tries at the same step, with each try and the reason |
| OFF TRACK | no | yes: what went off track |

Planning uses the same rows. Its pane adds the aim, decisions, open questions (the one being asked is lit) and what is still to come. See [R4-4](round-4/R4-4-pane-planning-brainstorm.png) and [R4-5](round-4/R4-5-pane-planning-slices.png).

## Rules

- **Plain language.** No gate, stage or agent ids appear in the UI. `G:task-end` is "your sign-off at the end", and a gate auto mode passed reads "OK'd (auto)". `code-tdd` is "build test by test". Tracers are "slices", explained on first use. Agent names such as implement-tests are not shown.
- **A compact cycle marker.** `●RED ›GREEN ›REFACTOR` sits on the current test's own line, next to the step age. Only the current step is lit, and a bug fix drops REFACTOR. See [R5-1](round-5/R5-1-pane-tdd-calm.png).
- **Per-test progress** is one row of `✓ ◌ ▸ ·` with short test names. Long lists fold: finished items collapse to one line, then the current item and the next two, then `+ n more`.
- **Suggestions.** Tab to suggest writes a note to `.pairingbuddy/human-guidance.json`. The next agent spawn reads it, because workflows take no input mid-run. The pane says which agent that will be, and that the agent running now won't see it.
- **Spend is low and dim:** one row of the glance and the band's middle segment. There are no dollars. Plan usage shows as "≈ % of plan".

## Rejected, and why

- **B's timeline (flight recorder).** It told the user nothing important. Its one strength, showing repeats, survives as the LOOPING row.
- **The per-test RED/GREEN/REFACTOR grid.** A large table with little information in it. A focus on the current test replaced it.
- **The commit, lens and recent-events boxes.** Noise in the main view. The last commit is one dim footer line, lenses appear only while a review round runs, and recent events went away.
- **The spelled-out cycle** ("write a failing test", "make it pass") and the three cycle boxes. "We know what red means."
- **Jargon in labels:** WHERE, REMAINING, G:, stage ids. Readers couldn't tell what the rows meant.

## Data the mod needs

| Data | Source | Supplied by |
|---|---|---|
| Stage, attempt, gates, stop, needsHuman | polled `ledger.json` | exists (T1, T2); read in Task 57 |
| Current step, test and try (`r<n>`) | `agent.spawn` labels | label contract (T1L); Task 57, Task 61 |
| Live agent count | count of `agent.spawn` events (the ledger's `spend.agents` only updates at stage end) | Task 57 |
| Per-test outcome and exit codes | `ledger.tests.perTest` (red, green, covered) | exists (T2); Task 61 |
| Test order, "test 3 of 4" | `.pairingbuddy/tests.json` | exists; the mod must read it |
| Test descriptions and short names | `scenarios.json` test-case descriptions, joined through `tests.json` | exists on disk, not in recordings; fallback is the id with spaces |
| Plain names for ids | a mapping table next to the label contract | new; belongs with Task 57 |
| Retry limit per step (3) | stop behaviour seen in probe-2; `retries{}` stays empty | needs a ledger field |
| Rollbacks, attempts against the cap of 5, course-checker verdicts | `fixes` in the ledger, `course-checker` labels | T5: Task 83a, 83b, 84, 84a; shown in Task 86 |
| Lens progress and finding counts | `tool.call` StructuredOutput, refuters joined by finding id | T5: Task 76, 77; Task 86 |
| Off track: files outside scope, a test edited after GREEN | changed files per checkpoint | **no source yet**; the CLI should record them at checkpoint |
| Plan position and task list | plan MD checkboxes, `unit.json` | T7; Task 107 |
| Planning stages and gates | plan-kind ledger | T8: Task 116, 117, 118, 119; view in Task 125 |
| Planning aim, decisions, questions | an append-only log written during brainstorm | **no source yet**; plan JSON is written only at each agent's end |
| Tokens | `turn.complete` usage (D11) | Task 57; every recording so far has `tokensKnown: false` |
| % of plan | tokens divided by the plan's quota | **no source yet**; the mod can't read the quota |
| Suggestions | `.pairingbuddy/human-guidance.json`, already passed to every spawn | exists; needs a task-specific marking for curate-guidance |
| Reports | `$.fs.write` plus `$.process.run(['open', path])` | Task 57 onward; needs a kept location that R5 allows |
| Alerts and auto-open | `stop` or `needsHuman` in the ledger, then `$.ui.open`, toast and sound | Task 58 |

## Fixed layout (2026-11-14)

Found in the third watched run: the pane changed shape as the run moved. Rows came and went, the step list switched from the code steps to the publish step, and lines such as "1 active", "▸ now", "✓ made to pass" and "4 agents of 1000" appeared and vanished. The human: "It would be better to have well-defined designs … keep the general layout the same."

The pane now has one layout for the whole unit, from the first step to the published pull request. Every row is always drawn, in this order, with its label in a fixed-width column. A row with nothing to show reads `—`; it never disappears.

```
NOW      <one plain sentence about the active step>
SPENT    27 agents · 3:35
LOOPING  no
STEPS    ✓ work out the task type
         ✓ write scenarios
         ✓ build test by test
         ▸ safety-net review
         ○ write the pull request
TESTS    ✓ order total sums line totals
TEST     order total sums line totals  ✓RED ●GREEN ›REFACTOR  0:03
REVIEW   the code 1 · the tests 0 · docs and plan 0
         1 issue found · 1 fixed
           fixed · order_total uses sum() with the default integer start, …

Pairing Buddy only watches; it never changes your run
[ r open report ]
suggest: a note for the next agent
[ dismiss ]
```

Rules:

- **STEPS is the whole unit.** The code steps for the task type, then the publish step, in one list. In the publish run the code steps show as done.
- **NOW, TEST and the band follow the active step.** Outside "build test by test", TEST reads `—`, and NOW and the band name the active step, never the last test.
- **SPENT counts the whole unit.** Agents and time both, so neither resets when the publish run starts.
- **LOOPING** reads `no`, or names the step and its try when a step is on its second try or later. "try 1 of 3" is never shown. After the run it reads `—`.
- **REVIEW** shows the latest review round of the active step (or the last one, after it ends). One line per lens with its finding count, one summary line, then one line per finding.
- **Finding words.** `checking` (a refuter is on it), `to fix` (upheld, fix not tried yet), `fixing`, `fixed`, `not a real problem` (knocked down), `left as is` (still open when the round ended). The summary counts the same words: `3 issues found · 1 fixed · 1 left as is · 1 not a real problem`.
- **Phase colours are fixed, not theme keys.** RED red, GREEN green, REFACTOR blue, the lit one bold, so a theme that maps "success" to blue cannot turn GREEN blue.
- **Removed:** "n active", "n unknown" and the legend under the test line, the "▸ now" and "✓ made to pass" sub-step lines, the "n agents of 1000" line, and the LEFT and OFF TRACK rows (never measured live). The progress row of earlier tests is the TESTS row.

## Fourth watched run (2026-11-14): show what you ask about, gist before detail

The human's findings:
- A question gave the task type only in brackets at the end.
- The scenarios question did not show the scenarios.
- "Is this task done?" gave nothing to judge it by.
- TESTS and TEST read as the same thing.
- Long finding text was cut with "…".
- A colour changed under the reader (yellow to white).
- The end state talked about review fixes instead of whether the work is done and meets the goal.

### Gate questions carry what they ask about

Each question opens with its subject, then gives the facts needed to answer, then asks. The text is built by `pb gate eval` and stored, so the session cannot change it.

- **Task type:** "Task type: new feature. Adds order_total to cart.py." Then the why line. Then "Is that the right type?"
- **Scenarios:** "Scenarios (1 scenario, 1 test):", then one line per scenario with its test cases indented, folded after about 12 lines with "+ n more in the report". Then the why line. Then "Start building these?"
- **Task done:** "Goal: <the task's first sentence>". "Built: <changed files>; <n> tests, all passing." "Review: <n> issues, <n> fixed, <n> left as is." When the safety-net's goal check had something to say, "Goal check: <its gist>". Then the why line. Then "Is the task done?"
- **Publish:** "Pull request: <title>", then the body's first lines, then "Open it?"

### Gist first, detail on request

Every review finding carries a short `title` of 60 characters at most, written by the lens. The pane shows the title, never a cut-off claim. The full claim stays in the report (`r`). For older returns with no title, the pane uses the claim's first sentence and cuts it at a word boundary.

### One TESTS row

TEST is folded into TESTS. There is one line per test, the current one with its phase marker and age:

```
TESTS    ✓ ten percent off hundred
         ▸ zero percent keeps full price  ●RED ›GREEN ›REFACTOR  0:11
         · rounding
```

Long lists fold as before.

### Colour means one thing

Colour marks only:
- the TDD phase (red, green, blue);
- "needs you" (yellow), until you answer;
- a stop (red).

Steps use marks, not colours: ✓ done, ▸ active in bold, ○ to do. Nothing changes colour except when one of those three meanings starts or ends.

### The end state answers "is it done, and what was done"

When the unit is finished, the top of the pane reads:

```
DONE     order_total added to cart.py · 1 test passing
GOAL     met · <the task's first sentence>
PR       opened · #7 feat: add order_total summing line totals
```

Review moves below that as one summary line (`review: 4 issues, all fixed`), with the finding titles under it.

As built: DONE, GOAL and PR are the first three rows at every step, each `—` until the task-end gate has passed, so the layout stays fixed. DONE lists run/changed.json's paths and the code run's passing tests. GOAL reads `met` only when the task-end gate passed and the safety-net's alignment lens (`corpus-misalignment`, or any lens named `*goal`) returned with no finding still open; `in doubt · <gist>` when one is open; `not checked` when that lens did not return or its returns are not known (a new session). PR reads `—` between the code run's end and the publish, then what `pb publish` printed (`opened · #7 <title>`, or `not opened · kept local`), else unit.json's `pr.url`. While the publish run's pr-draft runs, REVIEW shows that round; once no stage runs, it is the safety-net summary.

## Long lists (2026-11-14)

A big task (15 scenarios, 40 tests, 20 changed files, 8 findings, names over 100 characters) keeps every question and row short. Every "+ n more in the report" points at a list the report (`r`) really holds.

- **Scenarios question.** All scenarios with their tests indented when they fit 12 lines. Otherwise one line per scenario with its count (`- order_total sums price times quantity (3 tests)`), no test lines, up to 15 scenarios, then `+ n more scenarios in the report`. A scenario is never cut off part way through its tests. The header `Scenarios (N scenarios, M tests):` stays. This replaces the 12-line fold above.
- **Task-done question.** `Built:` stays one line: the first 5 changed files, then `+ n more in the report`.
- **Report.** SCENARIOS lists every standing scenario with its tests (the same standing return `pb gate eval` reads). BUILT lists every path in `run/changed.json`. REVIEW already lists every finding the goal check folds.
- **TESTS row.** At most 5 lines: the done and covered counts, up to 3 tests, then `+n more`. While the total is not known yet (tests.json does not list every test seen), the hidden tests are still counted, as `+n more so far`.
- **REVIEW at the end.** The summary line, the first 3 findings, then `+ n more`: 5 lines at most.
- **Cut at a word.** DONE, GOAL, PR and REVIEW never cut a word with "…". Test names in TESTS may still be cut with "…".

## Fifth watched run (2026-11-14)

The human's findings:
- PR stayed `—` after the pull request opened.
- A gate said "A step was unsure about something." The human asked: what am I approving?
- REVIEW opened with `the code 1 · the tests 0 · docs and plan 0`. The numbers needed a legend.
- TESTS went back to `—` once the publish run started, and stayed so at the end.
- GOAL cut a long goal mid-clause (`…over them, so`).

What changed:
- **PR.** The pane reads the last JSON object `pb publish` printed, one line or pretty-printed, also when another command follows it (`pb publish; echo "exit=$?"`).
- **Doubts in questions.** A gate that asks over an open doubt shows one line per doubt, `Unsure (<step>): <doubt>`, cut at a word near 120 characters, at most 3, then `+ n more in the report`. It then asks over the doubt: "Is the task done despite this?", "Start building these despite this?", "Is that the right type despite this?". The ledger keeps every doubt in full (`needsHuman.doubts`); the report lists them under OPEN DOUBTS. With no doubt, the why line stays ("Auto mode is off, so this asks you.").
- **REVIEW's first line** names what was checked, with no counts: `checked: the code, the tests, docs and plan`. A lens still running reads under `still looking at:`, one that returned nothing usable under `could not check:`. A cycle's quick review reads `quick review done`. The summary line (`1 issue found · 1 checking`) and the finding lines stay. This replaces "one line per lens with its finding count" above.
- **TESTS through the publish.** During the publish run and after it, TESTS shows the finished code run's tests, folded as usual (`✓ 5 done`).
- **GOAL gist.** The goal's first sentence. When it is wider than the room, it is cut at the last clause break (`: `, `; `, `, `) that fits; a comma inside brackets or backticks does not count. With none, it is cut at the last word. The task-done question's `Goal:` line follows the same rule within 120 characters. The report keeps the whole goal.
