# T4a smoke results

Task 59, requirement R6: the first-pane smoke. The agent runs the headless S2 runs and fills the first table before the human session. The human then follows `tests/smoke/T4A-RUNBOOK.md` and the second table is filled from the captures saved here.

## Headless S2

Each run records to `t59-<name>`. Run with `node tests/smoke/s2.mjs` on Haiku on 2026-11-04. Recordings are local only (`tests/smoke/recordings/` is gitignored).

| run | plugin dir | result | cost | seconds | recording |
| --- | --- | --- | --- | --- | --- |
| healthy | this worktree | PASS | $0.054 | 132 | t59-healthy |
| broken load | broken copy (load) | PASS | $0.044 | 160 | t59-broken-load |
| broken render | broken copy (render) | PASS | $0.048 | 171 | t59-broken-render |

### Evidence the break bites

- `claude plugin test .` on the load-broken copy: 88 of 89 mod tests fail with "pairingbuddy: hooks module did not load: Error: pairingbuddy-broken-copy".
- A `claude -p --debug` session on the load-broken copy logs that same line and still answers.
- The S2 run used the copy's own `cli/pb.mjs`.

### Limit

Headless `-p` draws no UI, so render mode is only exercised for real in the human session (runbook Part B).

Commands:

- healthy: `node tests/smoke/s2.mjs --recording t59-healthy`
- broken load: `node tests/smoke/s2.mjs --recording t59-broken-load --plugin-dir <copy>`
- broken render: `node tests/smoke/s2.mjs --recording t59-broken-render --plugin-dir <copy>`

How a broken copy is made: `tests/smoke/broken-plugin.mjs` has no CLI and `tests/smoke/t4a-lab.mjs` only builds whole labs, so call `makeBrokenCopy` directly. It prints nothing, so print the returned path:

```sh
node -e 'import("./tests/smoke/broken-plugin.mjs").then(m => console.log(m.makeBrokenCopy({ mode: "load" })))'
node -e 'import("./tests/smoke/broken-plugin.mjs").then(m => console.log(m.makeBrokenCopy({ mode: "render" })))'
```

Use the printed directory as `<copy>`.

## Captures

Filled after the human session.

| file | part | columns | theme | moment |
| --- | --- | --- | --- | --- |

## Human session 1 findings (2026-11-04, A1 only, 167 columns, dark)

Lab `20261104-101059`, healthy, auto mode. The run passed (3 commits). Session paused after A1 to fix these first.

1. **`/pb` errors.** "pairingbuddy registered /pb but no command.run hook answered it". The pane still opened. Fixed.
2. **Pane shows the wrong steps after the run.** With the run closed, the pane listed "make the config change" and "safety-net review" (config-change steps on a bug fix), with "NOW unknown" beside "SPENT 15 agents". Fixed.
3. **Report and suggest are gone once the run ends.** `pb task end` removes `.pairingbuddy/run/task`, so the pane has no ledger at the moment the report matters; `show` reads "ledger: no ledger yet", "reports: none". Fixed.
4. **Band segments run together.** "build test by test1:09 · 6 agentsleft: unknownlooping: unknownoff track: unknownneeds you: no[ ▸ details ]". Fixed.
5. **The band button can't be reached.** A mouse click did nothing in this terminal, and ctrl+x then tab did not focus the band. Fixed: `/pb` replaces the click.
6. The "Run a dynamic workflow?" dialog showed once per stage even in auto mode (known since P18B). Known platform behaviour, not fixed here.

## Human session 2 findings (2026-11-04, A1, 167 columns, dark)

Lab `20261104-105144`, healthy, auto mode, run passed (3 commits). Fixes 1-4 confirmed live: `/pb` answers, the pane lists the bug_fix steps, the band is separated, and after `pb task end` the pane and band read "last run finished" with open report kept.

7. **Band says "idle" while a run is open between stages** (after `pb run open`, at gate checks), and then disagrees with the pane, which shows NOW "build test by test". **Fixed: the band says "between steps · next: …" or "run open".**
8. **LEFT stays "unknown" and there is no "test 1 of 1"** during a real one-test bug_fix run. **Fixed: tests come from the ledger, "test N", LEFT unknown until the total is known.**
9. **The pane takes no keys.** Opened by `/pb`, pressing `s` typed into the prompt, so `r open report`, `s suggest` and `dismiss` cannot be pressed. **Fixed: `/pb` and details open the pane with focus (`r`, Tab to suggest, Esc).**
10. **No colour.** The mockups (rounds 4-5) lit the current step and coloured ticks and needs-you; the mod draws only plain and dim text. **Fixed: theme-key colour on current step, ticks, needs-you, stop, unknowns and spend.**

## Human session 3 (2026-11-04, 167 columns, dark)

All five parts run. Fixes 7-10 confirmed live: the band reads "between steps · next: …", `/pb` opens the pane with focus (Tab walks it, `r` opened the report in the browser), steps and ticks are coloured.

| Part | Lab | Result |
|---|---|---|
| A1 healthy, auto | `20261104-152106` | PASS. Report opened: DONE, steps with times, real commits |
| A2 `--ask`, sound on | `20261104-220231-ask` | PASS. Alert heard at both gates, pane opened by itself, yellow status "needs you: your OK on the scenarios"; gates approved by typed `!` |
| A3 `--ask --sound off` | `20261104-221135-ask-quiet` | PASS. No sound; pane and status still shown |
| B1 `--broken load` | `20261104-221447-broken-load` | PASS. Notice "hooks module did not load: Error: pairingbuddy-broken-copy", no band, `/pb` unknown, run completed (3 commits, task end) |
| B2 `--broken render` | `20261104-221833-broken-render` | PASS. Band kept working; `/pb` gave "ui.render hook skipped: threw Error: pairingbuddy-broken-copy" and an empty pane box; run completed |

Findings:

11. **Pane focus is lost after switching windows.** Tab stopped walking the pane after the terminal lost and regained focus; `/pb` again is the workaround. The pane can lose keyboard focus when the terminal window loses focus; this is platform behaviour, as the reference documents no event for the window regaining focus. Typing `/pb` again restores it.
12. **The pane's NOW row repeats the band label.** "NOW Pairing Buddy · run open" and "NOW Pairing Buddy · between steps · …"; and with every step done it should say so, not "run open". Fixed: NOW drops the band prefix and reads "all steps done" before task end.
13. **The report says the test was "not reached" when it passed.** The TESTS card shows `apply-discount-100-by-10-percent` (likely an id from another source than the ledger's perTest key). Fixed: the report takes test results from the ledger.
14. **Report header and columns.** "time unknown" in the header and SPENT while steps have times; two unlabelled "unknown" columns in STEPS; "WHERE IT IS safety-net review" on a finished run. Fixed: run time comes from when the mod saw the run end, STEPS columns are labelled, a done run reads "finished".
15. **Band does not lead with needs-you while a gate waits.** It read "between steps · next: build test by test" at the scenarios gate; the needs-you state should win, in the warning colour, in band and pane. Fixed: band and NOW lead with needs-you while a gate waits.
16. **The needs-you status line stays after the gate is answered**, including after the run ended. Fixed: the status line clears when the gate is answered, the run ends, or a new run starts.
17. **PreToolUse:Workflow rejects a symlinked pluginRoot** (`/private/var/…` vs `/var/…`): the check compares strings, not real paths. Outside the mod; seen only because the broken copy lives under `/var/folders`. Fixed: the pluginRoot check compares real paths.

## Human session 4 (2026-11-05, round 4)

Lab `20261105-102731-ask` (`--ask`). The fixes from round 3 held live:

- Needs-you showed at both gates, and the alert beeped at both.
- The status line cleared after each approval, and NOW carried no band prefix.
- `/pb` opened the pane with focus, and `r` opened the report.
- The report read "finished" with real results and labelled STEPS columns.

New findings, all fixed:

A. **The report shows no run time after the run ends.** Cause: the poller passed an unawaited `$.clock.now()` promise to `new Date`, so the ended-at time was never saved. Fixed: the poller awaits the clock, and the ended pane and the report measure to the same end time.
18. **A signed-off run still asks for sign-off.** The report's WHAT YOU CAN DO kept asking after `G:task-end` was approved. Fixed: it no longer asks once the gate is approved.
19. **Test cards lack headings and show empty columns.** Fixed: each card has column headings, drops columns unknown on every row (Total, Writing, Running, Commit), and a not-reached card draws no empty table.
20. **The report title loses the break between description and context.** Fixed: the title keeps the break.
21. **The status line repeats the plugin name.** It read "Pairing Buddy needs you: …" beside the plugin's own name. Fixed: the status line shows the plain gate or stop words.

## Human session 5 (2026-11-05, round 5 re-check)

Lab `20261105-122313` (auto mode). Passed live: the report run time of 1:51 matched the pane, card headings with all-unknown columns were dropped, and the title break held.

New findings, all fixed:

18b. **The report still asks for sign-off after an auto-passed task-end gate.** Fixed: the report uses the same gate-passed rule as the CLI (`shared-node/gate-passed.mjs`), so an auto-passed gate counts as passed.
22. **The band merges with the transcript** (the human's visual feedback). Fixed: a dim rule above the band separates it.
23. **A report opened mid-run shows no elapsed time.** Fixed: it shows elapsed time to now, like the pane.
