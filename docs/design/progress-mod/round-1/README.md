# Progress mod, round 1

Task 54. These are three directions for the Pairing Buddy mod, drawn as the terminal would show them and filled from the recordings in `tests/smoke/recordings/`. Nothing in `mod/` exists yet.

## How to read the images

- The left side is the Claude Code transcript. The right side, or the band above the prompt, is the mod.
- A **dotted magenta underline** marks a made-up value. Everything else comes from a recording, and each image's caption names which one, at what time.
- In the wide layout the pane is 110 columns beside a 78-column transcript, a 190-column terminal. The engine docks a pane from 110 terminal columns and seats an unasked one from 144, so a real pane will often be narrower than this. A narrower pane belongs in round 2.
- The narrow images are a 100-column terminal with no pane and the `AbovePrompt` band (`[-]` is the engine's own mark).
- The transcript rows use real agent names, task descriptions and durations. Their exact formatting, and the closing chat paragraphs, are illustrative.

## The three directions

**A. Instrument panel.** A calm dashboard: a status bar that answers "needs you: no", then stages, now, a per-test RED/GREEN/REFACTOR table, lenses and findings, spend, commits and recent events. Everything is in one fixed place, so the eye learns where to look.

**B. Flight recorder.** A time-scaled chart: each spawn is a bar placed on its real start time and length, in lanes for RED, GREEN and REFACTOR, above a tape of events with timestamps. The question it answers best is "is it stuck?", because gaps and repeats are visible.

**C. Glance.** As little as possible: one row in the band, or one loud sentence in the pane. It stays quiet while things go well and shouts only when a human is needed.

## Images

| Image | Direction, layout, moment | What it tries |
|---|---|---|
| `A1-panel-wide-running.png` | A, wide, running TDD | g-open-1 at 1:55. Four tests in one table: one red to green, one covered, one RED in flight, one waiting. "Now" box with the step's age. |
| `A2-panel-wide-done.png` | A, wide, finished | t52-nf-6 after `pb task end`. Full RED, GREEN and REFACTOR strip, all five commits with messages, plus a plan tree. |
| `A3-panel-band-needs-you.png` | A, narrow band, needs-human | e-open-1 at 3:14. G:task-end held: four rows, with the hold in a yellow bar and the two ambiguous tests named. |
| `B1-recorder-wide-running.png` | B, wide, running TDD | t52-nf-6 at 2:35. Lanes per phase with a "now" line, then a 16-line event tape and a ledger footer. |
| `B2-recorder-wide-stop.png` | B, wide, stop | probe-2 at 2:20. Step-failed stop. The chart and a "same step, three times" block show RED r1 to r3 each exiting 0. |
| `B3-recorder-band-stop.png` | B, narrow band, stop | probe-2. The same stop in three rows, with the whole run compressed into one strip. |
| `C1-glance-band-running.png` | C, narrow band, running TDD | t52-nf-6 at 2:35. One row: phase, step and its age, strip, time, agents, commits, "not needed". |
| `C2-glance-wide-needs-you.png` | C, wide, needs-human | covered-open-1 at 0:52. G:scenarios held before any test exists. Big block letters and one sentence. |
| `C3-glance-band-done.png` | C, narrow band, finished | t52-nf-6. Done in one calm row. |
| `L1-panel-wide-needs-you-light.png` | A, wide, needs-human, light | e-open-1 at 3:14, A in the light theme. The hold is the loudest thing on screen. |

## Made-up values

- **Tokens and cost**: every token count and dollar figure (A1, A2, A3, C2, C3, L1). All recordings have `spend.tokens: 0, tokensKnown: false`, so today the mod could only show "not recorded", which B1 and B2 do.
- **Lenses and findings**: lens names come from the D8 lens map (safety-net: code, tests, corpus misalignment), but no lens has run. Survivor, refuted and unrefuted counts, course checker verdicts, rollbacks and "attempts n of 5" are all made up (A1, A2, L1).
- **Plan and tracer tree**: the whole tree in A2 (`cart-pricing.md`, T1 to T3) is invented. No recording has a plan, so A1 says "no plan".
- **Publish state**: every "unit local / no PR / G:publish next" line. Publish does not exist yet.
- **Interface details**: the "press d for the full dashboard" key in C2, and the "answer in the chat" hint.
- **Reading of the stop**: "the bug may already be fixed for 0%" in B2 is an interpretation, not recorded.

## What the recordings taught

- **Agent counts.** `ledger.spend.agents` only moves at stage end and counts one fewer agent per stage than the spawns do. code-scenarios spawns 2 agents and the ledger records 1. A live count must come from `agent.spawn`, which D11 already lists. The images use spawn counts while a stage is running.
- **Retries.** probe-2 stopped with `retries{}` empty after three RED rounds. The attempt count shown has to come from the `r<n>` in the labels, not from the ledger.
- **REFACTOR in bug_fix.** bug_fix runs show no REFACTOR step, so the strip needs a "not in this task type" state, not an empty cell.
- **Covered tests.** "Covered" is a common outcome (3 of 4 tests in e-open-1 and g-open-1) and needs a glyph of its own. The images use a cyan ◌ for it.

## Re-rendering

`src/` holds the generator: a character grid emitted as HTML in JetBrains Mono, rendered by headless Chrome. Run `python3 src/mocks.py <outdir> [name-filter]`.
