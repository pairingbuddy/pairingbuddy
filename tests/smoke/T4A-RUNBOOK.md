# T4a: first pane, human smoke

Watch the progress mod (band, pane, alert, report button) in one healthy run and two broken ones. About 30 minutes. Cost about $1 on Haiku.

## Setup

- Open a terminal about 150 columns wide, in this worktree. Turn your speakers on.
- The headless S2 runs are done by the agent, not you, before this session: the healthy run and the two `--plugin-dir` broken copies (load and render), all through `node tests/smoke/s2.mjs`. The agent fills the results table in `docs/design/progress-mod/t4a-smoke/README.md`. This runbook covers what only a person can judge: how it looks, what you hear, and what the buttons do.
- Screenshots: cmd-shift-4, then space, then click the window. Or `screencapture -w <file>.png`.
- File names: `<part>-<cols>-<theme>-<moment>.png`, for example `A-150-dark-running.png`. Save them in `docs/design/progress-mod/t4a-smoke/`.
- Pane rules to know: it docks from 110 columns. Below 144 it waits until you ask (click `details` on the band, or `/pb`). Below 110 the band stays inline and there is no dock.

## Steps

### Part A1: healthy, auto mode

1. Run `node tests/smoke/t4a-lab.mjs setup`. Paste the `sh` line it prints. The session starts `/pairingbuddy:code <S2 task>` by itself and its gates pass on their own.
2. At about 150 columns, dark theme, take a shot while the run is **running**. Name it `A-150-dark-running.png`.
3. Run `/theme`, switch to light, and take the same shot: `A-150-light-running.png`.
4. Drag the window to about 110 columns. The pane should wait; open it with `details` on the band. Shot in each theme: `A-110-dark-running.png`, `A-110-light-running.png`.
5. Drag to about 80 columns. The band shows inline and there is no dock. Shot in each theme: `A-80-dark-running.png`, `A-80-light-running.png`.
6. Go back to about 150 columns, dark theme. In the pane, press `s` and type a short suggestion. It should say `applies at the next agent spawn: <agent>`, and later `delivered to <agent>`.
7. Press **open report**. A report page should open in the browser. Capture it: `A-report-dark-done.png`.
8. When the run is **done**, take `A-150-dark-done.png`.
9. Type `/exit`, then run `node tests/smoke/t4a-lab.mjs show`.

### Part A2: needs-you gate, alert sound on

10. Run `node tests/smoke/t4a-lab.mjs setup --ask`. Paste the `sh` line. The session starts in acceptEdits mode, so the gates ask a human.
11. At about 150 columns, dark theme, wait for the first gate. You should **hear the alert** once, and the pane should open by itself with the band reading "needs you". Take `A-150-dark-needs-you.png`.
12. Answer the gate by typing the `!` command the session names. Let the run finish.
13. Type `/exit`, then run `node tests/smoke/t4a-lab.mjs show`.

### Part A3: needs-you gate, alert sound off

14. Run `node tests/smoke/t4a-lab.mjs setup --ask --sound off`. Paste the `sh` line. It passes a settings file that sets alertSound false.
15. At about 150 columns, wait for the first gate. The pane should open and the band should read "needs you", with **no sound**. Take `A3-150-dark-needs-you.png`.
16. Answer the gate by typing the `!` command the session names. Let the run finish.
17. Type `/exit`, then run `node tests/smoke/t4a-lab.mjs show`.

### Part B: broken

18. Run `node tests/smoke/t4a-lab.mjs setup --broken load`. Paste the `sh` line. Let the run go on through its gates. Take one shot: `B-150-dark-load.png`. `/exit`, then `node tests/smoke/t4a-lab.mjs show`.
19. Run `node tests/smoke/t4a-lab.mjs setup --broken render`. Same as step 18. Shot: `B-150-dark-render.png`.

## Observe

- Pane and band at each width and theme: readable, nothing cut off, nothing overlapping the prompt.
- The plain-language bar: no gate, stage or agent ids on screen. Rows read as sentences.
- The alert: one sound at the needs-you moment in A2, and none in A3 where alertSound is off. The toast still shows in A3.
- Report button and suggestion input do what they say.
- Part B: the run and its gates go on as normal. No pane, or a refused-pane notice. No crash or hang.

## PASS

Score each on its own:

- **Layout:** pane docks at about 150 and about 110 (the latter after you ask), band is inline at about 80, in both themes.
- **Alert:** heard once at needs-you in A2; silent in A3 where alertSound is off.
- **Report:** the button opens a report page that matches the run.
- **Suggestion:** the note is accepted and names the next agent.
- **Broken load and broken render:** each run finishes its gates normally with no pane, or a notice that the pane was refused.
- **`show`:** commits after base, a ledger line, and the reports it lists make sense for the run.

## Report back

One of PASS, FAIL or INCONCLUSIVE for each check above. The `show` output for each run. The screenshots, named as above and saved in `docs/design/progress-mod/t4a-smoke/`. Anything on screen you could not read at a glance.
