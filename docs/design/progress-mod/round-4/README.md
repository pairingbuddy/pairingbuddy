# Progress mod, round 4

This round fixes the wording, replaces the three cycle boxes with one line, and shows how you move between the band and the pane. The markings are the same as round 3. A **dotted magenta underline** marks a made-up value. A **dotted cyan underline** marks a value borrowed from the real plan `docs/plans/deterministic-workflows.md` (local, gitignored). Everything else comes from the recording named in each caption.

## Frames

| Image | What it shows |
|---|---|
| `R4-1-band-tdd-calm.png` | g-open-1 at 1:55 in a 139-column terminal. The band reads `RED · test 3 of 4 │ 1:55 · 12 agents · ≈0.4% │ left: 1 test + review │ looping: no │ off track: no │ needs you: no` and ends with `▸ details`. |
| `R4-2-pane-tdd-calm.png` | g-open-1 at 1:55. The rows are NOW, SPENT, LEFT, LOOPING and OFF TRACK, each a plain sentence. Steps have plain names. The cycle is one line, and per-test progress uses short names. |
| `R4-3-pane-tdd-looping.png` | probe-2 at 2:10, the third try at the same failing test. LOOPING reads "yes: 3 tries at the same failing test" and gives each try. OFF TRACK reads "yes: …". |
| `R4-4-pane-planning-brainstorm.png` | Brainstorm, asking question 2. The steps ahead are named requirements, architecture, slices and task list, each "then your OK". |
| `R4-5-pane-planning-slices.png` | 52 minutes in: checking the 14 slices drafted so far, with "slices" explained where it first appears. |
| `R4-6-band-focused.png` | The band after ctrl+x tab, with `▸ details` focused. Enter opens the pane and esc returns to the prompt. |
| `R4-7-switching-storyboard.png` | Three panels: the band, then the pane opened by `▸ details` or `/pb` and closed by esc or ×, then the pane opening by itself when the run needs you. |

## What changed, by feedback point

- **Jargon.**
  - Gates: `G:x` is gone. The UI now says "your OK on the scenarios", "your sign-off at the end", or "OK'd (auto)" when auto mode passed it.
  - Stage ids: these became "write scenarios", "build test by test", "safety-net review", "requirements", "architecture", "slices" and "task list". "Tracers" became "slices", explained as "thin end-to-end pieces of the plan".
  - Remaining codes: plan ids such as T4d are dropped, the task type reads "bug fix", and commit lines read "made to pass" or "saved: … already passes".
  - What stays: the Claude Code transcript on the left keeps its real tool names, because that is Claude Code's own output.
- **At a glance.**
  - The labels are now NOW, SPENT, LEFT, LOOPING and OFF TRACK, and each row is a sentence you can read cold.
  - LOOPING and OFF TRACK answer "no" or "yes: <what>".
  - The tries count reads "this step: try 1 of 3".
- **The cycle.**
  - The three boxes and the agent names are gone. One line remains: `● RED write a failing test → GREEN make it pass → REFACTOR clean up`, with the current step lit.
  - In a bug fix, REFACTOR is dimmed with "(not in a bug fix)".
  - The saved rows go to per-test progress (`✓ ◌ ▸ ·`, with short test names and a legend) and to the test description.
- **Switching** (R4-6, R4-7). The band is always there. `▸ details` or `/pb` opens the pane, and esc or × closes it. When the run stops or needs you, the pane opens by itself and the band says "needs you · opened details".

## Made-up and borrowed values

- **TDD**, made up: ≈ % of plan, test descriptions, short test names, the files changed (R4-2), and the whole OFF TRACK row in R4-3 (probe-2 changed no other test).
- **Planning**, made up: everything about the run, because no planning recording exists. That covers times, agent counts, question counts, Q4, the undone architecture fix and check progress.
- **Planning**, borrowed from the plan file: the aim, the decisions, Q2 and Q3, the open question, the slice names and the 30 requirements. Decisions are reworded into plain language.
- **Storyboard:** the panels are not to scale. The key hint line in R4-6 is illustrative.

## Build findings

- **Switching fits the mod API** (types in `claude-code.d.ts`):
  - A `Button` drawn in the `AbovePrompt` band can call `$.ui.open({ id })` from its press handler.
  - ctrl+x tab or a click gives a site the focus, and Enter presses the focused button.
  - `$.ui.open({ id, closeOnEscape: true })` closes on esc or ×.
  - `/pb` is a `$.command.register` command answered by `command.run`.
  - Opening the pane by itself is `$.ui.open` called from the hook that sees the ledger write `stop` or `needsHuman`.
  - One open point: whether an unasked open seats at narrow widths. The types say an unasked pane seats from 144 columns, or 110 as `$.ui.open`'s doc says, and waits below that. Below that width the band has to carry the alert alone.
- **Plain names need a mapping table** from stage, gate, step and type ids to words, for example `code-tdd` → "build test by test", `G:task-end` → "your sign-off at the end", and `implement-tests` → "writing a failing test". It belongs next to the label contract, so the mod never guesses.
- **Short test names** ("0% keeps the price") don't exist anywhere. They would come from the scenario test-case descriptions, which the recordings don't capture. A deterministic fallback is the test id with hyphens turned into spaces.
- **Wording that depends on outcome** ("made to pass", "already passed", "a try that was refused") maps directly from the ledger's `red`, `green` and `covered` per test and from `r<n>` in the labels.
- **The band needs about 139 columns** for every label in full. Below that, drop "left:" and "≈ %" first, then shorten "needs you:" to "you:".

## Re-rendering

`src/base.py` (round 2) and `src/r3.py` (round 3) are copied unchanged, and `src/mocks.py` is new. Run `python3 src/mocks.py <outdir> [name-filter]`.
