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
- **The pane holds the details.** The band's `▸ details` button (click, or ctrl+x tab then enter) or `/pb` opens the pane, and esc or × closes it. The pane also opens by itself when the run stops or needs you, or the unit is done with nothing left to do (sixth watched run), and the band then reads "needs you · opened details". See [R4-7](round-4/R4-7-switching-storyboard.png).
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

## Fixed layout (2026-11-14, updated 2026-11-15)

Found in the third watched run: the pane changed shape as the run moved. Rows came and went, the step list switched from the code steps to the publish step, and lines such as "1 active", "▸ now", "✓ made to pass" and "4 agents of 1000" appeared and vanished. The human: "It would be better to have well-defined designs … keep the general layout the same."

The pane has one layout for the whole unit, from the first step to the published pull request. Every row is always drawn, in this order, with its label in a fixed-width column. A row with nothing to show reads `—`; it never disappears. This section is the single truth for the layout; the sixth watched run set the current order.

```
GOAL     Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it
         should return 90.
─────────────────────────────────────────────────────────────────────────────────
STATUS   working · writing a failing test for zero percent keeps full price
         test 2 of 2
PR       —
BUILT    —
SPENT    27 agents · 3:35
LOOPING  no
STEPS    ✓ work out the task type
         ✓ write test scenarios
         ▸ build test by test
         ○ safety-net review
         ○ write the pull request
TESTS    ✓ ten percent off hundred
         ▸ zero percent keeps full price  ●RED ›GREEN ›REFACTOR  0:11
REVIEW   —

Pairing Buddy only watches; it never changes your run
[ r open report ]
suggest: a note for the next agent
[ dismiss ]
```

Rules:

- **GOAL leads,** bold, with a thin dim rule under it. It is the task's first sentence (its first line, before any blank-line context) from the first ledger on, so it is there for anyone cycling between sessions, and it never goes back to `—` during the unit (the code run's task is kept through the publish run). It wraps onto two lines; only past two is the second line cut at a clause break, else a word. The report's title holds the whole task.
- **STATUS says the run's state** in plain words, wrapping at its ` · ` parts, then words:
  - `working · <the active step or test sentence>`, `working · between steps · next: …`, `working · next: write the pull request` (all code steps done in a unit that publishes);
  - `needs you · <what>` (yellow, bold), until you answer;
  - `stopped · <why>` (red);
  - `done · goal met · PR #7 opened · nothing left to do` once the unit is done: no run live, the task signed off, and the pull request opened (or kept local), or no unit left that would publish. The goal part reads `goal met`, `goal not checked`, or `goal in doubt: <gist>` (which leaves out "nothing left to do");
  - `between runs · next: write the pull request` after the code run's end and before the publish run;
  - `ended · not signed off` for a run that ended without its sign-off.
- **PR** reads `—` until `pb publish` printed its result, then `opened · #7 <title>` or `not opened · kept local`. It wraps.
- **BUILT** (the old DONE) reads `—` until the task-end gate passed, then the changed files and the passing tests. It wraps.
- **STEPS is the whole unit.** The code steps for the task type, then the publish step, in one list. In the publish run the code steps show as done.
- **STATUS, TESTS and the band follow the active step.** Outside "build test by test" no test is current, and STATUS and the band name the active step, never the last test.
- **SPENT counts the whole unit.** Agents and time both, so neither resets when the publish run starts.
- **LOOPING** reads `no`, or names the step and its try when a step is on its second try or later. "try 1 of 3" is never shown. After the run it reads `—`. The tries line under it folds older tries, then wraps.
- **REVIEW** shows the latest review round of the active step (or the last one, after it ends): what was checked, one summary line, then one line per finding.
- **Finding words.** `checking` (a refuter is on it), `to fix` (upheld, fix not tried yet), `fixing`, `fixed`, `not a real problem` (knocked down), `left as is` (still open when the round ended). The summary counts the same words: `3 issues found · 1 fixed · 1 left as is · 1 not a real problem`.
- **Colours are fixed hex values, not theme keys,** readable on dark and light, so a theme that maps "success" to blue cannot turn GREEN blue: RED `#e5534b`, GREEN `#3fb950`, REFACTOR `#4c8dff`, and the accent `#39c5cf` for where the run is now. See "Colour means one thing" below.
- **Nothing is cut with "…".** Rows wrap. Two places keep a cut, each at a word and never with an ellipsis: a TESTS line stays one line (the current test's name gives way so its marker and age fit; the report's SCENARIOS holds every name whole), and a REVIEW finding stays one line (its where gives way, then its gist; the report's REVIEW keeps the full claim). The band is one row by design: it drops segments first and may end in "…" only as a last resort.
- **Removed:** "n active", "n unknown" and the legend under the test line, the "▸ now" and "✓ made to pass" sub-step lines, the "n agents of 1000" line, the LEFT and OFF TRACK rows (never measured live), and since the sixth watched run NOW (now STATUS) and DONE (now BUILT). The progress row of earlier tests is the TESTS row.

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

Colour marks only (updated in the sixth watched run; this list is the single truth):
- the TDD phase (red, green, blue), on the lit step of the cycle marker;
- where the run is now (the accent, cyan `#39c5cf`, with bold), on the ▸ current step in STEPS and the current test's line in TESTS;
- "needs you" (yellow), until you answer;
- a stop (red).

Steps read by their marks: ✓ done, ▸ active (lit), ○ to do. Nothing else is coloured, and nothing changes colour except when one of those four meanings starts or ends.

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
- **Doubts in questions.** A gate that asks over an open doubt shows one line per doubt, `Unsure (<step>): <doubt>`, cut at a word near 120 characters, at most 3, then `+ n more in the report`. It then asks over the doubt: "Is the task done despite this?", "Start building these despite this?", "Is that the right type despite this?". The ledger keeps every doubt in full (`needsHuman.doubts`); the report lists them under OPEN DOUBTS. With no doubt, the why line stays ("Auto mode is off, so this asks you.").
- **REVIEW's first line** names what was checked, with no counts: `checked: the code, the tests, docs and plan`. A lens still running reads under `still looking at:`, one that returned nothing usable under `could not check:`. A cycle's quick review reads `quick review done`. The summary line (`1 issue found · 1 checking`) and the finding lines stay. This replaces "one line per lens with its finding count" above.
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
- **Done alert.** When no run is live, the task was signed off and nothing is left to publish, the mod alerts as for a question: the sound, the status line and the pane, with "done · ready for your next task", once per run end. The band says it too, not dim. A stop alerts as a stop, never as done.
- **Accent colour** `#39c5cf` with bold on the current step and the current test. "Colour means one thing" above is updated.
- **No "…" in the pane.** PR, BUILT, STATUS, the LOOPING tries and long REVIEW parts wrap. A TESTS line and a REVIEW finding stay one line and are cut at a word; the report holds both whole. The band keeps its last-resort "…".
- **"write test scenarios"** is the scenarios step's plain name in the pane, band and report.
- **Workflow names in Claude Code's progress line are unchanged.** That line shows each workflow's `meta.name`, and the workflow tool has no separate display name (`meta` takes `name`, `description`, `whenToUse`, `phases`). The name is also how a stage is invoked (`pairingbuddy:<stage>`): the gate allows a stage's Workflow call only by that name (`shared-node/stage-calls.mjs`, `hooks/gate.mjs`), the tap ties a Workflow runId to the active stage by it (`hooks/tap.mjs`), and the ledger, stage graph, labels and contracts all key on the stage id. A rename would mean either renaming every stage id (contracts, ledger schema, labels, gate rules, tests, recordings) or a name-to-id map in the gate and the tap, plus rebuilding `workflows/` and checking that the tool resolves a plugin workflow by `meta.name` and not by its file name. Left for a decision. The cheaper lever, if wanted, is the phase titles (`phase(role)` in each stage), which show agent role ids such as `enumerate-scenarios-and-test-cases`; they are display only.
