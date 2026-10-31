# P3: AskUserQuestion answer in PostToolUse

Decides whether the tap can record gates. About 3 minutes.

## Setup

```sh
python3 tests/probes/human/lab.py setup P3
```

Paste the line it prints.

## Steps

1. Paste this prompt:

   ```
   Use the AskUserQuestion tool once. Header: "PB gate: probe". Question: "Approve this stage?". Options: approve, redo, stop. Then stop.
   ```

2. Pick **redo** in the dialog. Do not type a custom answer.
3. Type `/exit`.

```sh
python3 tests/probes/human/lab.py show P3
```

## Observe

The `PostToolUse AskUserQuestion` line in the `show` output.

## PASS

That line's response contains the answer `redo`, tied to its question or header.

FAIL: no such line, or the line has no answer. INCONCLUSIVE: the model never called the tool, or no dialog appeared.

## Report back

Whether a dialog appeared, and the `PostToolUse AskUserQuestion` line.
