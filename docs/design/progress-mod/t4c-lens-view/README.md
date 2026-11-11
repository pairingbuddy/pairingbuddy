# T4c lens view: review frames

Task 86 adds a lens block to the pane. It sits below "now building" and shows only while a review round runs, or after the run stopped because it ran out of fix attempts. The rest of the pane and the band are unchanged. These frames are for the Task 87 review; that verdict goes in this folder too.

Each frame is the lens block as the pane draws it, at 140 and 60 columns. The text is exactly what `lensLines` returns for that width, and the tag after a line is its tone: dim, warning (yellow) or error (red). Untagged lines use the normal colour.

| Frame | Moment | Source |
|---|---|---|
| `1-lens-round-*` | The three lenses have answered and the refuters are attacking the three findings. | Recorded S4 run, 136.5 s in |
| `2-rollback-*` | The first fix turned the tests red and was undone. Its retry is running. | Recorded, 158 s |
| `3-kept-fixes-*` | Two later fixes were checked and kept. The round is about to end. | Recorded, 201 s |
| `4-uncovered-*` | One lens finished without a usable answer, so it is "not covered". | Recorded, with that lens's answer taken out |
| `5-cap-stop-*` | Five fixes were undone and the run stopped at the cap. | Recorded, with five rollbacks put in (no run has reached the cap) |

The recorded run is `s4-t85-run4`, a bug fix with one rolled-back fix, committed as `mod/fixtures/replay/s4-rollback/`. The replay tests check the same block against that run's own lens record and rollback.

To regenerate the frames, run this from the repo root:

```
node docs/design/progress-mod/t4c-lens-view/src/frames.mjs
```

## What to judge

- Plain language: no stage, gate, agent, group or finding ids. Lens names are plain ("the code", "docs and plan").
- At 60 columns, the claims are cut with "…" and the spend line wraps.
- Spend is one dim line: agents against the step's cap, and output tokens only once the step has ended. There are no dollars.
- The fix numbers (fix 1, fix 2) count the fixes in the order they ran. The "undone of 5 allowed" count matches the stop.

Open choices are written up in `docs/plans/test-drive-decisions.md`, numbers 78 to 84.
