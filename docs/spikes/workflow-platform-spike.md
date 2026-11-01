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
that run. Run a probe with `uv run python tests/probes/run_probe.py <ID>`. A re-run adds a
row, and the latest row for a probe stands.

| Probe | Claude Code | Date | Who | Result | Evidence | Recording | Resulting change |
|---|---|---|---|---|---|---|---|
| P1 | 2.1.316 | 2026-10-31 | auto | PASS | PreToolUse saw name and args=True; deny reason reached the model=True; gated never started=True; open control started=True | `$PROBE_RECORDINGS/P1/20261031-133144` | T1b blocks at the boundary |
| P2 | 2.1.316 | 2026-10-31 | auto | PASS | PreToolUse fired in workflow agents, agent_type values ['pbprobe:echoer', 'workflow-subagent']; agent_id and agent_type paired=True; 4 denied attempts, 0 executed | `$PROBE_RECORDINGS/P2/20261031-133409` | Runner rule, subagent denies and lens confinement stand |
| P8 | 2.1.316 | 2026-10-31 | auto | PASS | reader tool events ['Read', 'StructuredOutput']; StructuredOutput returned the file=True; forbidden tools fired=[]; files written=[]; tools loaded in the agent's API request ['Glob', 'Grep', 'Read', 'StructuredOutput']; deferred entries in that request ['advisor'] (no ToolSearch to load them) | `$PROBE_RECORDINGS/P8/20261031-133425` | D8 stands |
| P9 | 2.1.316 | 2026-10-31 | auto | PASS | caught form returned {"threw": true, "error": "Error: agent({agentType}): agent type 'pbprobe:does-not-exist' not found. Available agents: claude, Explore, general-purpose, pbprobe:; uncaught status=failed summary=Dynamic workflow "Unknown agentType with no catch" failed: Error: agent({agentType}): agent type 'pbprobe:does; agents spawned=0 | `$PROBE_RECORDINGS/P9/20261031-133434` | Records behaviour: an unknown agentType throws and no agent runs |
| P5 | 2.1.316 | 2026-10-31 | auto | PASS | Stop fired 4 times, blocked 1; next-action text in stream=True; gate script ran=True; workflows [('stage1', 'completed'), ('stage2', 'completed')]; both stages ran=True; exit=0 | `$PROBE_RECORDINGS/P5/20261031-133517` | T1d as designed |
| P7 | 2.1.316 | 2026-10-31 | auto | PASS | 3 same-type returns kept separate=True, distinct agents=4; tap held 3002-3003ms and finished before SubagentStop=True; next agent saw all artifacts=True; large return 15839 of 15839 chars, byte-equal to the source=True, tap and script agree=True | `$PROBE_RECORDINGS/P7/20261031-134416` | D3 stands |
| P10 | 2.1.316 | 2026-10-31 | auto | PASS | workflows [('resumable', 'failed'), ('resumable', 'completed'), ('resumable', 'completed')]; runIds ['wf_aa3b10ee-933', 'wf_aa3b10ee-933', 'wf_aa3b10ee-933']; first agent ran 1 times, second ran 1 times across one failed run and two resumes | `$PROBE_RECORDINGS/P10/20261031-134237` | Same-session resume in T7d |
| P17 | 2.1.316 | 2026-10-31 | auto | PASS | tool_response.runId=wf_e86eab30-6a7, status=async_launched; same id in mod agent.spawn=True and transcriptDir=True; stream run_id is a different id ['0mvwdvfn4-5d5dde71'] | `$PROBE_RECORDINGS/P17/20261031-133440` | Data flow step 4 stands. Use runId, not stream run_id |
| P6 | 2.1.316 | 2026-10-31 | auto | PASS | main-context permission_mode ['bypassPermissions'], workflow-agent permission_mode ['bypassPermissions'], payloads missing the key []. Mode switch is the human part, not run | `$PROBE_RECORDINGS/P6/20261031-134741` | D13 stands for this mode; mode switch awaits the human probe |
| P11 | 2.1.316 | 2026-10-31 | auto | PASS | expanded path in Bash text=True, literal variable left=False; marker file read=True; expanded path in Workflow args=True | `$PROBE_RECORDINGS/P11/20261031-134459` | Thin commands |
| P14 | 2.1.316 | 2026-10-31 | auto | PASS | json run: 1 result object(s), final text held the workflow result=True, total_cost_usd=0.00361598; budget.total=None, spent before=55, after=111; workflow output totalTokens=10119; mod turns=3, agent turns=1; modelUsage output tokens={'claude-haiku-5-5': 401} | `$PROBE_RECORDINGS/P14/20261031-134513` | Report as designed |
| P15 | 2.1.316 | 2026-10-31 | auto | PASS | push reached the local bare remote=True; commit has a good signature from the user's inherited SSH signer=True; gh shim got [pr create --title T --body B]; tool errors []. Local bare remote and gh shim: NOT proven: GitHub auth or network for push, real gh auth, a real PR being created, branch protection or remote hooks | `$PROBE_RECORDINGS/P15/20261031-134707` | T3b as designed, GitHub leg unproven |
| P16 | 2.1.316 | 2026-10-31 | auto | PASS | all pinned agents ran cheap under ['default-env', 'mod-rewrite']. baseline: agents {'pbprobe:pinned-opus': ['claude-opus-5-5'], 'pbprobe:pinned-sonnet': ['claude-sonnet-5-5']}, session models ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5']; subagent-env: agents {'pbprobe:pinned-opus': ['claude-opus-5-5'], 'pbprobe:pinned-sonnet': ['claude-sonnet-5-5']}, session models ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5']; default-env: agents {'pbprobe:pinned-sonnet': ['claude-haiku-5-5'], 'pbprobe:pinned-opus': ['claude-haiku-5-5']}, session models ['claude-haiku-5-5']; mod-rewrite: agents {'pbprobe:pinned-sonnet': ['claude-haiku-5-5'], 'pbprobe:pinned-opus': ['claude-haiku-5-5']}, session models ['claude-haiku-5-5'] | `$PROBE_RECORDINGS/P16/20261031-134554` | Smoke design fixed: use default-env |
| U | 2.1.316 | 2026-10-31 | auto | PASS | U1=same U2=same U3=same U4=same U5=same U6=same U7=same U8=same; CLAUDE_PLUGIN_ROOT in agent Bash: Exit code 1, no output (CLAUDE_PLUGIN_ROOT is not set in this environment); agent pwd is the repo=True | `$PROBE_RECORDINGS/U/20261031-134526` | Spike results stand on this version |
| P3 | 2.1.316 | 2026-10-31 | human | PASS | Dialog appeared; PostToolUse response held answers {"Approve this stage?": "redo"} | `human/P3/20261031-181900` | Tap records gate answers |
| P4 | 2.1.316 | 2026-10-31 | human | PASS | `!echo pb-bang` ran, `!pwd` was the lab repo, no PreToolUse line for either; model control denied. A `!` command starts a model turn and the model sees its output | `human/P4/20261031-182202` | D4 stands |
| P6 | 2.1.316 | 2026-10-31 | human | PASS | before-switch mode=default, after-switch mode=auto, switched by Shift+Tab. Covers both parts with the auto row | `human/P6/20261031-184034` | D13 stands, mode read per call |
| P13A | 2.1.316 | 2026-10-31 | human | PASS | Via `/pbprobe:stage1`: 2 dialogs, Workflow then the agent's Bash, labelled with the workflow name; no stall; stage1.done present. A first run with a prompt naming the Workflow tool did no work and reported completed, see notes | `human/P13A/20261031-184653`, first run `human/P13A/20261031-184329` | Default mode supported. Stage results are verified, never inferred from workflow status |
| P13B | 2.1.316 | 2026-11-01 | human | PASS | Workflow and Bash both denied with PROBE-DENY, mode=bypassPermissions, no markers | `human/P13B/20261101-091237` | Hooks hold under skip-permissions |
| P18A | 2.1.316 | 2026-11-01 | human | PASS | Workflow dialog yes, `touch .probe/pb-runner-cmd` no dialog, `touch .probe/pb-control-cmd` dialog yes | `human/P18/20261101-091845` | Runner auto-allow stands |
| P18B | 2.1.316 | 2026-11-01 | human | FAIL | `/pbprobe:allowed` showed the Workflow dialog despite `allowed-tools: Workflow(pbprobe:*)`; the human reported a dialog on the control too | `human/P18/20261101-092049` | Recommend auto mode. In manual mode the human approves each workflow start. Drop `allowed-tools` from the thin commands |
| P12 | 2.1.316 | 2026-11-01 | human | PASS | mod.jsonl 7 lines including spawn for stage:one, shell hooks alongside, marketplace install from a local marketplace, stage1.done present | `human/P12/20261101-092406` | Mod ships in this plugin |
| P19 | 2.1.316 | 2026-11-01 | human | PASS | Part 1: one pairingbuddy entry, the builder at 0.7.0, no errors. Part 2: hookonly-mod.log `mod loaded`, hookonly-shell.jsonl has lines. Start command: `claude --plugin-dir /Users/alberto/src/pairingbuddy/pairingbuddy-builder` | `human/P19/20261101-092922` | Builder needs no marketplace disable |
| P20 | 2.1.316 | 2026-11-01 | human | FAIL (toast only) | Import PASS. Polling PASS, pane updated by itself over two cycles. Sound PASS, heard. Toast FAIL: logged sent twice, human watched and saw none. Capture not tested: `script` skipped, `screencapture` needs a terminal restart, human screenshots used | `human/P20/20261101-093019` | Alerts rely on sound and pane. T4a captures frames with human screenshots until a tool is granted |
<!-- probe-results-end -->

Scope of the auto probes: each run used `--setting-sources project,local` and
`--strict-mcp-config`, so installed plugins and user settings were not loaded. Human
probes (P3, P4, P6 mode switch, P12, P13, P18, P19, P20) ran in interactive sessions,
and their Recording paths are under the lab directory, not `$PROBE_RECORDINGS`.

### Notes from the recordings

- P7: the first attempt asked one agent to repeat a line 400 times (about 27 KB). The
  agent hit the output token limit before it returned, and the run timed out, so that
  attempt says nothing about the tap. The recorded result is a 15.8 KB return copied
  from a file. Returns above that size are untested.
- P8: the agent's API request also listed `advisor` with `defer_loading: true`, which
  `tools:` did not grant. The agent had no ToolSearch and listed only its four tools.
  Whether it could reach `advisor` anyway was not tested. Bash, Write and Edit were absent.
- P2: a plain `agent()` reports `agent_type` as `workflow-subagent`. The main context has
  neither `agent_id` nor `agent_type`.
- P1, P2: the model sees a deny as `PreToolUse:<Tool> hook error: <reason>`, with
  `is_error` true.
- P10: resume worked by `name`, with no `scriptPath`. The resumed run keeps the same
  runId. Changing `args` on resume still reused the cached first agent, so resume alone
  does not separate a changed argument. A changed script was not tested.
- P14: `budget.spent()` counts main-loop output too (55 before the agent ran). `modelUsage`
  and `total_cost_usd` include workflow agents: in P16 they listed the opus and sonnet
  agents' models.
- P15: the gh shim also received `pr view --json url` from a call the model did not make.
- P16: all 29 agents pin by alias (`opus`, `sonnet`, `haiku`). `--model` and
  `CLAUDE_CODE_SUBAGENT_MODEL` did not override a pin. `ANTHROPIC_DEFAULT_OPUS_MODEL` and
  `ANTHROPIC_DEFAULT_SONNET_MODEL`, set in the child process, did, for both `agent()` and
  the Agent tool. The test-only mod rewrite also worked.
- `-p` result count: a workflow that finishes before the model's turn ends can give one
  `result` event (P1, and the `--output-format json` run in P14). Others gave two or three.
- U1-U8: no result changed on 2.1.316. `CLAUDE_PLUGIN_ROOT` is still unset in a workflow
  agent's Bash, and workflow agents still run from the session's working directory.

### Notes from the human probes

- P13A: each workflow agent receives the triggering prompt as a `[Workflow harness — user
  request]` block, marked "where the computed task conflicts with this request, this
  request wins". The script's prompt follows as text with no user authority. The auto
  probes carried the same block and those agents did the script's task. In the first
  P13A run the prompt named the Workflow tool, so the agent looked for that tool, failed,
  skipped `touch`, and the workflow still ended `completed`. Following the script is
  therefore model judgement.
- P13A: the same run with `/pbprobe:stage1` worked, and so did P12, so runbooks start
  workflows by slash command. An unexplained `true` Bash call from the main context
  errored in that run and changed nothing.
- P4, P20: a pasted `!...` line is sent to the model as a prompt, and under auto mode the
  model ran it as a normal Bash call. Only a typed `!` enters shell mode.
- P18: `echo` gets no dialog in default mode, so controls use `touch`.
- P13B: accepting the skip-permissions warning wrote `skipDangerousModePermissionPrompt`
  to `~/.claude/settings.json`. It was removed after the run.
- P20: the mod reacts to a change of state, so repeating the same value does nothing. A
  workflow that spawns no agents shows a hollow bar in the footer.
