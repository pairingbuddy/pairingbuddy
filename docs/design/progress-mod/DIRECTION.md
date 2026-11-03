# Progress mod direction

This is the record for plan Task 54 (mod mockups from real runs). It took five rounds of static mockups built from `tests/smoke/recordings/`: [round 1](round-1/), [round 2](round-2/), [round 3](round-3/), [round 4](round-4/), [round 5](round-5/). Each folder has its PNGs, a README and the generator.

## Verdict

The human approved this direction on 2026-11-03 after round 5 ("Looking good. Let's go!"). That covers Task 55. Rounds 1 to 3 keep only their README and generator; rerun `python3 src/mocks.py <outdir>` in a round's folder to get its PNGs back.

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
- **Suggestions.** `s suggest` writes a note to `.pairingbuddy/human-guidance.json`. The next agent spawn reads it, because workflows take no input mid-run. The pane says which agent that will be, and that the agent running now won't see it.
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
