# Progress mod direction

This is the record for plan Task 54 (mod mockups from real runs). It took five rounds of static mockups built from `tests/smoke/recordings/`: [round 1](round-1/), [round 2](round-2/), [round 3](round-3/), [round 4](round-4/), [round 5](round-5/). Each folder has its PNGs, a README and the generator.

## Verdict

The human approved this direction on 2026-11-03 after round 5 ("Looking good. Let's go!"). That covers Task 55. Rounds 1 to 3 keep only their README and generator; rerun `python3 src/mocks.py <outdir>` in a round's folder to get its PNGs back.

## Task 60 verdict

Date: 2026-11-05. Verdict: **pass after fixes**.

The human checked wide dark (rounds 1 to 5), narrow (about 55 to 66 columns in a zellij pane) and light (the light colorblind theme on a light terminal), the alert sound and its off switch, and mid-run and finished reports. Findings 24 to 27 were fixed in this round (see [round 6](t4a-smoke/README.md)); 27 (report light mode) was included at the human's request.

Remaining step: a quick narrow re-look by the human before Task 60 is ticked.

## Chosen direction

- **The band is the default.** Always visible above the prompt: the goal's gist on its first row (seventh watched run), then one row that leads with the run's status as the pane's STATUS draws it (hierarchy), then answers where, spent and left. See [R4-1](round-4/R4-1-band-tdd-calm.png) and "The band" under "Fixed layout".
- **The pane holds the details.** `/pb` opens the pane, which the band names in its hint (see "Commands, not band buttons"), and esc or × closes it. The pane also opens by itself, without the keyboard, when a run starts (seventh watched run), when the run stops or needs you, and when the unit is done with nothing left to do (sixth watched run); for a question the band then reads "▲ NEEDS YOU · opened details". See [R4-7](round-4/R4-7-switching-storyboard.png).
- **The HTML report gives depth.** `/pb-report` writes a self-contained page and opens it in the browser. There is one report for a TDD run and one for a planning run. See [R5-3](round-5/R5-3-report-tdd.png) and [R5-4](round-5/R5-4-report-plan.png).

## The five rows

The pane opens with "at a glance". Each row is a plain sentence.

| Row | Calm example | In trouble |
|---|---|---|
| NOW | writing a failing test for the 0% discount · test 3 of 4 | … · test 3 of 4 · try 3 of 3 · last try before it asks you |
| SPENT | 12 agents · 1:55 · ≈0.4% of plan | same form |
| LEFT | 1 more test, then the safety-net review and your sign-off | this test, then … |

LOOPING and OFF TRACK were rows here; both are gone (see "Tenth watched run"). NOW is the pane's STATUS, and it tells a retry.

Planning uses the same rows. Its pane adds the aim, decisions, open questions (the one being asked is lit) and what is still to come. See [R4-4](round-4/R4-4-pane-planning-brainstorm.png) and [R4-5](round-4/R4-5-pane-planning-slices.png).

## Rules

- **Plain language.** No gate, stage or agent ids appear in the UI. `G:task-end` is "your sign-off at the end", and a gate auto mode passed reads "OK'd (auto)". `code-tdd` is "build test by test". Tracers are "slices", explained on first use. Agent names such as implement-tests are not shown.
- **A compact cycle marker.** `●RED ›GREEN ›REFACTOR` sits on the current test's own line, next to the step age. Only the current step is lit, and a bug fix drops REFACTOR. See [R5-1](round-5/R5-1-pane-tdd-calm.png).
- **Per-test progress** is one row of `✓ ◌ ▸ ·` with short test names. Long lists fold: finished items collapse to one line, then the current item and the next two, then `+ n more`.
- **No notes mid-task.** The pane and the band take no note for the agents; see "No notes mid-task" below.
- **Spend is low and dim:** one row of the glance and the band's middle segment. There are no dollars. Plan usage shows as "≈ % of plan".

## Rejected, and why

- **B's timeline (flight recorder).** It told the user nothing important. Its one strength, showing repeats, survives as STATUS's `try 2 of 3` (until the tenth watched run, the LOOPING row).
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
| Test order, "test 3 of 4" | the standing placeholders return in `run/task/artifacts/` (old path: `.pairingbuddy/tests.json`) | read since the ninth watched run |
| Short test names (TESTS, STATUS, band) | the test id spaced out, as the placeholders return and the ledger's `perTest` key it | since the tenth watched run; the scenario's sentence is the report's SCENARIOS |
| Plain names for ids | a mapping table next to the label contract | new; belongs with Task 57 |
| Retry limit per step (3) | stop behaviour seen in probe-2; `retries{}` stays empty | needs a ledger field |
| Rollbacks, attempts against the cap of 5, course-checker verdicts | `fixes` in the ledger, `course-checker` labels | T5: Task 83a, 83b, 84, 84a; shown in Task 86 |
| Lens progress and finding counts | `tool.call` StructuredOutput, refuters joined by finding id | T5: Task 76, 77; Task 86 |
| Off track: files outside scope, a test edited after GREEN | changed files per checkpoint | **no source yet**; not shown anywhere until one exists |
| Plan position and task list | plan MD checkboxes, `unit.json` | T7; Task 107 |
| Planning stages and gates | plan-kind ledger | T8: Task 116, 117, 118, 119; view in Task 125 |
| Planning aim, decisions, questions | an append-only log written during brainstorm | **no source yet**; plan JSON is written only at each agent's end |
| Tokens | `turn.complete` usage (D11) | Task 57; every recording so far has `tokensKnown: false` |
| % of plan | tokens divided by the plan's quota | **no source yet**; the mod can't read the quota |
| Reports | `$.fs.write` plus `$.process.run(['open', path])` | Task 57 onward; needs a kept location that R5 allows |
| Alerts and auto-open | a new run, `stop` or `needsHuman` in the ledger, or a done unit, then `$.ui.open`, sound, the status line (needs-you and stop only) and `$.ui.notify` (done) | Task 58; sixth and seventh watched runs |

## Fixed layout (2026-11-14, updated 2026-11-15 and in "Hierarchy")

Found in the third watched run: the pane changed shape as the run moved. Rows came and went, the step list switched from the code steps to the publish step, and lines such as "1 active", "▸ now", "✓ made to pass" and "4 agents of 1000" appeared and vanished. The human: "It would be better to have well-defined designs … keep the general layout the same."

The pane has one layout for the whole unit, from the first step to the published pull request. Every row is always drawn, in this order, with its label in a fixed-width column. A row with nothing to show reads `—`; it never disappears. This section is the single truth for the layout; the sixth watched run set the current order, and "Hierarchy" split it into two tiers.

The first glance, GOAL and STATUS, sits above a thin dim rule, its labels bold: what the session is for, where it is, and whether it needs you. The details sit under the rule, their labels dim and their values at full strength, read once the first glance says they are worth reading.

```
GOAL     Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it
         should return 90.
STATUS   ● working · writing a failing test for zero percent keeps full price
         test 2 of 2
─────────────────────────────────────────────────────────────────────────────────
PR       —
BUILT    —
SPENT    27 agents · 3:35
STEPS    ✓ work out the task type
         ✓ write test scenarios
         ▸ build test by test
         ○ safety-net review
         ○ write the pull request
TESTS    1 of 2 done
         ✓ ten percent off hundred
         ▸ zero percent keeps full price  ●RED ›GREEN ›REFACTOR  0:11
REVIEW   —

```

The pane draws no control: see "No buttons in the pane" below.

Rules:

- **GOAL leads,** bold, and STATUS follows it; the thin dim rule sits under the two. GOAL is the task's first sentence (its first line, before any blank-line context) from the first ledger on, so it is there for anyone cycling between sessions, and it never goes back to `—` during the unit (the code run's task is kept through the publish run). It wraps onto two lines; only past two is the second line cut at a clause break, else a word. The report's GOAL row is the same sentence; its How it ran TASK row holds the whole task.
- **STATUS answers "am I needed now?".** It leads with a head, a mark and the state's word, drawn to pull the eye in proportion to urgency, then says what it is about, wrapping at its ` · ` parts, then words:
  - `▲ NEEDS YOU · <what>`: the head a yellow block (inverse, bold), what follows in yellow and bold, until you answer. The strongest;
  - `✕ STOPPED · <why>`: the head a red block (inverse, bold), why in red. As strong. A stop with no plain name reads `✕ STOPPED`;
  - `✓ DONE · goal met · PR #7 opened · ready for your next task` once the unit is done: no run live, the task signed off, and the pull request opened (or kept local), or no unit left that would publish. The head bold and uncoloured, the rest plain: a call to action, not an alarm. The goal part reads `goal met`, or `goal in doubt: <gist>`, which leaves out "ready for your next task" since the doubt comes first; with no goal verdict known (no goal lens, or it did not return) the goal part is left out, as an unknown is;
  - `● working · <the active step or test sentence>`, `● working · between steps · next: …`, `● working · next: write the pull request` (all code steps done in a unit that publishes): the head in the accent, not bold, the rest plain. Calm;
  - `○ between runs · next: write the pull request` after the code run's end and before the publish run, `○ ended · not signed off` for a run that ended without its sign-off, `○ no run` before any run: quiet, the ○ dim.
- **Detail labels are dim.** PR, BUILT, SPENT, STEPS, TESTS and REVIEW have dim labels; their values keep full strength so they stay readable.
- **PR** reads `—` until `pb publish` printed its result, then `opened · #7 <title>` or `not opened · kept local`. It wraps.
- **BUILT** (the old DONE) reads `—` until the task-end gate passed, then the changed files and the passing tests. It wraps.
- **STEPS is the whole unit.** The code steps for the task type, then the publish step, in one list. In the publish run the code steps show as done.
- **STATUS, TESTS and the band follow the active step.** Outside "build test by test" no test is current, and STATUS and the band name the active step, never the last test.
- **SPENT counts the whole unit.** Agents and time both, so neither resets when the publish run starts.
- **A retry is told in STATUS.** On a step's second try or later STATUS adds `· try 2 of 3`; on the last allowed try `· try 3 of 3 · last try before it asks you`. "try 1 of 3" is never shown. A try past the limit reads `· try 4`. Each try's result is in the report's test card.
- **A test reads by its short name** (its id spaced out) in TESTS, STATUS and the band. The whole scenario sentence is the report's SCENARIOS'.
- **REVIEW** shows the latest review round of the active step (or the last one, after it ends): what was checked, one summary line, then one line per finding.
- **Finding words.** `checking` (a refuter is on it), `to fix` (upheld, fix not tried yet), `fixing`, `fixed`, `not a real problem` (knocked down), `left as is` (still open when the round ended). The summary counts the same words: `3 issues found · 1 fixed · 1 left as is · 1 not a real problem`.
- **Colours are fixed hex values, not theme keys,** readable on dark and light, so a theme that maps "success" to blue cannot turn GREEN blue: RED `#e5534b`, GREEN `#3fb950`, REFACTOR `#4c8dff`, and the accent `#39c5cf` for where the run is now. See "Colour means one thing" below.
- **Nothing is cut with "…".** Rows wrap. Two places keep a cut, each at a word and never with an ellipsis: a TESTS line stays one line (the current test's name gives way so its marker and age fit; the report's SCENARIOS holds every name whole), and a REVIEW finding stays one line (its where gives way, then its gist; the report's REVIEW keeps the full claim). The band's goal row is cut at a clause break, else a word, never with "…". The band's step row is one row by design: it drops segments first and may end in "…" only as a last resort.
- **Removed:** "n active", "n unknown" and the legend under the test line, the "▸ now" and "✓ made to pass" sub-step lines, the "n agents of 1000" line, the LEFT and OFF TRACK rows (never measured live), since the sixth watched run NOW (now STATUS) and DONE (now BUILT), and since the tenth LOOPING (STATUS tells a retry). The progress row of earlier tests is the TESTS row.

### The band (seventh watched run, hierarchy)

The band is two rows at most, under a dim rule: the goal row, then the step row, which leads with the run's status. This is the single truth for the band's layout.

```
────────────────────────────────────────────────────────────────────────────────
Fix this bug in discount.py
● RED · zero percent keeps price · 2/2 │ 0:50 · 10 agents
```

The step row in each state, at 80 columns (the hint gives way first, so a long step row has none):

```
● GREEN · ten percent off · 1/2 │ 0:50 · 10 agents │ /pb details · /pb-report report
▲ NEEDS YOU · your sign-off at the end │ /pb details · /pb-report report
✕ STOPPED · a step kept failing │ RED · zero percent keeps price
✓ DONE · ready for your next task · /pb details · /pb-report report
● between steps · next: build test by test · /pb details · /pb-report report
```

- **The goal row** is the goal's gist, bold as the pane's GOAL and not coloured: the whole first sentence when it fits beside the [-] control, else cut at the last clause break (`: `, `; `, `, ` outside brackets and backticks), else the last word, never with "…". It is drawn from the first ledger to the end of the run (also once the run is over, so the done band says what was done), and only while idle is there none.
- **The goal has its own row** at every width, so the step row stays where the eye learnt to find it. At 139 columns most goals are whole; at 80 and 50 the gist is often the goal's first clause.
- **The step row leads with the status,** in STATUS's heads and colours, so the band answers "am I needed now?" before any detail. A question leads as `▲ NEEDS YOU · <what>` and a stop as `✕ STOPPED · <why>`, each head a block; the step behind them is a plain detail, no longer lit. Once the alert opened the pane, what reads `opened details`. While nothing waits on you, the step leads behind STATUS's `●` alone (the word "working" would cost the step its room), and the calm `needs you: no` is gone: the mark already says it.
- **Then the details:** the step (or the phase, the current test's name as TESTS names it, and its place `3/12` once the total is known), spent and left, dropping segments by priority, then the commands hint `/pb details · /pb-report report`, which shortens to `/pb · /pb-report` and is the first thing dropped. A question or stop is never dropped. When it alone does not fit whole, it keeps its mark and what (`▲ your sign-off at the end`, the block on the mark); only past that is it cut.
- **With no stage active** the row is one quiet line. Between steps: `● between steps · next: …` (or `● run open`, `● all steps done`), the mark in the accent and the words dim, with no "Pairing Buddy" label since the goal row names the session. Done: `✓ DONE · ready for your next task`, the head bold, the words plain. Idle and last run finished: `Pairing Buddy · idle`, dim. The commands hint follows the quiet line too, while it fits.

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

Colour marks only, in the pane and the band alike (updated in the seventh watched run and in "Hierarchy"; this list is the single truth):
- the TDD phase (red, green, blue, with bold), on the lit step of the cycle marker and on the band's phase word (`RED · zero percent keeps price`);
- where the run is now (the accent, cyan `#39c5cf`): with bold on the ▸ current step in STEPS, the current test's line in TESTS and the band's step (`write test scenarios`, or the `· <test name>` after the phase word); calm, without bold, on STATUS's `● working` head and the band's `●`;
- "needs you" (yellow), until you answer: STATUS's `▲ NEEDS YOU` head as a block (inverse, bold), then what in yellow and bold; the band leads with the same;
- a stop (red): STATUS's `✕ STOPPED` head as a block (inverse, bold), then why in red; the band leads with the same.

A block (inverse) means one thing too: act now. Only needs-you and a stop are blocks, and yellow and red appear only in STATUS and at the head of the band, never in the details. Done has no colour: `✓ DONE` is bold and uncoloured. Green is the TDD phase, the accent is where a running run is, yellow and red ask you to act; a finished unit is none of those, so weight and the ✓ carry it.

Marks read the same everywhere: ✓ done (a step, a test, the unit), ▸ the active step or test (lit), ○ to do or nothing running, ● happening now (the lit phase in the cycle marker, a working run), ▲ needs you, ✕ stopped. No warning sign (⚠) marks a state that is not a problem. Nothing else is coloured, and nothing changes colour except when one of those meanings starts or ends.

### The end state answers "is it done, and what was done"

When the unit is finished, the top of the pane reads:

```
DONE     order_total added to cart.py · 1 test passing
GOAL     met · <the task's first sentence>
PR       opened · #7 feat: add order_total summing line totals
```

Review moves below that as one summary line (`review: 4 issues, all fixed`), with the finding titles under it.

Superseded by the sixth watched run: the goal's verdict and the pull request now sit in STATUS, the goal leads from the first ledger, and DONE is BUILT (see "Fixed layout"). As first built: DONE, GOAL and PR are the first three rows at every step, each `—` until the task-end gate has passed, so the layout stays fixed. DONE lists run/changed.json's paths and the code run's passing tests. GOAL reads `met` only when the task-end gate passed and the safety-net's alignment lens (`corpus-misalignment`, or any lens named `*goal`) returned with no finding still open; `in doubt · <gist>` when one is open; `not checked` when that lens did not return or its returns are not known (a new session). PR reads `—` between the code run's end and the publish, then what `pb publish` printed (`opened · #7 <title>`, or `not opened · kept local`), else unit.json's `pr.url`. While the publish run's pr-draft runs, REVIEW shows that round; once no stage runs, it is the safety-net summary.

## Long lists (2026-11-14)

A big task (15 scenarios, 40 tests, 20 changed files, 8 findings, names over 100 characters) keeps every question and row short. Every "+ n more in the report" points at a list the report (`r`) really holds.

- **Scenarios question.** All scenarios with their tests indented when they fit 12 lines. Otherwise one line per scenario with its count (`- order_total sums price times quantity (3 tests)`), no test lines, up to 15 scenarios, then `+ n more scenarios in the report`. A scenario is never cut off part way through its tests. The header `Scenarios (N scenarios, M tests):` stays. This replaces the 12-line fold above.
- **Task-done question.** `Built:` stays one line: the first 5 changed files, then `+ n more in the report`.
- **Report.** SCENARIOS lists every standing scenario with its tests (the same standing return `pb gate eval` reads). BUILT lists every path in `run/changed.json`. REVIEW already lists every finding the goal check folds.
- **TESTS row.** At most 5 lines: the done and covered counts, up to 3 tests, then `+n more`. While the total is not known yet (tests.json does not list every test seen), the hidden tests are still counted, as `+n more so far`.
- **REVIEW at the end.** The summary line, the first 3 findings, then `+ n more`: 5 lines at most.
- **Cut at a word.** DONE, GOAL, PR and REVIEW never cut a word with "…". Test names in TESTS may still be cut with "…". (Since the sixth watched run nothing in the pane is cut with "…"; see "Fixed layout".)

## Fifth watched run (2026-11-14)

The human's findings:
- PR stayed `—` after the pull request opened.
- A gate said "A step was unsure about something." The human asked: what am I approving?
- REVIEW opened with `the code 1 · the tests 0 · docs and plan 0`. The numbers needed a legend.
- TESTS went back to `—` once the publish run started, and stayed so at the end.
- GOAL cut a long goal mid-clause (`…over them, so`).

What changed:
- **PR.** The pane reads the last JSON object `pb publish` printed, one line or pretty-printed, also when another command follows it (`pb publish; echo "exit=$?"`).
- **Doubts in questions.** A gate that asks over an open doubt shows one line per doubt, `Unsure (<step>): <doubt>`, cut at a word near 120 characters, at most 3, then `+ n more in the report`. It then asks over the doubt: "Is the task done despite this?", "Start building these despite this?", "Is that the right type despite this?". The ledger keeps every doubt in full (`needsHuman.doubts`); the report lists them under NEEDS YOU. With no doubt, the why line stays ("A step ran out of retries."); a gate that asks only because auto mode is off has no why line, as that is the usual case and says nothing new.
- **REVIEW's first line** names what was checked, with no counts: `checked: the code, the tests, docs and plan`. A lens still running reads `checking <lens>` (`checking the task type`), one that returned nothing usable under `could not check:`. A cycle's quick review reads `quick review done`. The summary line (`1 issue found · 1 checking`) and the finding lines stay; `no issues found` waits until no lens is still running, so a review under way never reads as clean. This replaces "one line per lens with its finding count" above.
- **TESTS through the publish.** During the publish run and after it, TESTS shows the finished code run's tests, folded as usual (`✓ 5 done`).
- **GOAL gist.** The goal's first sentence. When it is wider than the room, it is cut at the last clause break (`: `, `; `, `, `) that fits; a comma inside brackets or backticks does not count. With none, it is cut at the last word. The task-done question's `Goal:` line follows the same rule within 120 characters. The report keeps the whole goal.

## Sixth watched run (2026-11-15)

### The questions

The human's findings on the gate questions:
- Doubts were still cut with "…" ("…The task text…"). A cut sentence cannot be judged. Claude Code's question box wraps a long line, as a long `Goal:` line showed.
- The doubts were reviewer jargon: "reviewing through one lens", "corpus", "subject".
- A reviewer's note on what it did not read ("the corpus is none", "I did not read the full cart.py") stopped the gate as if it were a question for the human.

What changed in the questions:
- **Nothing is cut.** No line of a gate question ends in "…". Each doubt is whole on one line, whitespace collapsed, at most 3. The task-done `Goal:` line is the goal's whole first sentence. A goal-check finding is its title, else its claim's whole first sentence. This replaces the 120-character doubt cut and the `Goal:` line's 120-character rule above.
- **One file holds the full question.** `pb gate eval` writes `.pairingbuddy/run/question.md` each time it asks: the full question as Markdown, with the whole goal, every doubt, scenario, changed file, goal-check finding and the whole PR body. Every fold reads `+ n more: <absolute path of that file>` (`+ 3 more scenarios: <path>`, `+ 15 more files: <path>`, `+ 3 more lines: <path>`), with the path at the end of its line so a terminal can open it. This replaces "+ n more in the report" in the questions.
- **A reviewer, not a lens.** A lens's or refuter's doubt reads `A reviewer was unsure: <doubt>`. Other steps keep `Unsure (<step>): <doubt>`.
- **A doubt is a question for you.** A reviewer's return keeps two things apart. `ambiguity` is a question only the human can decide, in plain words with no internal terms; it stops the gate. `not_checked` is what the reviewer could not read or check; it goes to the report's not-covered list (`the code review could not check: <what>`) and never stops the gate. An old return with only `ambiguity` stops the gate as before.
- **Reviewers read the whole file.** A lens saw only the diff hunk and doubted `line_total`. A lens or refuter reviewing a change now reads each changed file in full. The prompt still passes paths, not file contents: putting every changed file's text in each lens prompt would multiply its size by the number of lenses and refuters.
### The pane

The human's findings:
- GOAL read `—` until the end. "The goal is what we will accomplish … it should be permanently visible after the task has been identified." Someone cycling between sessions wants to see what each one is working on.
- DONE sat at the top and its meaning was unclear; the goal should lead, and stand out.
- At the end (NOW "last run finished", DONE files, GOAL "met · …", PR opened) it was not clear the work was done.
- A finished session sat idle: "it should notify the human, as when you have a question".
- Bold alone did not mark the current step: "Some color … would be great."
- Cut text with "…" could not be judged.
- "What are code scenarios? … We are opinionated TDD folks." The step read "write scenarios", and Claude Code's own progress line shows workflow ids (`code-scenarios`, `code-tdd`, `intake`, `pr-draft`).

What changed:
- **New fixed layout:** GOAL (bold, a thin rule under it), STATUS, PR, BUILT, SPENT, LOOPING, STEPS, TESTS, REVIEW. "Fixed layout" above is updated and stays the single truth.
- **GOAL from the first ledger.** The task's first sentence, on up to two lines, then cut at a clause or word; the report keeps the whole task.
- **STATUS replaces NOW** and says the state: working, needs you, stopped, done (with the goal's verdict and the pull request, "nothing left to do"), between runs, or ended without the sign-off.
- **BUILT is the old DONE.**
- **Done alert.** When no run is live, the task was signed off and nothing is left to publish, the mod alerts as for a question: the sound, the status line and the pane, with "done · ready for your next task", once per run end. The band says it too, not dim. A stop alerts as a stop, never as done. (The status line was dropped for done in the seventh watched run.)
- **Accent colour** `#39c5cf` with bold on the current step and the current test. "Colour means one thing" above is updated.
- **No "…" in the pane.** PR, BUILT, STATUS, the LOOPING tries and long REVIEW parts wrap. A TESTS line and a REVIEW finding stay one line and are cut at a word; the report holds both whole. The band keeps its last-resort "…".
- **"write test scenarios"** is the scenarios step's plain name in the pane, band and report.
- **Workflow names in Claude Code's progress line are unchanged.** That line shows each workflow's `meta.name`, and the workflow tool has no separate display name (`meta` takes `name`, `description`, `whenToUse`, `phases`). The name is also how a stage is invoked (`pairingbuddy:<stage>`): the gate allows a stage's Workflow call only by that name (`shared-node/stage-calls.mjs`, `hooks/gate.mjs`), the tap ties a Workflow runId to the active stage by it (`hooks/tap.mjs`), and the ledger, stage graph, labels and contracts all key on the stage id. A rename would mean either renaming every stage id (contracts, ledger schema, labels, gate rules, tests, recordings) or a name-to-id map in the gate and the tap, plus rebuilding `workflows/` and checking that the tool resolves a plugin workflow by `meta.name` and not by its file name. Left for a decision. The cheaper lever, if wanted, is the phase titles (`phase(role)` in each stage), which show agent role ids such as `enumerate-scenarios-and-test-cases`; they are display only.

### The footer

The pane's footer read "Pairing Buddy only watches; it never changes your run". The human read it as false (Pairing Buddy writes code all run) and as wasted space. It meant only that the pane itself never steers the run, which the human does not need told. Removed.

## Seventh watched run (2026-11-15)

The run had no question: every gate passed in auto mode.

The human's findings:
- The pane never showed until the done alert opened it; only the band was there. "Is that expected?"
- The band did not use the pane's colours. The same code in both "trains the human to find things".
- The band did not say what the session was for.
- The done alert read "⚠ pairingbuddy: done · ready for your next task" in the status line. The ⚠ reads as "something went wrong".
- A scenario said the line totals of `order_total([(10, 2), (4, 1)])` are 20 and 4, where the task said 30.0 "which is 25.0 plus 5.0" (`line_total` in cart.py adds 25% VAT). A reviewer flagged it, and the refuter called it "not a real problem".

What changed:
- **The pane opens when a run starts.** Once per run, without the keyboard, the first poll that sees a run opens the pane. The run is kept in the mod's store before the open, so a pane the human closed (`/pb` or esc) is never opened again for that run, also after a reload; a store that fails opens nothing, since opening every poll would undo that close. A run first seen with a question or a stop is opened by its alert alone. Unasked, Claude Code places a pane only from 144 columns (110 once the human asked for it); below that it waits undrawn, and one transcript line gives the reason and says to type `/pb` (or `/pb-report` for the report). `/pb` stays the way in; the band itself is unchanged, its room going to the goal and the step.
- **The band uses the pane's colours.** See "Colour means one thing", now the single truth for both.
- **The goal leads the band** on its own row. See "The band" under "Fixed layout".
- **Done leaves the status line alone.** Claude Code draws every plugin status line as a pinned notice `⚠ <plugin>: <text>` in the warning colour (`$.ui.status` adds the notice with no colour, and the notice row always draws the ⚠ figure); a plugin cannot change the mark or the colour. So done plays the sound, opens the pane, says it in the band (bold) and sends one native notice through the human's notification channel (`$.ui.notify`, titled "Pairing Buddy"), which carries no warning mark. The status line stays for needs-you and a stop, where a warning mark fits.
- **Scenarios check the code.** The scenarios agent reads the existing code the task builds on before it writes an expected value, and never restates a number that contradicts the task text. When the task and the code disagree, that is an open question, not a pick.
- **A factual mismatch is a real problem.** The refuter now gets the task (`<task>`), and a finding that a scenario or test description states a fact or number the task text or the code contradicts survives when the facts disagree, however small the gap; the refuter never knocks it down as not a real problem.

## Hierarchy (2026-11-15)

The human's findings:
- "There is no real hierarchy, apart from the goal section being separated." STATUS, PR, BUILT, SPENT, LOOPING, STEPS, TESTS and REVIEW all looked alike.
- Someone cycling through many sessions wants to see at once where each one is and whether it needs them. "Those things must be grouped, at the top, and draw the eye towards them."
- "All the rest are details" to look into after that first read. So STATUS must be where the human sees whether they are needed right now.
- "The status line also needs something visual."
- The ⚠ on "done" read as a problem (seventh watched run).

What changed:
- **Two tiers.** GOAL and STATUS are the first glance, above the rule, with bold labels. The details sit under the rule with dim labels and full-strength values. See "Fixed layout", still the single truth.
- **STATUS leads with a head** that draws the eye in proportion to urgency: a yellow block `▲ NEEDS YOU` (the strongest), a red block `✕ STOPPED` (as strong), a bold uncoloured `✓ DONE … ready for your next task` (a call to action, not an alarm), a calm accent `● working`, and a dim `○` for between runs, ended and no run.
- **Done reads "ready for your next task"** in STATUS, the band and the notice alike, in place of "nothing left to do".
- **The band leads with the same head** in the same colours, then the details. The calm `needs you: no` is gone. A narrow band keeps a question's or a stop's mark and what (`▲ your sign-off at the end`) before it cuts anything: a segment can carry its own short form, which `fitBand` takes first. Between steps the quiet line leads with `●` and drops its "Pairing Buddy" label. See "The band".
- **Colour means one thing** gained the block: only needs-you and a stop are blocks, and yellow and red appear only in STATUS and at the head of the band. See "Colour means one thing".

Decisions:
1. **Done is bold and uncoloured.** Green is the TDD phase, the accent is where a running run is, and yellow and red ask you to act. Weight and the ✓ make done stand out without borrowing one of those meanings.
2. **Blocks only for needs-you and a stop.** A block is the one treatment a glance cannot miss, so it is kept for the states where the run waits on the human.
3. **What follows a block keeps its colour, not the block.** The block is the signal; the words after it stay readable.
4. **Working is calm:** the accent without bold, on the mark and the word only. The step after it is plain, since STEPS and TESTS already light it.
5. **The band shows the working mark alone.** "working" would cost the band's step 10 cells; the pane, where the mark sits next to its word, teaches it.
6. **The step behind a question or a stop is not lit.** One thing draws the eye at a time.
7. **"Opened details" stays.** Once the alert opened the pane, the band still says so after the head; the pane carries what is needed.
8. **No border box.** A border would cost two rows and four columns at 50 columns. The rule, the bold labels and the dim detail labels group the first glance well enough.
9. **The ○ mark for quiet states.** Between runs, ended and no run are not problems and run nothing, so they get the "to do / nothing running" mark, dim.

## Eighth watched run (2026-11-15)

One test, "order total sums two lines".

The human's findings:
- During REFACTOR, TESTS showed the test twice: `✓ order total sums two lines`, then `▸ order total sums two lines  ✓RED ✓GREEN ●REFACTOR`. The progress row marked a test done once its GREEN passed, while the current step was still on it.
- The band read `● GREEN · test 1`. "Should I see the name of the test being worked on?"

What changed:
- **A test is current until the next one starts.** The test a step is on is current in TESTS, though its GREEN passed, so it shows once. An ended run has no current test.
- **The band names the current test** after the phase, as TESTS does, in the same accent: `● GREEN · order total sums two lines`. Short of room, spent, left and looping give way first (by their usual priority), then the name is cut at a word, then it falls back to `test N`; never "…". STATUS keeps the position (`test 1 of 2`). At 80 columns a long name can take the room `looping:` had; the pane's LOOPING row still says it.

## Ninth watched run (2026-11-16)

One test, "order total sums two lines".

The human's findings:
- "It is difficult to understand how many tests it is working on." STATUS read `test 1`, with no total, though the tests had been written. Earlier builds showed `test 1 of 2`.
- The band read `● write the pull request │ 8:17 · 44 agents [ ▸ details ] │ /pb for details`. Both open the same pane, so the hint was noise.

Why the total was missing: the mod took the planned tests only from `.pairingbuddy/tests.json`. A new-path run never writes it: the placeholders agent returns its rows, which pb keeps as `run/task/artifacts/code-tdd.create-test-placeholders.-.r<n>.a<n>.json`. With no list, the mod knew only the tests seen so far and claimed no total. The eighth run's band change was not the cause; it never touched STATUS.

What changed:
- **The test list is the placeholders return.** The newest standing one (not of a voided attempt) gives the order and the total; tests.json is the fallback for the old path. The scenarios return names the tests, as scenarios.json did.
- **STATUS** reads `test 3 of 12` whenever the total is known.
- **TESTS leads with its count** on its first line at every step once the total is known: `3 of 12 done` (`· 1 covered` when any test was already covered) while the build runs. It stands for the folded tests, so the row stays at 5 lines.
- **TESTS settles once the build step is over.** Through the review, the pull request and the end it reads `✓ 12 of 12 passing` (no ✓ when some did not pass), then the list: the tests that did not pass first, the first three, then `+n more`. Once the build step is done, the tests the ledger saw are the whole list.
- **The band gives the place** after the test's name: `● GREEN · order total sums two lines · 1/2`. Short of room the place goes first, then the name is cut at a word, then `GREEN · test 1 of 2` stands in.
- **No `/pb` text in the band.** The `▸ details` button is drawn in every band state and at every width, so `/pb for details` repeated it. `/pb` stays in the transcript lines that say the pane is waiting, where no button is drawn. Reverted the same day; see "Commands, not band buttons".

## Tenth watched run (2026-11-16)

The human's findings:
- "What was the LOOPING thing, and what should the human running this care? Also cryptic." LOOPING read `no` almost always, or `making the test pass · try 2 of 3`; the band said `looping: no`. STATUS already said the try.
- TESTS showed a test as its whole scenario sentence: `✓ order_total([(10, 2), (4, 1)]) returns 30.0, which is …`. Since the ninth run's fix the mod named tests by the scenarios return; before, it showed `order total sums two lines`.

What changed:
- **No LOOPING.** The pane has no LOOPING row or tries line, and the band no `looping:` segment. STATUS tells a retry: `● working · making the test pass for <name> · test 1 of 2 · try 2 of 3`, and on the last allowed try `… · try 3 of 3 · last try before it asks you`, so the human knows they may be needed soon.
- **The report's AT A GLANCE** (now in How it ran) has no Looping row (a live signal; each try's result is in the test's card, with "Why it looped") and no Off track row (it never had a source and always read unknown). Where it is, Spent and Left stay.
- **Short test names.** TESTS, STATUS and the band name a test by its id spaced out (the placeholders return's `test_id`, the ledger's `perTest` key). The mod no longer reads the scenarios return for names; the report's SCENARIOS keeps each sentence.

## Commands, not band buttons (2026-11-16)

In a watched run the human could not use the band's `[ ▸ details ]` button. The classic renderer has no mouse, and the only way to the button is ctrl+x tab, tab, enter, which nobody finds. So the band draws no button and names commands instead.

- **`/pb`** opens the pane with focus (since 2026-11-17 it toggles: see below). **`/pb-report`** writes the run report and answers with one transcript line: the report's absolute path and whether it opened (`Pairing Buddy report: <path> · opened in your browser`, or `· couldn't open it`), so the path can be opened by hand. It works for a live run and for an ended one (from the last polled ledger and the kept runs), and says `Pairing Buddy: no run to report yet` when there is none.
- **Both are immediate,** so they run while Claude is working, with no model turn.
- **The band's hint** reads `/pb details · /pb-report report`, shortens to `/pb · /pb-report`, and is the first thing dropped at narrow widths. With the button gone the step gets its room.
- **The pane kept `r open report`** at first, with `or /pb-report, no focus needed` beside it; it has gone since (see below).
- **Why bare names.** From the mod docs (code.claude.com/docs/en/plugins/mods: api.md, interface.md, reference.md): a mod-registered command is a bare name of letters, digits, `_` and `-`, so `/pb:report` is not possible; a `command.run` hook runs mod code with no model turn and returns `{}` or `{ text }`; `$.ui.open({ id, focus: true })` from a command gets focus; `immediate: true` lets it run mid-turn.

## No buttons in the pane (2026-11-17)

Looking at the pane, the human called its last three lines useless: `[ r open report ]  or /pb-report, no focus needed`, `suggest: a note for the next agent` and `[ dismiss ]`. Like the band's old button, each needed the pane's focus (ctrl+x tab, then tab and enter), which nobody does. So the pane draws no control at all, only text, and every action is a typed command that runs at once, with no model turn:

- **`/pb` toggles the pane.** Shown, it closes it; closed, waiting undrawn or behind another tab, it opens it with the keyboard (`$.ui.panes()` says which). It answers `Pairing Buddy pane opened` or `Pairing Buddy pane closed`. This replaces `[ dismiss ]`, which only closed the pane (`$.ui.close`) and cleared nothing; esc still closes it too. A pane closed either way is not opened again by the run start for the same run, as before.
- **`/pb-report`** replaces `r open report`; the pane's note line still says what the last report came to.
- **`/pb-note <text>`** replaces the suggest input. It appends the same task-scoped entry to `.pairingbuddy/human-guidance.json` (the agents read it when they start; curate-guidance drops it at the next task) and answers in one line: `Note saved to .pairingbuddy/human-guidance.json. The next agent will read it.` With no text, no running task, or a guidance file it cannot read or write, it saves nothing and says so in that line. The pane still says which agent reads the note next and, once it spawned, that it reached it.

The pane's bottom is now only text: the unknown-label lines (if any) and the note line from the last `/pb-report`.

## No notes mid-task (2026-11-20)

`/pb-note` is gone, and with it the pane's note line and the report's NOTES row. A note reached whichever agent happened to start next (in a live run, "listing scenarios" and "checking coverage"), so the human could not aim it, and it gave nothing a human could rely on. The human's levers are answering questions at gates, stopping the task, typing to Claude in the chat, and the lasting guidance curated at task start.

## The report leads with what you need (2026-11-16)

The human read the report of a finished toy task: "not sure why knowing how it decided task type is that important. That's a lot of text for nothing really... What would be useful for the human to know/needs to take action on, that's what you want on the report really, apart from a summary of what was done/accomplished and changes in plan or scope if there is any material impact for the task."

The report's shape, top to bottom:
- **Header.** The whole goal, where the task is (`DONE`, `WAITING ON YOU`, `STOPPED`, `RUNNING`) and the pull request's link. No task type, no time.
- **NEEDS YOU.** Only what the human must act on or decide: a question not answered yet or a sign-off not given, a stop with its plain reason and how to go on, each review finding left open (to fix, or left as is) with its gist, where it is and the question it left (a doubt raised on that finding reads once, under it), any other open doubt, and checks by hand (a test that passed before its code, a scenario the last coverage check still found untested). With none: "Nothing needs you." (or "Nothing needs you right now: the run is still going."). The pull request is in the header, not here.
- **WHAT WAS DONE.** The files changed, the tests added and passing (by short name), the tests not passing yet, the pull request opened.
- **CHANGES OF PLAN OR SCOPE.** Only when material: a new task type after a review, tests added because a coverage check found a scenario with none, and each finding a review had fixed in the work. A new confidence in the same type, a cycle's quick review and the pull request's wording are left out. With none, the section is not drawn.
- **How it ran,** a closed `<details>` at the bottom, for debugging: AT A GLANCE (task type, where it is, spent, waited, left), DOUBTS RAISED (each doubt the human answered a gate past, with where it was raised and what settled it), STEPS, SCENARIOS, TESTS, BUILT, REVIEW and COMMITS, as before.

### The report looks like the pane (2026-11-17)

The human on that report: "using a header type for the goal or something? Really ugly. How it ran expand is useful. TBH, the whole report design is horrible, very AI generated crap." Decided: the report looks like the pane in the terminal, which the human likes.

- **Rows, as the pane draws them.** Every part is a row: a narrow label column (GOAL, STATUS, NEEDS YOU, DONE, CHANGES, then HOW IT RAN) and what it holds to the right. One monospace face at one size; labels stand apart by weight and colour only. GOAL and STATUS have bold labels and a thin rule under them, as the pane's first glance; every other label is dim. Below 600px a label sits above its content.
- **GOAL** is the goal sentence alone (the pane's GOAL), at the body's size. The whole task, context included, is How it ran's TASK row, left out when the task is the goal alone.
- **STATUS** reads as the pane's: `✓ DONE · PR #7 opened`, `▲ NEEDS YOU · your sign-off at the end`, `✕ STOPPED · a step kept failing`, `● working · build test by test`, the head in the pane's colour (done plain bold, needs you amber, stopped red, working cyan). No badges. It holds the page's only pull request link; DONE no longer names it.
- **WHAT WAS DONE and CHANGES OF PLAN OR SCOPE** are labelled DONE and CHANGES.
- **HOW IT RAN** stays a closed `<details>` with a plain `▸`/`▾` marker; its rows are label and content too. A review round with no finding is one line (`safety-net review · no issues found`).
- **No footer, no heading sizes, no pills, cards, shadows, gradients or letter-spaced titles with rules.** Light and dark follow `prefers-color-scheme`; the width is capped at 96 characters.

Time waiting on the human is no working time. `pb gate eval` stamps `needsHuman.askedAt`; an answer keeps `askedAt` and `answeredAt` on its gate's record. SPENT (pane, band, an ended task's) and the report's Spent leave the waits out; the report's Waited row says them apart (`4h 1m waiting for you`). A ledger without the stamps waited 0.


## Recovery drill (2026-11-22)

The human's findings on build 0211140:
- With `gate-boot.mjs` broken nothing was gated, and the pane said `● working`.
- After the session that ran a stage was killed, the pane said `● working` on that stage for good. A new session asked to go on said, rightly, that the human must adopt the run.

What changed:
- **Safety checks off is a stop.** While `run/gate-off.json` (left by `hooks/gate-watch.mjs`) stands and `gate-boot.mjs` is as it named it, STATUS and the band lead with `✕ STOPPED · safety checks are off`, and STATUS gives the one fix line under it: `fix: git -C <plugin> checkout -- hooks`. The alert fires as for any stop. A restored file clears it at the next poll.
- **A stranded stage needs you.** An active stage that nothing has moved for 10 minutes (not its owner, its start, a ledger write or an agent of this session, none still running) reads `▲ NEEDS YOU · take over the run: its session is gone`. The rule and why it reads the ledger's last write are in `shared-node/stranded.mjs`.
- **SPENT stops while nothing runs.** Its time ticked on through a stranded stage or a wait for the human, as if agents and tokens were being spent. While the run is stopped (the safety checks off included), needs you or is stranded, the time stops where the work did (the question's askedAt, the permission prompt's, the stranded stage's last move, the broken file's time, else the ledger's last write) and reads `paused`: `0 agents · 3:04 paused` in the pane, `3:04 paused · 0 agents` in the band. Dim as the rest of SPENT; STATUS already says why.
