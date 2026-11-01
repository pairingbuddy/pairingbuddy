# P20: mod capabilities

Four checks in one session: `import` of shared code, `$.fs` polling, toast and sound, and capturing pane frames. About 10 minutes. Make the terminal at least 150 columns wide, because a pane opened unasked waits below that. Turn your speakers on.

`tmux` and `asciinema` are not installed, so this tries two built-in macOS tools: `script` and `screencapture`.

## Setup

```sh
uv run python tests/probes/human/lab.py setup P20
```

Copy the printed path. Then start the session under `script`, replacing `<start.sh>`:

```sh
script -q /tmp/pb-p20.typescript sh <start.sh>
```

## Steps

1. Look for the **pbmod** pane. It shows `shared-node import ok` and `state: waiting`.
2. From a second terminal, take a still. Click the session window when asked:

   ```sh
   screencapture -w /tmp/pb-p20.png
   ```

3. In the session prompt:

   ```
   !echo running > "$PROBE_DIR/state.txt"
   ```

   Within about 2 seconds the pane should show `state: running`, with no prompt from you.

4. Then:

   ```
   !echo stop > "$PROBE_DIR/state.txt"
   ```

   A toast `pbmod: run stopped` should appear, and you should hear a short tone.

5. Type `/exit`. Then:

   ```sh
   uv run python tests/probes/human/lab.py show P20
   grep -a -c 'shared-node import ok' /tmp/pb-p20.typescript
   ```

## Observe

The `mod.log` section, the `grep` count, and whether `/tmp/pb-p20.png` shows the pane.

## PASS

Score each one on its own:

- **Import:** `mod.log` starts with `import: shared-node import ok`.
- **Polling:** `mod.log` has `poll saw: running`, and the pane updated by itself.
- **Toast:** you saw it. **Sound:** you heard it, and `mod.log` has `audio.play resolved`.
- **Capture:** at least one tool holds a readable pane frame. `script` counts if `grep` finds the text at least once. `screencapture` counts if the image shows the pane.

Any `poll error:` line in `mod.log` is a FAIL for polling. If the pane never appears, report the column width and mark the pane checks INCONCLUSIVE.

## Report back

One result for each of the five checks, and which capture tool you choose.
