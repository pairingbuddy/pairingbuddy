# P6: a mode switch appears in the next payload

The skip-permissions half passed under `-p`. This is the switch by hand. About 4 minutes.

## Setup

```sh
uv run python tests/probes/human/lab.py setup P6
```

Paste the line it prints. The session starts in default mode.

## Steps

1. Paste this prompt, and approve the Bash dialog with the option that allows it once:

   ```
   Run the Bash command `echo before-switch`.
   ```

2. Press Shift+Tab until the footer shows **auto** mode. If auto is not offered, stop on **accept edits** and say so.
3. Paste this prompt:

   ```
   Run the Bash command `echo after-switch`.
   ```

4. Type `/exit`.

```sh
uv run python tests/probes/human/lab.py show P6
```

## Observe

The `mode=` value on the `before-switch` and `after-switch` lines.

## PASS

`before-switch` shows `mode=default`, and the first payload after the switch shows the new mode.

FAIL: `after-switch` still shows `default`. INCONCLUSIVE: the mode could not be switched.

## Report back

The two `mode=` values, and which mode you switched to.
