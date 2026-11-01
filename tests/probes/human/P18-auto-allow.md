# P18: hook auto-allow, and `allowed-tools Workflow(...)`

Two sessions from one lab. About 8 minutes. Only you can see dialogs here, so count them. Always pick the option that allows **once**, so nothing is remembered.

## Setup

```sh
uv run python tests/probes/human/lab.py setup P18
```

Note the printed line. You paste it twice.

## Part A: hook auto-allow

Paste the line, then type:

```
/pbprobe:runner-allow
```

Note whether a dialog appeared for each of: the Workflow call, `touch .probe/pb-runner-cmd`, `touch .probe/pb-control-cmd`. Approve what appears. Type `/exit`.

## Part B: allowed-tools

Paste the line again. Type:

```
/pbprobe:allowed
```

Note whether a Workflow dialog appeared. Then type this control:

```
/pbprobe:open
```

Note whether a dialog appeared. Type `/exit`.

```sh
uv run python tests/probes/human/lab.py show P18
```

## PASS

- Part A: no dialog for `pb-runner-cmd`, and a dialog for `pb-control-cmd`.
- Part B: no dialog for `/pbprobe:allowed`, and a dialog for the control.

FAIL: a dialog for `pb-runner-cmd` or `/pbprobe:allowed`. INCONCLUSIVE: a control showed no dialog, since then the allow proved nothing. Report each part separately.

## Report back

Yes or no for each of the five dialogs above.
