# Human probes

Eight probes need a person at an interactive session. Allow about 50 minutes for all of them, on Claude Code 2.1.316. Sessions use Haiku, so spend is cents.

## Before you start

- Open a normal terminal, at least 150 columns wide, in this worktree.
- Task 2 must be done for P19: the B-old checkout exists at tag `v0.7.0`.
- Optional: `export PROBE_RECORDINGS=<dir>` to keep recordings somewhere other than the temp directory.

Each runbook has the same shape. `lab.py setup` prints one `sh .../start.sh` line. Paste that line, follow the steps, exit the session, then run `lab.py show`. Paste the `show` output back with the one thing the runbook asks for. Only you see dialogs, so note them as they happen.

Nothing here changes this worktree, the installed plugin or your user settings. P12 uses a throwaway `CLAUDE_CONFIG_DIR` inside its lab, so it asks you to log in once.

## Order

| # | Runbook | Time | Why here | If it fails |
|---|---|---|---|---|
| 1 | [P3 AskUserQuestion answer](P3-ask-user-question.md) | 3 min | Warm-up | Every human gate uses `!` |
| 2 | [P4 `!` commands](P4-bang-commands.md) | 3 min | **No fallback.** Do it early | Stop and flag: re-plan D4. P3 and P4 both failing leaves no answer route |
| 3 | [P6 mode switch](P6-mode-switch.md) | 4 min | | Solo uses its env var |
| 4 | [P13 default mode, skip-permissions denies](P13-default-mode.md) | 8 min | | Recommend auto mode |
| 5 | [P18 auto-allow, allowed-tools](P18-auto-allow.md) | 8 min | | Recommend auto mode |
| 6 | [P12 marketplace install](P12-marketplace-modules.md) | 8 min | Login happens here | Separate mod plugin |
| 7 | [P19 builder setup](P19-builder-setup.md) | 6 min | Part 2 reads P12's lab | Disable the marketplace plugin in the builder |
| 8 | [P20 mod capabilities](P20-mod-capabilities.md) | 10 min | Needs the widest terminal | Inline code; toast and status for alerts |

A FAIL on P4 is the only reason to stop early. Carry on through any other FAIL.

## Reporting

For each probe, give PASS, FAIL or INCONCLUSIVE, the one thing its runbook asks for, and the `show` output. Task 16 records these exactly as you report them. If what you saw matches neither PASS nor FAIL, say INCONCLUSIVE and describe it.

## Not on this list

P8 has no human step. Its open point is whether a read-only agent can reach the deferred `advisor` tool, and a real session gives no more evidence on that than a `claude -p` recording of the same agent's API request.
