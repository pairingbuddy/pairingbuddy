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
