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
