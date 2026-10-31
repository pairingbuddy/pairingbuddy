# P4: `!` commands bypass PreToolUse

**No fallback.** D4 depends on this. About 3 minutes.

The fixture hook denies any Bash call containing `pb-bang`, so a `!` command that passes through PreToolUse would be blocked.

## Setup

```sh
python3 tests/probes/human/lab.py setup P4
```

Paste the line it prints.

## Steps

1. Type these in the session prompt, one at a time. Each starts with `!`.

   ```
   !echo pb-bang
   ```

   ```
   !pwd
   ```

2. Paste this prompt, as the control:

   ```
   Run the Bash command `echo pb-bang`. Do not retry if it fails.
   ```

3. Type `/exit`.

```sh
python3 tests/probes/human/lab.py show P4
```

## Observe

- Step 1 prints `pb-bang` on screen, and `pwd` ends in `/repo`.
- The `show` output has one `PreToolUse Bash` line for `echo pb-bang`, from the control. It has none for `pwd`.

## PASS

Both `!` commands ran, `pwd` is the lab's repo, no `PreToolUse` line exists for them, and the control was denied.

FAIL: a `!` command was blocked, a `PreToolUse` line exists for one, or `pwd` is elsewhere. INCONCLUSIVE: the control was not denied, since then the hook proved nothing.

## Report back

The path `!pwd` printed, and whether the control was denied.
