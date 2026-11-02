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

## T1c smoke spike

Question: which minimal sample task makes a cheap model finish S1 reliably within the cap?
Claude Code 2.1.316, 2026-11-02, Haiku through P16's `default-env`. Run it with
`uv run python -m tests.smoke.spike --record-dir <dir>`, and S1 alone with
`uv run python -m tests.smoke.s1`. Each run is two `claude -p` processes, one per stage, then
`pb gate eval`, `pb task end` and the model-free evidence check.

**Winner: `value`, "Change port from 8080 to 9090 in app.ini". It is now S1's default.** That is a
tie-break, not a reliability result: all three tasks went 5 of 5, and `value` won on mean cost by
$0.0004, which is inside the run-to-run spread. No task was shown to be more reliable than another.

| Task | Passed | Mean s | Max s | Mean $ | Max $ |
|---|---|---|---|---|---|
| value | 5 of 5 | 41.6 | 44.8 | 0.012613 | 0.013599 |
| flag | 5 of 5 | 42.7 | 46.4 | 0.012994 | 0.014040 |
| add-key | 5 of 5 | 52.9 | 86.1 | 0.013515 | 0.015874 |

Reliability: 15 of 15 runs passed, with no failures to report and no cap hit. That sample is small:
it puts the true pass rate above about 82% at 95% confidence pooled, and only above about 55% for
one task, so it does not yet show that S1 never flakes. All 15 ran in five rounds of three parallel
runs. The early stop did not fire, because no task failed. The spike cost $0.1956 of the $5 limit;
the session's total, with one first S1 and two cap checks, was about $0.215.

| Round | Task | Result | code-config s | code-safety-net s | Total s | Cost $ |
|---|---|---|---|---|---|---|
| 1 | add-key | PASS | 20.7 | 22.6 | 43.3 | 0.012425 |
| 2 | add-key | PASS | 16.6 | 20.1 | 36.7 | 0.011818 |
| 3 | add-key | PASS | 18.0 | 68.1 | 86.1 | 0.014039 |
| 4 | add-key | PASS | 16.2 | 33.9 | 50.1 | 0.015874 |
| 5 | add-key | PASS | 20.0 | 28.3 | 48.3 | 0.013420 |
| 1 | flag | PASS | 16.1 | 27.0 | 43.1 | 0.012884 |
| 2 | flag | PASS | 15.9 | 24.9 | 40.8 | 0.012995 |
| 3 | flag | PASS | 16.9 | 24.9 | 41.8 | 0.012996 |
| 4 | flag | PASS | 20.7 | 20.5 | 41.2 | 0.012054 |
| 5 | flag | PASS | 23.4 | 23.0 | 46.4 | 0.014040 |
| 1 | value | PASS | 21.1 | 23.7 | 44.8 | 0.013599 |
| 2 | value | PASS | 17.1 | 23.6 | 40.7 | 0.012314 |
| 3 | value | PASS | 17.4 | 22.5 | 39.9 | 0.012607 |
| 4 | value | PASS | 17.4 | 26.6 | 44.0 | 0.012899 |
| 5 | value | PASS | 17.1 | 21.4 | 38.5 | 0.011648 |

- Cost covers the workflow agents. On the first S1 run, output tokens summed across the main and
  agent transcripts equal `modelUsage` exactly (2158 and 2431), and Haiku was the only model in all
  15 runs. Time is the two `claude -p` calls only, not the free evidence check.
- The spike's per-run cap was its share of the spend limit, $1.50 or just under, not $3. The dearest
  run spent $0.016, so this changed nothing.
- `--max-budget-usd` overshoots and can report success. A plain prompt capped at $0.0001 spent
  $0.0015, then gave `subtype: error_max_budget_usd`, `terminal_reason: budget_exhausted` and exit 1.
  A real `code-config` stage capped at $0.005 spent $0.0052, the workflow ended `stopped`, its commit
  had already landed, and the result still said `success` and `completed`. So the runner also fails
  any run whose reported spend reaches the cap. A cap is a stop signal, not a hard ceiling.
- The S1 cap of $3 covers the whole smoke run, so the second stage gets what the first left. A run
  uses about 0.5% of it, which is the T1c figure for the human's cap decision.
- 8 of the 15 runs had a failed Bash call in the main context, and none failed for it. Unasked, the
  model checks its result with Bash after the workflow returns, and rebuilds the repo path wrongly,
  often from the transcript directory's mangled name. These were all 9 tool errors in the spike.
- In `add-key` run 1 a fallback `cd` landed in this worktree, the plugin under test, and ran
  read-only git commands there. Nothing changed, but nothing confines a smoke run's Bash to the
  sample repo.
- 16 of the 30 stage starts went through the Skill tool first and 14 went straight to Workflow. Both
  reached the same gate. No run called a pipeline agent directly, the failure seen in Task 22.
- Not covered: `/pairingbuddy:code` routing, which S1 reaches in a later task.

## T1 recovery drill

2026-11-02. Claude Code 2.1.316. Run by the human. Every wedge recovered.

| Wedge | Result | Notes |
|---|---|---|
| stranded-stage | Recovered | |
| gate-throw | Recovered | Fail-closed live. Running sessions pick up restored hook files with no restart. |
| gate-parse | Recovered, but fail-open | Fixed afterwards: `hooks/gate-boot.mjs` denies when `gate.mjs` cannot load. |
| killed-session | Recovered | Stage cleared, leftover file shown. |
| killed-at-gate | Recovered | Model denied. The `!` typed route records `human-cli`. |
| sha-mismatch | Recovered | The deny gives the exact command. |
| second-session | Recovered by the manual handover | The real session id owned the run after. No warning shown. |
| no-unit | Recovered by hand delete | |
| broken-cli | Recovered | A syntax error in `shared-node` fails closed. |

The output of a `!` command reaches the model.

## T1c lens spend spike

Question: what does one lens plus one refuter cost on a real diff, and what does that imply across
the D8 lens map? Claude Code 2.1.316, 2026-11-02. The lens map names no model, so every run used the
session default, `claude-opus-5-5`, and `costBasis` was `list`. The script was throwaway and is not in
the repo. Total spend was $4.21: $4.20 across the 8 agents below and under $0.01 on 3 Haiku flag
checks. The caps summed to $7.89, and no run reached its cap.

**Headline: on Opus 5.5 a lens costs $0.57 to $1.07 and a refuter $0.23 to $0.38. A lens took 69 to
175 s, a refuter 30 to 37 s. A new_feature task projects to $6 to $37 of review spend, and most of the
high figure is fix-round re-audits and per-cycle TDD lenses, not refuters.**

### What was measured

Each run was one `claude -p` process with stdin from `/dev/null`, `--tools Read,Grep,Glob`,
`--json-schema`, `--setting-sources project,local`, `--strict-mcp-config`,
`--no-session-persistence` and `--max-budget-usd`. Runs went one at a time, each lens followed by one
refuter on its top finding. They ran on `git archive` copies of the diff's head commit, so files
matched the diff and nothing ran in the repo. Each brief pointed at a `subject.diff` on disk, as
`pb snapshot` will, and opened with an authority block.

| Diff | Source | Size |
|---|---|---|
| big | `git diff feature/deterministic-workflows...t1a-stage-runs` | 55 files, 5,832 lines, 231 KB |
| small | commit `8fa501d`, the tap hook | 8 files, 690 lines, 28 KB |

Two lenses were used: `code`, and `corpus` (misalignment) with CLAUDE.md, ARCHITECTURE.md,
CONTRIBUTING.md and `contracts/agent-config.yaml` as its corpus. Lenses were capped at 5 findings.

| Run | Input | Output | of it thinking | Cache write | Cache read | Cost $ | Wall s | Tool calls | Result |
|---|---|---|---|---|---|---|---|---|---|
| small code lens | 10 | 6,706 | 3,551 | 51,489 | 99,541 | 0.5660 | 69.2 | 18 | 1 finding, as text |
| small code refuter | 8 | 3,193 | 390 | 20,143 | 33,647 | 0.2318 | 30.1 | 11 | stands |
| small corpus lens | 12 | 7,330 | 2,171 | 53,713 | 143,185 | 0.6050 | 69.4 | 24 | 3 findings |
| small corpus refuter | 8 | 3,416 | 892 | 37,339 | 73,216 | 0.3817 | 35.0 | 11 | refuted |
| big code lens | 12 | 16,538 | 10,449 | 87,685 | 212,339 | 1.0748 | 175.3 | 27 | 5 findings |
| big code refuter | 10 | 3,628 | 1,176 | 21,081 | 48,491 | 0.2509 | 34.9 | 13 | stands |
| big corpus lens | 12 | 8,893 | 2,865 | 74,118 | 229,204 | 0.8167 | 89.8 | 20 | 5 findings |
| big corpus refuter | 8 | 4,064 | 880 | 23,204 | 43,548 | 0.2757 | 36.9 | 17 | stands |
| **Total, 8 agents** | 80 | 53,768 | 22,374 | 368,772 | 883,171 | 4.2025 | 540.6 | | |

- Cost split: cache writes 70%, output 26%, cache reads 4%. A least-squares fit over the 8 runs gives
  $20, $8 and $0.20 per MTok with zero residual. That is $20 output and $0.20 cache read as published,
  and every cache write was the 1-hour kind, at twice the $4 input rate.
- An 8x larger diff cost a lens 1.4x to 1.9x. Lenses read what they need, with paged reads of the
  diff, so cost does not follow diff size. Refuter cost barely moved with diff size.
- `small code lens` was the first run. It used `--agent`, which drops StructuredOutput, so it returned
  JSON as text. Its token figures stand; its refuter took the finding parsed from that text. The other
  7 runs used plain `--tools`, which keeps StructuredOutput. A `--agent` session's lack of
  StructuredOutput says nothing about workflow `agent()` calls, where P8 showed it present.
- Read-only held: no Write, Edit or Bash ran. Two agents attempted `Bash` with `true`, got `No such
  tool available`, and carried on, like the unexplained `true` call in P13A.
- Cross-run caching was negligible: about 2,900 tokens read on the first turn of some runs, 0 on others.

### `budget.spent()` against total cost

No workflow ran, so `budget.spent()` itself was not called. The comparison uses summed
`output_tokens`, which is what P14 says it counts, and P14 also says it includes main-loop output.

| Measure | Value |
|---|---|
| Output tokens, 8 agents | 53,768 |
| All tokens, including cache | 1,305,791 |
| Output share of tokens | 4.1% |
| Output share of cost | 26% |
| Cost per 1,000 output tokens | $0.065 to $0.112, $0.078 overall |

So a D9 stage figure taken from `budget.spent()` sees a quarter of the money and 4% of the tokens. The
ratio moved 1.7x between runs, and a run that reads more than it writes looks cheapest. It can be
used as a rough activity signal, not converted to dollars. Dollars need per-agent `usage` from the mod
or `total_cost_usd`, and the report label D9 calls for should say "output tokens only".

### Projection across the lens map

Unit prices, all Opus 5.5 at list. "Measured" is the range above, "guess" had no run behind it.

| Unit | Low $ | High $ | Basis |
|---|---|---|---|
| Lens | 0.57 | 1.07 | measured, lowest and highest lens |
| Refuter | 0.23 | 0.38 | measured, lowest and highest refuter |
| Re-audit lens, on a fix diff | - | 0.60 | small-diff lens; fix diffs are likely smaller |
| Synthesizer, bias check | 0.23 | 0.60 | guess, bounded by refuter and small lens |
| Fix agent | - | 1.07 | guess, priced as the dearest lens |
| Triage, per cycle | 0.23 | 0.38 | guess, priced as a refuter |
| TDD lens, per cycle | - | 0.60 | guess, low case runs none |

- Low: every lens runs once, one refuter per lens, no fix round, triage picks no TDD lens.
- High: every fix round used, each one a fix agent plus all lenses again; `maxRefuters` reached and
  treated as per stage, so re-audits add no refuters; synthesizer and bias check rerun each round.
- `new_feature` and `bug_fix` run 2 cycles low and 8 high, with 2 TDD lenses per cycle high.
- Design critique runs 1 iteration low and 3 high.

| Stage | Agents low, high | Low $ | High $ | Share of high that is re-audit |
|---|---|---|---|---|
| intake | 0 | 0 | 0 | |
| plan-requirements | 14, 36 | 5.26 | 23.16 | 40% |
| plan-architecture | 12, 33 | 4.46 | 20.89 | 39% |
| plan-tracers | 11, 30 | 4.23 | 19.09 | 43% |
| plan-sequence | 0 | 0 | 0 | |
| scenarios | 8, 20 | 3.20 | 13.50 | 51% |
| tdd, each green-to-refactor | 1, 3 | 0.23 | 1.58 | |
| refactor-scope | 1 | 0.57 | 1.07 | |
| refactor-apply | 0 | 0 | 0 | |
| config | 0 | 0 | 0 | |
| safety-net, new_feature and bug_fix | 6, 17 | 2.40 | 11.23 | 51% |
| safety-net, refactoring | 6, 17 | 2.40 | 11.23 | 51% |
| safety-net, config_change | 4, 7 | 1.60 | 5.17 | 44% |
| spike-unit | 0 | 0 | 0 | |
| spike-document | 1, 3 | 0.57 | 2.74 | 61% |
| pr-draft | 0 | 0 | 0 | |
| design-domain, design-gallery | 0 | 0 | 0 | |
| design-build critique, per run | 6, 18 | 3.42 | 19.26 | |

| Roll-up | Low $ | High $ |
|---|---|---|
| Planning, once per plan | 13.95 | 63.14 |
| Task: new_feature or bug_fix | 6.06 | 37.37 |
| Task: refactoring | 2.97 | 12.30 |
| Task: config_change | 1.60 | 5.17 |
| PR: 2 new_feature tasks, the median PR in this plan | 12.12 | 74.74 |
| PR: 5 new_feature tasks | 30.30 | 186.85 |
| PR: 11 new_feature tasks, this plan's largest | 66.66 | 411.07 |

These figures are lens spend only. The producing agents, such as implement-code and the test agents,
come on top. This plan has 42 PRs and 138 tasks, median 2 per PR.

### Where the projection is weak

- 8 runs, 4 of each role, one each per diff and lens. The low and high unit prices are the extremes of
  a tiny sample, not a confidence interval. Rerunning would move them.
- Plan stages are the largest rows and nothing was measured on them. Their subject is a document, not
  a diff, and they read corpus differently. The prices are borrowed from code review.
- Synthesizer, bias check, triage, fix agents and TDD-cycle lenses were not run. Those guesses carry
  most of the high side: re-audits with their fix agents alone are 39 to 51% of the high figure for the
  stages with refuters.
- A green-to-refactor diff is far smaller than the small diff, so 0.60 is likely high. The floor is
  unknown.
- Low is optimistic on refuters. Two of the three schema-bound lenses hit the 5-finding limit, so 6
  lenses could offer 30 findings against a cap of 10. Low is also no fix rounds at all, which real work
  will rarely see.
- High is a stack of worst cases, unlikely to land on one task. Treat it as a bound, not a forecast.
  No central estimate is offered, because no run supports one.
- Lens briefs here were two sentences, and real briefs and schemas will be longer. These runs replaced
  the system prompt, loaded project settings only, and ran serially outside a workflow, so workflow
  agent overhead is unmeasured. Whether workflow agents get the 1-hour cache is also unmeasured; at the
  5-minute write price of $5 per MTok these 8 runs would cost $1.11 less, or 26%.
- Default effort applied, and thinking was 42% of output, so a different effort changes cost directly.
- Findings were not graded. This spike measures spend only, so it says nothing about whether a
  cheaper model or fewer lenses would keep the value.
- The same tokens repriced are indicative only, since a cheaper model behaves differently: $2.19 on
  Sonnet 5.5, or 52%. Haiku 5.5 at about $0.11 assumes $0.20 1-hour write and $0.01 read, not published
  in the source used, and contexts past 100K tokens pay five times the Haiku rate.
- The smoke caps of $3 and $6 are not directly tested here. Smoke forces Haiku through P16, so this
  Opus data does not bear on them, but a Haiku lens run has never been measured.

## T1 verification: S1 through `/pairingbuddy:code`

2026-11-02. Claude Code 2.1.316, Haiku through P16's `default-env`, task `value`, $3 cap per run.
Each run is one `claude -p` session on a branch made from main, with the plugin loaded from outside
the cwd and no inherited policy env. Run it with `uv run python -m tests.smoke.s1`.

**Result: after two fixes, 5 of 5 passed. The first two rounds went 2 of 5 and 3 of 5. That is not
proof S1 is stable: 5 of 5 only puts the true pass rate above about 55% at 95% confidence, and these
runs show that a cheap model can leave the route several ways.**

| Round | Run | Result | Total s | Cost $ | Failure cause |
|---|---|---|---|---|---|
| A, no fix | 1 | PASS | 72.0 | 0.027762 | |
| A | 2 | FAIL | 30.4 | 0.010812 | No run opened: took `code-config` as the skill, started it by hand |
| A | 3 | FAIL | 28.9 | 0.010658 | No run opened: same, then called `apply-config-change` directly |
| A | 4 | PASS | 71.1 | 0.026394 | |
| A | 5 | FAIL | 92.0 | 0.021071 | No run opened: read the installed 0.6.0 skill and took its old path |
| B, command fixed | 1 | FAIL | 18.1 | 0.009087 | No run opened: `curate-guidance` stopped for a human |
| B | 2 | FAIL | 24.9 | 0.010396 | No run opened: `curate-guidance` stopped for a human |
| B | 3 | PASS | 69.4 | 0.024520 | |
| B | 4 | PASS | 74.9 | 0.025530 | |
| B | 5 | PASS | 63.7 | 0.023168 | |
| C, both fixed | 1 | PASS | 52.2 | 0.019232 | |
| C | 2 | PASS | 58.7 | 0.020006 | |
| C | 3 | PASS | 53.0 | 0.019095 | |
| C | 4 | PASS | 54.5 | 0.019809 | |
| C | 5 | PASS | 63.7 | 0.021464 | |

Round C is the code as it stands. Each of its runs ended with one commit touching `app.ini` alone, a
clean tree, `run/task` gone, stage order config then safety-net, and `G:task-end` from `auto`. Each stage
took 7 to 10 s; the rest is the main loop. The session spent $0.33 of the $5 limit: one first trial
that passed at $0.029827, the 15 runs above, and the Stop probe below. No run came near a cap.

Out-of-order calls and the refused `pb stage finish` are checked without a model, on the real gate
hook, tap and CLI, because a model cannot be made to misbehave on cue. Those checks passed in all
11 passing runs, and they deny a stage ahead of its turn, a direct pipeline agent, and a stage start
with no `task` or `pluginRoot`. No session produced a deny of its own, so S1 has not seen one reach a
live model. Probe P1 did.

### Causes and fixes

- `commands/code.md` said "the coding skill". All 6 sessions before the fix, the first trial and
  round A, called `pairingbuddy:code`, the command itself, which returns no text. The model then
  guessed: the file by path, which is how all 3 passes got there, the `code-config` skill, or an
  installed copy found with `find /`. The command now names
  `pairingbuddy:coding` and its path, and warns off itself and the stages. Every later run loaded the
  right skill.
- `curate-guidance` ran ahead of the router and waits on a human, so a session with none ended there.
  It now runs after the router, so a migrated type stops only at its gates. This moves it after
  classification on the old path too, and the plan loop is unchanged.

### Known risks

- **Relayed `/code` text overriding an agent's task: not seen.** The 50 workflow agents of the 13 sessions
  that ran them never used Skill, Agent or Workflow, and none of their recorded requests held the
  `[Workflow harness - user request]` block or the `/pairingbuddy:code` text, which P13A saw
  in an interactive session. Their API request records do hold the computed task, so the search reads
  the right place. Why the block is absent here was not found, so an interactive run may still carry it.
- **Skill-driven workflow start skipped: seen, and the main failure.** 5 of the 15 runs never opened a
  run. Once no run exists, the gate allows everything by design, so nothing stops a stage: round A
  runs 2 and 3 started `code-config` four and three times with no run, and run 2's agent edited
  `app.ini` with no commit. **This hole is still open.** The fixes make it less likely, and a skill
  listing still shows both stages: 4 of the 5 round C runs loaded a stage skill despite the warning.
  They passed because the run was open and the args were right.
- **Stranded stage: not seen.** No run ended with an active stage, and no stage needed a second
  attempt. A start with no `task` or `pluginRoot` is now denied at the gate, in place of being refused
  inside the workflow with the stage left active.

### What drove the chain

The Stop hook fired in every session and blocked in none of the S1 runs. Each stage's completion
notification woke the model, and the skill's `pb status` loop went on from there. So S1 shows the
harness does not sequence the stages, and does not show the Stop hook doing it.

One separate session tested the hook, at $0.0148, not counted as an S1 run. With a run already open, the
prompt told the model to reply and end its turn. Stop blocked 4 times: `code-config`, `code-safety-net`,
`G:task-end`, then the needs-human text, and it stayed silent while each stage ran. The model started
both stages from that text alone, and the run ended correctly at the human gate. It had made the
edit itself first, so `apply-config-change` reported an ambiguity, which is what sent the gate to a
human. So the chain works when the model stops, on one session.

### Other findings

- Nothing confines a run's Bash to the sample repo. Round A run 5 read the installed plugin, and in
  round B run 2 `curate-guidance` reported 8 entries when the sample repo has none, matching this
  worktree's `human-guidance.json`. Both were reads.
- `commands/plan.md` and `commands/design-ux.md` keep the "follow the X skill" wording. They were not
  changed or run.
- The ledger goes at `pb task end`, so S1 keeps its last copy by polling every 20 ms. A model that runs
  `pb gate eval && pb task end` as one call could beat the poll and fail S1 falsely. It did not happen.

### S1 after closing the no-run stage hole

A stage call with no run is now denied, seen live once ($0.0032). S1 through `/pairingbuddy:code` then passed 5 of 5 at $0.018 to $0.022 and 49 to 56 s, on Haiku. That supersedes the "still open" note above. 5 of 5 bounds the pass rate above about 55% at 95% confidence, so S1 is not proven stable.
