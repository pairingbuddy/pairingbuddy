# P13: default mode, and denies under skip-permissions

Two sessions. About 8 minutes.

## Part A: default mode

```sh
python3 tests/probes/human/lab.py setup P13A
```

Paste the line it prints, then paste this prompt:

```
Call the Workflow tool with name `pbprobe:stage1`. Wait for it to finish, then stop.
```

Approve every dialog, once each, and count them. Note what each one asked. If nothing has moved for 2 minutes, write that down. Type `/exit` when it is done.

```sh
python3 tests/probes/human/lab.py show P13A
```

## Part B: skip-permissions

This runs in the lab's temp repo, with a prompt that does nothing else.

```sh
python3 tests/probes/human/lab.py setup P13B
```

Paste the line it prints, accept the skip-permissions warning if shown, then paste this prompt:

```
Call the Workflow tool with name `pbprobe:gated`. Then run the Bash command `echo pb-deny-me`. Report both outcomes. Do not retry.
```

Type `/exit`.

```sh
python3 tests/probes/human/lab.py show P13B
```

## PASS

- Part A: the workflow finished, `show` lists `stage1.done`, and any dialog could be answered. No stall.
- Part B: both calls were denied with `PROBE-DENY`, and the `mode=` value is `bypassPermissions`.

FAIL: part A stalls or an agent's dialog never reaches you, or part B runs either call. Report each part separately.

## Report back

Part A's dialog count and whether it stalled. Part B's two outcomes.
