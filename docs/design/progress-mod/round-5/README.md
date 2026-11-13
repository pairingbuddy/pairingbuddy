# Progress mod, round 5

Round 5 has two parts. The cycle shrinks to a marker on the test's own line, and the pane gains an HTML report for depth. Markings follow round 4: a dotted magenta underline means invented, and a dotted cyan underline means borrowed from `docs/plans/deterministic-workflows.md`.

| Image | What it shows |
|---|---|
| `R5-1-pane-tdd-calm.png` | R4-2 again, g-open-1 at 1:55. The cycle line and the "next:" line are gone. The test's name line now ends with `●RED ›GREEN  5.1s`, and in a bug fix there is no REFACTOR. The test id and selector share one dim line. |
| `R5-2-pane-tdd-looping.png` | R4-3 again, probe-2 at 2:10, with the same change. |
| `R5-3-report-tdd.png` | The run report for probe-2 after the stop, in a browser window. It opens with the five answers and what you can do. Each test follows with every try, its result, and why it looped. The steps with times and the commits come last. |
| `R5-4-report-plan.png` | The planning report: aim, at a glance, the decision log (when, why, and where each came from), questions (open and answered), the 14 slices so far, and the 28 requirements. |
| `R5-5-pane-report-button.png` | R5-2 with `r open report` focused and pressed. The pane confirms "wrote report.html · opened in your browser". |

## What is real in the reports

- **TDD report (probe-2).** Every time, duration, exit code and commit is from the recording. So are the 16 agents and the stop reason. OFF TRACK reads "no" here, which is the true value. The "yes" in R5-2 stays an invented demo of the lit state.
- **Invented in the TDD report.** The date, the repo path, the file name, the % of plan, the short test names, and the reading "most likely 0% was never broken".
- **Plan report.** The decisions, their reasons, the questions, the slice names and goals, and the requirement wording are borrowed and reworded plainly. All times, statuses and counts are invented.
- **Correction.** Rounds 3 and 4 said 30 requirements. The plan has R1 to R28, and the extra 2 came from two follow-up lines in the plan. The count is 28: 21 must, 5 should, 2 could.

## Build findings

- **Opening a report.** `$.fs.write` writes the page and `$.process.run(['open', path])` opens it. The page must be self-contained, with inline CSS and no network.
- **Where reports live.** R5 removes run state at task end, so reports can't go in the run directory. They need a kept location, such as `.pairingbuddy/reports/`, and that is a new persisted file type R5 would have to allow. The R23 run-history question has the same problem.
- **The TDD report's sources.** It needs per-try timing and exit codes, which come from labels plus runner evidence (as in round 3). Commit messages come from git, or from the ledger if checkpoints recorded them.
- **The plan report needs the decision and question log** described in round 3's findings. Nothing writes it yet.

`src/mocks.py` is new. `base.py`, `r3.py` and `r4.py` are earlier rounds, unchanged. Run `python3 src/mocks.py <outdir> [name-filter]`.
