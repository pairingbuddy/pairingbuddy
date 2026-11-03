# Progress mod, round 2

Direction A (instrument panel), reworked from the feedback on round 1. The images use the same terminal chrome and colours as round 1. A **dotted magenta underline** still marks a made-up value, and each caption names the recording and the moment it shows.

## Frames

| Image | What it shows |
|---|---|
| `R2-1-bugfix-red.png` | g-open-1 at 1:55, the same moment as A1. bug_fix, RED on test 3 of 4, with the focus block on `zero-percent-original-price`. |
| `R2-2-plan-green-collapsed.png` | t52-nf-6 at 2:14, shown as task 3 of a 12-task plan. GREEN. The plan is collapsed to "✓ 2 done", the current task with its stages, the next 2 tasks and `+ 9 more`. |
| `R2-3-plan-expanded.png` | The same moment with the plan expanded: all 12 tasks, the stages nested under task 3, and the focus block folded to one line. |
| `R2-4-suggestion-queued.png` | g-open-1 at 1:57 with a suggestion queued. It says which agent will read it and that the agent running now will not. |
| `R2-5-safety-net-lenses.png` | g-open-1 in code-safety-net. The lens round takes the focus block's place: one row per lens with its found, refuted and standing counts. |
| `R2-6-needs-you.png` | e-open-1 at 3:14, with G:task-end held. It shows why the run stopped and the three things the human can do. |
| `R2-7-bugfix-red-80col.png` | R2-1 in a 79-column pane. The stage notes get shorter, the description wraps, and all three steps still fit. |

## What changed since round 1, and why

1. **Stages are the workflow's own stages** (code-scenarios, code-tdd, code-safety-net, G:task-end). A plan run adds a level above them: "plan task 3 of 12" appears in the status bar and as a `plan` box. Long lists collapse finished items to one line, then show the current item and the next 2, with a button-styled `+ 9 more` (R2-2). R2-3 is the expanded view.
2. **The tests grid is gone.** A focus block shows the test being built now: its id, its description from the scenario, the selector, and RED → GREEN → REFACTOR as three cells with the current one lit and the step's age in it. In bug_fix, REFACTOR reads "not part of bug_fix". "test 3 of 4" is in the box title. Finished tests fold to "✓ 2 done · 1 red → green · ◌ 1 covered" with a `+ show 2` button, and the next test sits under the block.
3. **Suggestions.** A `s suggest` button sits above the footer on running frames. A workflow takes no input mid-run, so R2-4 is explicit about timing. The suggestion is queued and applies at the next agent spawn, GREEN implement-code. If the runner marks the test covered instead, it goes to RED implement-tests for the next test. The agent running now will not see it. In the real g-open-1 run the test was covered, so the second case is what would have happened. R2-6 notes that while a gate is held no agent spawns, so a suggestion waits until the human answers.
4. **Spend** is one dim line at the bottom right: agents · time · "≈ 0.4% of plan". There are no dollars and no token counts.
5. **Commits.** The box is gone. The footer shows the last commit's one-liner, dim, at the bottom left.
6. **Lenses** are off the main view. They appear only during a lens round, in place of the focus block (R2-5).
7. **Recent events** pane is removed.

Kept from round 1: the status bar (RUNNING · stage · step, elapsed, "needs you"), the TASK line, the colours and the box style. "Agents" and "commits" left the status bar because the footer carries them.

## Made-up values

- **Test descriptions** (R2-1, R2-2, R2-4, R2-7). The text comes from `scenarios.json`'s `test_cases[].description`, which the recordings don't capture. The texts shown are written from the test function names and the task text.
- **Percent of plan** in every footer. All recordings have `tokens: 0, tokensKnown: false`.
- **The plan** (R2-2, R2-3): `cart-pricing.md`, the 12 titles and the position "3 of 12". No recording has a plan. Task 3's work is the real t52-nf-6 task.
- **The suggestion text** and "queued 0:04 ago" (R2-4).
- **The whole lens round** (R2-5): states, durations, counts, the standing finding, the 3:02 and 0:34 times, and 19 agents. No lens has run in any recording. The lens names come from the D8 safety-net row, and Sonnet is the default model.
- **The one-line reading of each ambiguity** (R2-6). The return files are named in the recording, but their text is not recorded.

## Build findings

- **Descriptions need `scenarios.json`.** The ledger's `tests.perTest` holds only selectors and step evidence. The mod has to join `test_id` → `test_case_id` (from `tests.json`) → description (from `scenarios.json`), both under `.pairingbuddy/`. Neither file is in the recordings. The ledger does not carry a test's position ("3 of 4") either: it comes from the order of `tests.json`.
- **The suggestion channel already half exists.** Every code-tdd and code-scenarios spawn gets `.pairingbuddy/human-guidance.json` passed in (`SHARED_PATHS` in `workflows-src/stages/code-tdd.mjs`), and the agents read it when they start. Adding a suggestion to that file makes it reach the next agent without any workflow change. Open questions: (a) the mod writing into a file the human owns, against a separate `suggestions` file, which every agent would then need to be told about; (b) `curate-guidance` keeps or drops entries at the next task start, so a one-off suggestion should be marked task-specific; (c) the ledger is signed, so the mod must never write to it.
- **"Applies at" can't always be known in advance.** After RED implement-tests comes a runner, which is not an agent. Whether GREEN implement-code or the next test's RED comes next depends on the runner's exit code. R2-4 shows both cases. Once the next `agent.spawn` arrives, the pane can change "queued" to "delivered to <label>".
- **Pane input exists.** The mod API has an `Input` element (`ui.input` change and submit), focus via ctrl+x tab or click, and `$.fs.write`. So `s suggest` and a text field are buildable, but a key only reaches the pane once it has focus. The frames say so ("ctrl+x tab to focus the pane").
- **Percent of plan has no source.** Tokens are not recorded, and the mod has no plan quota to divide by. It needs both a token count per spawn and the plan's limit, which may only be an estimate, hence the "≈".
- **Lens rounds don't exist yet** (T5). R2-5 assumes a refuter's label carries the finding id, so "found / refuted / standing" can be counted from labels without parsing text. That join is the Task 76 merge decision.
- **Plan position.** The ledger has `plan: {path, title}`, but no current task index or task count. "task 3 of 12" and the task list have to come from parsing the plan's markdown checkboxes.
- **80 columns works** (R2-7). Only the stage notes and the hint text get shorter. The three-step cells are about 23 columns each, so a step's age goes in the cell's label row rather than after the agent name.

## Re-rendering

`src/` holds the generator, copied from round 1 (`lib.py`, `cc.py` and `data.py` are unchanged; `mocks.py` is new). Run `python3 src/mocks.py <outdir> [name-filter]`.
