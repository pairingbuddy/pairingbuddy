# Workflow Platform Spike

Date: 2026-10-30. Claude Code 2.1.314. Two headless runs of a throwaway plugin
(`claude -p --plugin-dir`, Haiku), the second under `--permission-mode auto`.
Not tested: an interactive session, and a marketplace-installed plugin.

| # | Question | Result |
|---|---|---|
| U1 | Can stage order be enforced? | Yes. A `tool.call` deny on `Workflow` stopped the stage and returned the reason to the model. An `agent.spawn` deny makes `agent()` throw `Workflow agent spawn denied by a plugin: <reason>`, and a script can catch it. |
| U2 | How do results cross stages? | A workflow agent wrote a file in the target project under auto mode, so a ledger written by a CLI through an agent's Bash is viable. |
| U3 | What can a mod see? | `agent.spawn`: `subagentType`, label as `description`, `workflow.runId`, `agentIndex`, full prompt; its result gives `agentId` and model. `tool.call`: every workflow agent's tools, tagged with `agentId`, including `StructuredOutput` with the agent's whole return. `turn.complete`: per-agent `usage`. `log()` and `phase()` did not appear in any of those three events; stream-json `task_progress` carries `Phase: label`. |
| U4 | Does `agentType` honour plugin agents? | Yes. `pbspike:echoer` ran, and its frontmatter skill was preloaded. A plain `agent()` did not have that skill. |
| U5 | Do shell hooks fire for workflow agents? | Yes. `PostToolUse` and `SubagentStop` fired with `agent_id` and `agent_type`. |
| U6 | Do workflows and mods work under `claude -p`? | Yes, with `--plugin-dir`. The Workflow call returns at once; the model reports when the completion notification arrives, as a second result in the stream. |
| U7 | Can scripts share code? | `import` no: the script is not loaded and the workflow reports "not found", so shared code needs a build step that emits self-contained scripts. `workflow('plugin:child', args)` works, one level deep. |
| U8 | Does auto mode stall workflow agents? | No. Bash, including a file write, ran without a prompt under auto mode. |

## Other facts

- `CLAUDE_PLUGIN_ROOT` is not set in a workflow agent's Bash, so an agent cannot
  find a plugin CLI by that variable. The path must arrive through workflow args
  or a mod's prompt rewrite. A rewrite of `prompt` and `model` applies to workflow
  agents.
- Workflow agents run from the session's working directory.

## T0 probe results

Raw recordings stay outside the repo, in the directory `PROBE_RECORDINGS` named for
that run. Run a probe with `python3 tests/probes/run_probe.py <ID>`. A re-run adds a
row, and the latest row for a probe stands.

| Probe | Claude Code | Date | Who | Result | Evidence | Recording | Resulting change |
|---|---|---|---|---|---|---|---|
<!-- probe-results-end -->
