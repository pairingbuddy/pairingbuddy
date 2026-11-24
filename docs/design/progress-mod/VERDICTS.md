# Mod verdicts

## Task 108 (plan tree view): accepted, 2026-11-24

Judged from the frames of a scripted S6 run (two units, a [HUMAN] task, a killed and adopted session), replayed through the fixed pane at 140 and 60 columns, then from frames of the real 150-task plan. Verdict in the user's words: "the way to go is the show around the task being built, with a fixed height, and some form of ellipsis signs on both or one end as needed. [...] anything unbounded will eventually break. Everything needs explicit limits/bounds. Then, to see the full plan, being able to open an HTML, as we do with the report, is the way to go. [...] the direction is good."

What it settled, and is now in DIRECTION.md:

- The PLAN block has a fixed most rows (24), a window around the task being built, else the next unticked one.
- A cut end gets one `…` row with a count; nothing grows with the plan, commits and plan problems included.
- `/pb-plan` opens the whole plan as a page, as `/pb-report` opens the report.

## Task 62 (live TDD view) and Task 87 (lens view): accepted, 2026-11-21

Accepted after the watched lab sessions of 2026-11-17 to 2026-11-20, where the pane, band and report were judged from screenshots, round by round. Verdict in the user's words: "The pane is ok as it is to start with, I'll learn more by using it for real on the experimental installation."

What those sessions settled, and is now in DIRECTION.md:

- GOAL and STATUS lead; every row is always drawn, in the same order and colours.
- No buttons in the pane; typed commands only (`/pb`, `/pb-report`).
- The report looks like the pane and leads with what the human needs: NEEDS YOU, DONE, material changes of plan or scope; the rest sits under a closed "How it ran".
- No notes mid-task: `/pb-note` was removed, since a note reached whichever agent started next.
- A standing permission prompt reads as NEEDS YOU, and its wait is not counted as spent time.

Next feedback comes from real use on the experimental channel.
