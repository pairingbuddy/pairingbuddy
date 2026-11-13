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
| P21 | 2.1.321 | 2026-11-09 | auto | PASS | per-call model beat the pin both ways. percall:haiku-pin+sonnet: type=pbprobe:pinned-haiku spawn.model=claude-sonnet-5-5 spawned.model=claude-sonnet-5-5 transcript=['claude-sonnet-5-5']; percall:sonnet-pin+haiku: type=pbprobe:pinned-sonnet spawn.model=claude-haiku-5-5 spawned.model=claude-haiku-5-5 transcript=['claude-haiku-5-5']; percall:plain+sonnet: type=workflow-subagent spawn.model=claude-sonnet-5-5 spawned.model=claude-sonnet-5-5 transcript=['claude-sonnet-5-5']; session modelUsage ['claude-haiku-5-5', 'claude-sonnet-5-5'] | `$PROBE_RECORDINGS/P21/20261109-210838` | Per-call `model` overrides a pinned agentType |
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
- P21 (2026-11-09, 2.1.321, $0.042): one workflow, `pbprobe:percall`, ran three
  `agent()` calls: `pbprobe:pinned-haiku` (`model: claude-haiku-5-5`) with
  `model: 'claude-sonnet-5-5'`, `pbprobe:pinned-sonnet` (`model: sonnet`) with
  `model: 'claude-haiku-5-5'`, and a plain `agent()` with `model: 'claude-sonnet-5-5'`
  as the control. In all three, the per-call model is what ran. The mod's `agent.spawn`
  saw it before and after spawn, the transcript's assistant turns and the API request
  `params.model` used it, and session `modelUsage` showed sonnet output (8 tokens) that
  no other source could have produced. So a per-call `model` beats a frontmatter pin in
  both directions, unlike `--model` and `CLAUDE_CODE_SUBAGENT_MODEL` in P16. Each agent
  transcript also names `claude-opus-5-5`, but that is the `advisor` tool's entry in the
  request shape, not a turn.
  Caveats for a later re-run: `judge_p21` matches transcripts by substring of the agent id
  (exact matching needs the recorded id form checked first), and `pinned-haiku` pins a
  full model id while `pinned-sonnet` pins the alias, so the two directions test
  different pin forms.
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
  Moving it after the router fixed S1 and broke the old path: it reads the just-completed task, which
  cleanup deletes, and classification read uncurated guidance. It is back before cleanup in both
  orders, and under the auto policy or `claude -p` it now carries over silently and asks nothing.

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
- `commands/plan.md` and `commands/design-ux.md` now name their skill the same way as
  `commands/code.md`, and warn off themselves. They were not run.
- The ledger goes at `pb task end`, so S1 keeps its last copy by polling every 20 ms. A model that runs
  `pb gate eval && pb task end` as one call could beat the poll and fail S1 falsely. It did not happen.

### S1 after closing the no-run stage hole

A stage call with no run is now denied, seen live once ($0.0032). S1 through `/pairingbuddy:code` then passed 5 of 5 at $0.018 to $0.022 and 49 to 56 s, on Haiku. 5 of 5 bounds the pass rate above about 55% at 95% confidence, so S1 is not proven stable.

That first deny covered only a stage name and a byte-exact bundle, so it did not supersede the "still open" note above. With no run the gate now also denies a direct Agent call for an agent in `newPathAgents` in `contracts/stages.json`, a bundle copy differing only in trailing whitespace, and a script naming a stage or one of those agents literally. The hole narrows to Section 8's bypass, which stays open: an edited bundle that builds those names from string fragments passes.

## T2a: S2 and the bug_fix flip

2026-11-03. Claude Code 2.1.316 at the first trial and 2.1.317 for the rest, Haiku through P16's env, $1 cap per run, which is under the plan's $3. Each run is one `claude -p` session on a branch made from main, with the plugin loaded from outside the cwd and no inherited policy env. The sample is a pytest repo made by `tests/smoke/s2.mjs`, with one bug in `discount.py`. Run it with `node tests/smoke/s2.mjs`.

**Result: on the final code, S2 passed 5 of 5 and S1 passed 1 of 1. That is not proof S2 is stable: 5 of 5 puts the pass rate above about 55% at 95% confidence. With the task's scope left open, a run still stops in 1 of 3, from a cause that is still open (below).**

Pytest, not node:test. `pb test --full` passes the runner's `test_directory`, and `node --test tests` reads `tests` as a file and fails. node:test's `--test-name-pattern` also exits 0 when nothing matches, so a mistyped selector would pass GREEN. Pytest's `file::name` exits 4 on no match.

| Round | Run | Result | Total s | Cost $ | Failure cause |
|---|---|---|---|---|---|
| Trial | 1 | FAIL | 15.8 | 0.006930 | No run opened: the skill's bootstrap asked "Use existing test config?" and the session ended |
| Trial | 2 | FAIL | 59.0 | 0.025978 | `G:scenarios` asked a human: the scenarios return raised out-of-range inputs, which the task never mentioned, as an ambiguity |
| Trial | 3 | FAIL | 127.5 | 0.047605 | The placeholder agent wrote the real test, so RED had nothing to commit, and `implement-tests` reported that as an ambiguity, which sent `G:task-end` to a human |
| Trial | 4 | PASS | 127.1 | 0.044102 | |
| A | 1-5 | 5 PASS | 124 to 144 | 0.227993 in all | Every run had `code-tdd` denied once: the model started it while `G:scenarios` was due, then recovered |
| B | S1 | PASS | 72.1 | 0.026797 | |
| B | probe 1 | PASS | 128.7 | 0.042996 | |
| B | probe 2 | FAIL | 12.6 | 0.006985 | No run opened: the bootstrap question again, in spite of the "with no human" note |
| C, final | S2 1 | PASS | 171.1 | 0.047689 | |
| C | S2 2 | PASS | 150.0 | 0.053055 | |
| C | S2 3 | PASS | 120.4 | 0.041265 | |
| C | S2 4 | PASS | 126.1 | 0.040822 | |
| C | S2 5 | PASS | 129.1 | 0.039983 | |
| C | S1 | PASS | 67.9 | 0.026407 | |
| C | probe 1 | PASS | 130.8 | 0.045160 | |
| C | probe 2 | FAIL | 156.4 | 0.053341 | `code-tdd` stopped `step-failed`: the second test passed at RED after the first test's GREEN |
| C | probe 3 | PASS | 121.3 | 0.042150 | |

Round C is the code as it stands. A probe is S2 with the task's last sentence, "One regression test for exactly that case is the whole scope", left out. The S2 runs ended with three commits, the placeholder `test:`, then RED `test:` and GREEN `fix:`, one test each, and no `docs:` commit, with `G:scenarios` and `G:task-end` from `auto` and the policy from `permission_mode`. Stages took 5 to 13 s for scenarios, 46 to 60 s for tdd and 8 to 9 s for safety-net, with 9 workflow agents a run; S2 run 2 took 11, because the placeholder agent's first return had an empty `commit_subject` and was refused once. No gate deny in round C. The smoke spend was $0.819258 in all, and no run came near its cap. The paid integration check ran once after, with 3 runs capped at $0.50 each, and its cost was not reported, so the session total is at most $2.32.

### Causes and fixes

Each fix has a test first in `tests/js/`.

- The bootstrap question: a config that exists is now used with no question. A note saying "ask nothing with no human" did not hold, as probe B2 showed.
- `pb status`'s `next` names the next stage even while a gate stands before it, and the skill said to start stages while `next` is not null. It now follows `pb status --action`, which puts a due gate first.
- `enumerate-scenarios-and-test-cases` now treats a case the task does not mention as out of scope, not as an ambiguity. It also leaves out cases the fix for an earlier case would already make pass.
- `create-test-placeholders` is told a placeholder asserts nothing. All three TDD agents are told `ambiguity` is only for a question a human must settle, never a report.
- `pb run open` refuses a type with RED and GREEN when any runner has no `selector_template`, and names the fix, for example `["{test_file}::{test_function}"]`. No default is guessed, because a wrong template can pass a test that never ran. A refusal at open costs no agent, while the stop at the placeholders checkpoint came after two.

### Still open

- **A later test that already passes stops the run.** Tests run one at a time, and RED refuses a test that passes, so a bug fix whose first GREEN also fixes a second case stops at `step-failed` after three tries. The agent rule makes this less likely and does not remove it: round C probe 2 hit it. A fix that keeps one RED and one GREEN per test needs a decision: write every RED before the first GREEN, or count such a case as covered and not as a failure.
- **Relayed `/code` text: now seen.** Both S1 runs here found the `/pairingbuddy:code` text or the harness block in one workflow agent's records, which T1 never saw. Neither agent used Skill, Agent or Workflow.
- The scoped sample task keeps S2 off that first risk, so S2 passing does not cover it.

### The recorder

`tests/smoke/run-recorder.mjs` is test tooling only, and no hook, verb or workflow loads it, which a test checks. A timer reads the ledger from outside the run, and the harness hands it each stream line. Each recording in `tests/smoke/recordings/<name>/` holds `ledger.jsonl`, one snapshot for each new `seq` with its time, and `spawns.jsonl`: Skill, Agent and Workflow calls, task start, progress and end, and each workflow agent with its label, phase and span, read from its transcript. It also holds `timing.json` with the total and per-stage seconds. The raw stream stays with the run's repo, outside the recording. Recordings are refused under `docs/plans/`. Round C's eight runs are kept, about 500 KB.

### Round D: an existing test listed as new

The bug, from a live S2 run with an open-scope task: the placeholders agent listed the sample's own `test_zero_price_stays_zero`, which already passes, as a new test. RED refused it as one that proves nothing, and the stage stopped. `pb checkpoint --step placeholders` now refuses a row whose `test_function` is already in its `test_file` at the commit before the task's first placeholders, and names it. A pytest class path is matched by its last part. The checkpoint records that commit as `base`, so a re-run does not find its own placeholders there. The refusal is not a stop, so `code-tdd` hands it to a new placeholders agent, as it does any other refusal. `create-test-placeholders` now lists only the tests it creates. The tests are in `tests/js/pb-red-green.test.mjs` and `tests/js/code-tdd.test.mjs`. The stage test passed when first run, because the stage already passes on every refusal.

2026-11-03, the same setup as round C, $0.70 cap per run. "Open" is `--task "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90. Cover the edge cases too, such as 0 and 100 percent"`.

| Run | Result | Total s | Cost $ | Agents | Tests | Where it ended |
|---|---|---|---|---|---|---|
| Open 1 | FAIL | 201.0 | 0.061230 | 15 | 4: 1 RED and GREEN, 3 covered | All three stages done, then a stop at `G:task-end`: two `implement-tests` returns gave a covered pass as an ambiguity |
| Open 2 | FAIL | 203.3 | 0.061678 | 15 | 4: 1 RED and GREEN, 3 covered | Same, from one `implement-tests` return |
| Open 3 | FAIL | 184.8 | 0.058180 | 13 | 3: 1 RED and GREEN, 2 covered | Same, from one `implement-tests` return |
| Default | PASS | 158.7 | 0.051653 | 9 | 1 | Three commits: placeholder `test:`, RED `test:`, GREEN `fix:` |

The spend was $0.232741 in all. No run stopped at `G:scenarios`: each scenarios return had an empty ambiguity, and the gate passed from `auto`. In every open run the placeholders checkpoint took the first return, and no row named an existing test, so the new refusal never fired live. All three open runs reached `G:task-end` with every test closed, the covered ones each with one `test:` commit. The stop came from the agent and not the CLI: `implement-tests` saw its test pass at RED after the first GREEN and asked a human whether to keep it, as in "a human should decide whether to keep it as a regression guard or drop it". The CLI had already kept that test as covered, so the question was already settled.

Still open: `implement-tests` reports a covered pass as an ambiguity, so an open-scope task stops at `G:task-end` 3 times in 3. The agent needs telling that a pass at RED after an earlier GREEN is the CLI's decision, kept as covered, and not a question for a human. The recordings are `tests/smoke/recordings/e-open-1` to `e-open-3` and `e-default`.

### Round F: a covered pass is not a question

The human decided that a test the CLI kept as covered is the rule, so it is not a question to ask. That is now in the CLI and not only in a prompt. In `shared-node/gates.mjs`, an ambiguity on an `implement-tests` return counts as settled when that return's test, the item in its key, is `covered` in `tests.perTest`, so it no longer stops a gate. Any other ambiguity still asks: the same text on a test that is not covered, and an ambiguity on another agent's return for a covered test. The three tests in `tests/js/gate-eval.test.mjs` drive the real `pb gate eval`. The auto-pass test failed first with "carries an open ambiguity". The other two are guards, so they passed before the change and still pass after it. `implement-tests` also got one line, in the paths mode only: a pass after an earlier GREEN is the CLI's call, so leave it out of `ambiguity`.

2026-11-03, the same setup as round D, $0.70 cap per run, the same open `--task`.

| Run | Result | Total s | Cost $ | Agents | Tests | Where it ended |
|---|---|---|---|---|---|---|
| Open 1 | PASS | 174.6 | 0.062372 | 15 | 3: 1 RED and GREEN, 2 covered | Five commits: placeholder `test:`, RED `test:`, GREEN `fix:`, then one `test:` for each covered test |
| Open 2 | PASS | 182.3 | 0.060689 | 15 | 4: 1 RED and GREEN, 3 covered | Six commits, the same shape |
| Open 3 | FAIL | 57.9 | 0.023325 | 1 | 0 | A stop at `G:scenarios`: the scenarios return asked whether to keep the 0 and 100 percent cases as separate tests, since the base fix also makes them pass |
| Default | PASS | 131.7 | 0.048646 | 9 | 1 | Three commits: placeholder `test:`, RED `test:`, GREEN `fix:` |

The spend was $0.195032 in all. The four runs ran at the same time, each in its own repo. In open 1 and 2, every `implement-tests` return had an empty ambiguity, 34 empty returns in each run's transcripts, so the prompt line held and the new gate rule never had to fire live. The tests show the rule works, and these runs do not. `G:task-end` passed from `auto` in every run that got there.

Still open: the scenarios agent can still turn "the base fix also covers this case" into a question at `G:scenarios`, here 1 time in 3. Round C's rule tells it to leave out such cases. With an open task that names the cases, it kept them and asked instead. It looks like the decision the human made for RED, one stage earlier: if it is, a named case the base fix covers is kept and becomes a covered test, and that is not a question either. The human has not decided that yet, so this round does not fix it. The recordings are `tests/smoke/recordings/f-open-1` to `f-open-3` and `f-default`.

### Round G: a named case the base fix covers is not a question

The human decided round F's open point: a case the task names stays a test even if the fix for an earlier case will also make it pass, and the CLI records it as covered. `enumerate-scenarios-and-test-cases` now says so in the paths mode only, so keeping such a case is no ambiguity. Round C's rule still leaves out a covered case the task does not name. The structural test in `tests/js/tdd-agent-contracts.test.mjs` failed first, then passed after the line.

2026-11-03, the same setup as round F, $0.60 cap per run, the same open `--task`, three runs at the same time, each in its own repo.

| Run | Result | Total s | Cost $ | Agents | Tests | Where it ended |
|---|---|---|---|---|---|---|
| Open 1 | PASS | 171.2 | 0.061887 | 15 | 4: 1 RED and GREEN, 3 covered | Six commits: placeholder `test:`, RED `test:`, GREEN `fix:`, then one `test:` for each covered test |
| Open 2 | PASS | 179.9 | 0.060007 | 15 | 4: 1 RED and GREEN, 3 covered | Six commits, the same shape |
| Open 3 | PASS | 152.6 | 0.057204 | 13 | 3: 1 RED and GREEN, 2 covered | Five commits, the same shape |

The spend was $0.179098 in all. No run stopped at `G:scenarios`, and each kept the named 0 and 100 percent cases as covered tests. 3 of 3 is a small sample: it shows the rule can hold, not that the round F stop is gone. The recordings are `tests/smoke/recordings/g-open-1` to `g-open-3`.

## T2b: `files_changed` at `pb task end`

The risk (section 10 of the plan): an agent changes a file it leaves out of `files_changed`, the checkpoint commits only the listed files, and the leftover stops `pb task end` with "the tree is dirty". Safe, but a stop. The question is how often.

**Result: 0 leftovers in 61 runs that reached `pb task end`, 33 `config_change` and 28 `bug_fix`. With no event seen, the rate is below about 5% at 95% confidence (3/61). That is not high, so nothing needs tuning before auto publish on this evidence.**

**Re-measured after Task 52: 0 leftovers in 68 runs, 33 `config_change`, 30 `bug_fix` and 5 `new_feature`, so below about 4.4% at 95% confidence (3/68). Still not high. See "The count again" below.**

How it was counted. The recordings in `tests/smoke/recordings/` hold ledger snapshots and spawns, not what `pb task end` printed, and a refusal does not change the ledger, so they cannot show a leftover. Of their 25 runs, 18 reached `pb task end` with every stage done and both gates passed. The count instead reads each run's own session transcript under `~/.claude/projects/`, one per sample repo, and takes the output of every Bash call that ran `task end`. Every run's first `task end` removed `run/task`, apart from one whose call failed to find the CLI from a quoting slip and passed on the next try. No run printed "the tree is dirty". The main context ran no `rm`, `git checkout`, `restore`, `clean`, `add` or `commit` before its `task end`, apart from clearing old `.pairingbuddy/` state at the start, which `pb task end` does not count. So no leftover was cleaned up out of sight either. Runs that stopped before `task end`, at a gate or a `step-failed` stop, are not counted. The transcripts cover S1, S2, the S2 probes and the integration runs from 2026-11-02 21:10 to 2026-11-03 08:32 UTC, and they stay on this machine. The S1 recordings are not in `tests/smoke/recordings/`, so they count only through their transcripts.

This round's runs, 2026-11-03, after Task 50, $0.30 cap per run, four at the same time:

| Run | Result | Total s | Cost $ | Agents | `task end` |
|---|---|---|---|---|---|
| Default | PASS | 149.5 | 0.053181 | 10 | Removed `run/task`, no leftover |
| Open 1 | PASS | 205.4 | 0.065169 | 16 | Removed `run/task`, no leftover |
| Open 2 | FAIL | 69.5 | 0.023220 | 1 | Not reached: `G:scenarios` asked a human about a scenarios ambiguity |
| Open 3 | PASS | 183.9 | 0.060107 | 14 | Removed `run/task`, no leftover |

The spend was $0.201677 in all. "Open" is the round D `--task`. Open 2 is round F's open point coming back, 1 time in 4 runs here after 0 in 3 in round G. The recordings are `tests/smoke/recordings/t51-default` and `t51-open-1` to `t51-open-3`.

Where the sample is weak:

- Every change is one file in a small sample repo. Task 52 added 5 `new_feature` runs with 10 refactor fix groups, and each group still touched one file, so a group that touches several files has still not been seen live.
- The recorder now keeps `pb task end`'s output in `task-end.jsonl`, so from Task 52 on a count reads the recordings and needs no transcript.
- If a later count is high, the tuning it points to: have `pb checkpoint` refuse a step that leaves changed files outside its `files_changed`, so the stage retries that agent at once instead of the run stopping at task end, and tell the writing agents in the paths branch that an unlisted file stops the run.

### The count again

2026-11-03, after Task 52. The 7 new runs that reached `pb task end` are S2's below: 2 `bug_fix` default runs and 5 `new_feature` runs, `t52-default-1`, `t52-default-2`, `t52-nf-3` and `t52-nf-5` to `t52-nf-8`. Each one's `task-end.jsonl` holds one call, and it printed `{"ok":true,"removed":...}`. None printed "the tree is dirty". Before its `task end` the main context ran no `git add`, `commit`, `checkout`, `restore`, `clean`, `stash` or `reset`, and its only `rm` was the cleanup of old `.pairingbuddy/*.json` at the start. Each `new_feature` run made 2 refactor commits, one from `refactor-tests` on `tests/test_cart.py` and one from `refactor-code` on `cart.py`, so the fixers' `files_changed` was right 10 times in 10. The 3 `new_feature` runs that did not reach `task end` are not counted. With the earlier 61 that is 0 in 68.

## T2b: `new_feature` on the new path, and S2 for it

2026-11-03, Claude Code as in T2a, Haiku through P16's env, each run one `claude -p` session on its own branch, six or four at the same time, each in its own repo. `new_feature` joins `migratedTypes` in `contracts/stages.json` and `MIGRATED_TYPES` in the coding skill. S2 takes `--type new_feature`: a cart sample with `line_total(p, q)` written with short names, a magic 1.25 and a reused variable, and the task "Add order_total(lines) to cart.py ...", one test in scope. GREEN changes `cart.py`, so `identify-code-issues` reads that file and finds the old code's smells. That is the refactor's "something real to do". Run it with `node tests/smoke/s2.mjs --type new_feature`.

What S2 asserts now, for both types: the ledger's task type, stage order, the one placeholder commit, RED `test:` and GREEN `fix:` or `feat:` per test, or one `test:` for a covered test, `tests{}` exit codes, a coverage check after the last cycle, the full suite, and `G:scenarios` and `G:task-end` from `auto`. For `new_feature` it also asserts at least one refactor commit, each in place after its cycle's GREEN, typed `test` for `refactor-tests` and `refactor` or `test` for `refactor-code`, and for each one a passing run of the task's closed tests at that commit's parent. A `bug_fix` with a refactor commit fails. The ledger keeps only the last `tests.refactor`, so the closed-tests check reads the recorder's ledger snapshots. The ledger holds no coverage fact, so the coverage check reads the workflow agents the recorder took from the transcripts: the last `verify-test-coverage` in `code-tdd` must start after the last placeholders, RED, GREEN or refactor agent. That one check reads more than the ledger, commits and gate sources R22 names.

**Result: on the final code, `new_feature` passed 4 of 4 and `bug_fix` default 2 of 2. Over the session `new_feature` passed 5 of 8. 4 of 4 puts the pass rate above about 47% at 95% confidence, so it is not proven stable, and one of the two causes below is fixed only in a prompt.**

| Round | Run | Result | Total s | Cost $ | Agents | Commits | Where it ended |
|---|---|---|---|---|---|---|---|
| 1 | default 1 | PASS | 140.9 | 0.047104 | 10 | test, test, fix | |
| 1 | default 2 | PASS | 135.0 | 0.050064 | 10 | test, test, fix | |
| 1 | nf 1 | FAIL | 92.3 | 0.034460 | 0 | none | No run opened: after `classify-task` said `new_feature`, the main context called the old branch's agents directly, then stopped at RED on an ImportError |
| 1 | nf 2 | FAIL | 213.8 | 0.069767 | 18 | test, test, feat, refactor | A stop at `G:task-end`: four returns asked whether 30.0 or a "no VAT" rule was right. The main context had added that rule to `task.json` itself |
| 1 | nf 3 | PASS | 206.6 | 0.069111 | 16 | test, test, feat, test, refactor | |
| 1 | nf 4 | FAIL | 166.7 | 0.067374 | 0 | none | No run opened, as in nf 1: the old branch's agents, called directly |
| 2, final | nf 5 | PASS | 209.3 | 0.070468 | 16 | test, test, feat, test, refactor | |
| 2 | nf 6 | PASS | 226.2 | 0.064410 | 16 | test, test, feat, test, refactor | |
| 2 | nf 7 | PASS | 223.0 | 0.066936 | 16 | test, test, feat, test, refactor | |
| 2 | nf 8 | PASS | 218.8 | 0.062965 | 16 | test, test, feat, test, refactor | |

The smoke spend was $0.602659 in all, and no run came near its cap of $0.45, or $0.30 for `bug_fix`. The paid integration check ran once after, with 3 runs capped at $0.50 each, and its cost was not reported, so the session total is at most $2.11. In every passing `new_feature` run the closed tests ran green, exit 0, before each refactor commit, no gate was denied, and the stages took 16 agents: scenarios, placeholders, RED, GREEN, two finders, two fixers and the coverage check, with their runners. The recordings are `tests/smoke/recordings/t52-default-1`, `t52-default-2` and `t52-nf-1` to `t52-nf-8`.

### Causes and fixes

- **The old branch, taken for a migrated type (nf 1 and nf 4).** Both runs classified `new_feature`, never ran `pb run open`, and called `enumerate-scenarios-and-test-cases` and the rest by Agent, as the old `if task_type == "new_feature":` branch says. It is the first branch past the router. 2 in 4 here, against no such slip in the `bug_fix` runs since T2a. Fixed in the skill only: the router's body says every migrated type goes there and never to the old branches, a comment heads the old branches, and each migrated type's old branch starts with "Plan tasks and Solo only: the router takes every other <type>", as `config_change`'s already did. A test in `tests/js/code-router.test.mjs` holds each migrated type's branch to that line, and failed first. It held 4 in 4 in round 2, which is a small sample: it is a prompt, and T2a found that a prompt alone did not hold for the bootstrap question. A fix in code would have the gate deny an old-path TDD agent when no run exists and the classification is migrated, outside Solo. It cannot tell a plan task, which stays on the old path until T7 and also writes `task-classification.json`, from a plain one, so it needs a plan marker first. That is for the human to decide.
- **The main context rewrote the task (nf 2).** It read "the sum of their line totals" as price times quantity, worked out that this gives 30.0, which is wrong, and wrote that rule into `task.json` as `context`. `pb run open` stored it, and every agent then saw the test's 30.0 as a contradiction and asked. The question was real given what they read, so the gate was right to ask. The fix is in the sample: the task now names `line_total(price, quantity)` and the sum, 25.0 plus 5.0, and a test in `tests/js/smoke-s2.test.mjs` holds it to that. It failed first. Still open: the main context may add its own reading to the human's task, and nothing checks it.

### The scenarios stop in Task 51

Task 51's open 2, `t51-open-2`, stopped at `G:scenarios`. Its scenarios return kept the named 0 and 100 percent cases, as round G says, and asked: "The task does not say how apply_discount should handle a percent below 0 or above 100 ... Those cases are left out until a human decides the expected behavior." That is not the covered-case rule from round G, which is about a named case an earlier fix already passes. It is round C's rule: a case the task does not mention is out of scope and no ambiguity. The agent had already left the cases out, so the ambiguity reports a choice and asks nothing new. The task's "edge cases too, such as 0 and 100 percent" makes it arguable: "such as" leaves room for out-of-range input to count as an edge case it names. So this round does not fix it. If the human decides out-of-range input is out of scope under "such as", the fix is round C's rule restated for an open list of named cases. If not, the stop was a real question.

## T5 spend re-measure

Question: what does the safety net cost now that rollback and retry changed the worst case, and does S4 stay under its
cap? Claude Code 2.1.322, 2026-11-11, `costBasis` list, `ANTHROPIC_API_KEY` unset in every child. The harness was
throwaway and is not in the repo. Total live spend was **$3.20 of the $8 limit**: $0.09 on three S4 runs, $0.97 on run A
and $2.14 on run B.

**Headline: at the lens map's models a safety net cost $0.97 with no rollback and $2.14 with 4 rollbacks and 3
Opus checks. A lens costs $0.07 to $0.11 on Sonnet, about a tenth of T1c's Opus lens. The new worst case is the fix loop, not
the lenses: projected to the cap, a `new_feature` safety net is $4.75 and a whole `new_feature` task $12.81, against T1c's
$11.23 and $37.37. No cap was breached.**

### What was measured

Both safety-net runs replayed commit `8b578b2` ("feat: keep a pr-draft redraft and roll it back on a failed lint", 8 files,
219 insertions, 10 deletions) as a `new_feature` unit's task in a scratch clone with a bare origin. The run was
fast-forwarded past scenarios and tdd, so only `code-safety-net` ran, started by a `claude -p` session on Haiku that read
`pb status --action` and started the workflow. No ANTHROPIC_* variable reached the child, so every agent ran at the model
its definition or `contracts/lenses.json` names: lenses, refuters, fixers and docs on Sonnet 5.5, the course checker on
Sonnet before a rollback and Opus 5.5 after, runners on Haiku 5.5.

- **Run A, no rollback.** The full suite was the commit's own JS tests (313, 66 s). Every refuter verdict was Sonnet,
  since no finding was high. Fixes g1 and g2 were kept, both checked "better" on Sonnet. Fix g3, the corpus lens's copy of
  the comment finding g2 had just fixed, changed nothing and gave no reason, so the stage stopped there: no docs agent, no
  finishing runner, and tokens unknown. That was a bug, fixed below.
- **Run B, forced to the cap.** The scratch repo's test config ran a script that failed whenever the tree was dirty, for
  the first 4 fix attempts only. It lives in the scratch repo, not the plugin. So g1 was rolled back 4 times as red tests,
  with 4 refs under `refs/pairingbuddy/feat/spend-net/rollback/code-safety-net/` and 4 notes. Its 5th attempt passed and
  reached the course checker, on Opus because the stage had rolled back. g1, g2 and g3 were all checked "better" on Opus, so
  the stage kept them, ran docs and the full suite, and finished. It did not reach the 5th rollback, because a red test
  costs no checker, and no checker can be forced to reject without a test-only hook. The 5th rollback is projected below.
  G:task-end then asked a human, because the fix and refuter returns carried open ambiguities.

| Run | Agents | Opus $ | Sonnet $ | Haiku $ | Total $ | Output tokens | Stage wall s |
|---|---|---|---|---|---|---|---|
| A, no rollback, stopped at fix g3 | 19 + main | 0 | 0.9601 | 0.0138 | 0.9739 | 27,693 | 326 |
| B, 4 rollbacks, 3 Opus checks, finished | 33 + main | 0.3978 | 1.7157 | 0.0254 | 2.1389 | 56,205 | 568 |

Per role, both runs pooled. "Main" is the Haiku session that started the stage.

| Role | Model | Runs | Low $ | High $ | Mean $ | Mean output tokens |
|---|---|---|---|---|---|---|
| Lens (code, tests, corpus misalignment) | Sonnet | 6 | 0.0684 | 0.1068 | 0.0809 | 1,800 |
| Refuter | Sonnet | 12 | 0.0297 | 0.0606 | 0.0435 | 1,172 |
| Fix: refactor-code | Sonnet | 4 | 0.0668 | 0.0939 | 0.0786 | 1,453 |
| Fix: refactor-tests | Sonnet | 6 | 0.1823 | 0.2500 | 0.2011 | 5,306 |
| Course checker | Sonnet | 2 | 0.0259 | 0.0465 | 0.0362 | 683 |
| Course checker | Opus | 3 | 0.0991 | 0.1996 | 0.1326 | 1,921 |
| update-documentation | Sonnet | 1 | 0.0756 | 0.0756 | 0.0756 | 1,117 |
| Runner | Haiku | 18 | 0.0011 | 0.0018 | 0.0012 | 449 |
| Main session | Haiku | 2 | 0.0078 | 0.0096 | 0.0087 | 2,530 |

- Prices: Opus 5.5 $4 in, $20 out; Sonnet 5.5 $2, $10; Haiku 5.5 $0.10, $0.50; 5-minute cache writes at 1.25 times input,
  1-hour at 2 times. Cache reads fitted to `modelUsage` at $0.20, $0.10 and $0.01 per MTok. Per-agent sums from the
  transcripts equal each run's `modelUsage` per model to the cent.
- Workflow agents wrote the 5-minute cache only. T1c's standalone runs wrote the 1-hour kind, at 1.6 times the price. Cost
  split in run B: cache writes 64%, output 25%, cache reads 11%.
- A Sonnet lens took 11 to 15 s, against T1c's 69 to 175 s on Opus, and read far less. A refactor-tests fix was the dearest
  agent, $0.18 to $0.25 for 4,000 to 7,500 output tokens, and the first one took 114 s.
- Repeated red retries of one group did not trip the repeated-approach refusal: each retry stated a new approach.

### `budget.spent()` against total cost

Run B is the first live figure through D9's route. `pb stage finish` read **52,309 output tokens** from the finishing
runner's transcript, and the ledger and `report.json` recorded it with `tokensKnown` true. The stage's agents wrote 53,323
output tokens, so the figure saw 98% of them. The gap is mostly the finishing runner's own reply, written after the line
was. At $2.13 for the stage that is $0.041 per 1,000 output tokens, and output was 25% of the money, as in T1c. So the
figure tracks activity well but is no dollar measure: the price per token moved 2 times between models in one run. The S4
scenarios stages read 1,473 and 1,506 output tokens the same way. Run A stopped before stage finish, so it has no figure.

### Projection across the lens map

Unit prices are the measured ranges above. Not measured, and priced instead: an Opus lens, bias check or synthesizer at 2
times a Sonnet lens ($0.14 to $0.21), since Opus 5.5 is exactly 2 times Sonnet 5.5 per token; an Opus refuter at 2 times
the dearest Sonnet refuter ($0.12); the scenario writer and PR drafter as the dearest fix agent ($0.25).

- Low: every lens once, one refuter per lens up to the cap, no fix, the stage's fixed agents.
- **Worst: every lens at its dearest, `maxRefuters` refuters all on Opus, 5 rolled-back fix attempts plus one kept attempt
  per fix group, every attempt at the dearest fixer with an Opus check, and the fixed agents.** Fix groups are one per
  lens, decision 36. A red-test rollback skips the checker, so the worst case assumes every rejection came from the checker.

| Stage | Agents low, worst | Low $ | Worst $ |
|---|---|---|---|
| intake | 2, 25 | 0.07 | 2.83 |
| plan-requirements | 15, 46 | 0.86 | 7.24 |
| plan-architecture | 13, 43 | 0.90 | 6.89 |
| plan-tracers | 12, 42 | 0.63 | 6.47 |
| plan-sequence | 9, 34 | 0.39 | 5.21 |
| scenarios | 10, 35 | 0.39 | 5.21 |
| tdd, each green-to-refactor: light reviewer and refactor agent | 1, 2 | 0.07 | 0.36 |
| refactor-scope | 1 | 0.07 | 0.11 |
| refactor-apply | 0 | 0 | 0 |
| config | 0 | 0 | 0 |
| **safety-net, new_feature and bug_fix** | 8, 40 | 0.37 | **4.75** |
| safety-net, refactoring | 8, 40 | 0.44 | 4.85 |
| safety-net, config_change | 6, 32 | 0.27 | 3.70 |
| spike-unit | 0 | 0 | 0 |
| spike-document | 1, 18 | 0.07 | 2.81 |
| pr-draft: lint, claims, permanence | 5, 31 | 0.14 | 3.39 |
| design-domain, design-gallery | 0 | 0 | 0 |
| design-build critique, per iteration | 6 | 0.41 | 0.64 |

| Roll-up | Low $ | Worst $ | T1c low, high $ |
|---|---|---|---|
| Planning, once per plan | 2.79 | 25.81 | 13.95, 63.14 |
| **Task: new_feature or bug_fix, 2 cycles low and 8 worst** | 0.90 | **12.81** | 6.06, 37.37 |
| Task: refactoring | 0.51 | 4.96 | 2.97, 12.30 |
| Task: config_change | 0.27 | 3.70 | 1.60, 5.17 |
| PR: 2 new_feature tasks and pr-draft | 1.95 | 29.02 | 12.12, 74.74 |
| PR: 5 new_feature tasks and pr-draft | 4.66 | 67.46 | 30.30, 186.85 |
| PR: 11 new_feature tasks and pr-draft | 10.08 | 144.35 | 66.66, 411.07 |

- The measured runs sit inside the safety-net row: run A at $0.97 and run B at $2.14. Run B with its 5th rollback added, a
  mean refactor-tests fix rejected by a mean Opus check, projects to **$2.47**, the measured figure for "forced to the cap
  with an Opus checker after the first rollback".
- In the worst safety net, the fix loop is 76% of the money: $3.62 of $4.75. The lenses and refuters together are $1.05.
- Design-build critique runs up to 3 iterations, $1.92 worst. The main session comes on top of every row, $0.01 on Haiku
  here, more on the session's own model.

### S4 against its cap

| Run | Type | Result | $ | Share of the $3 cap | Note |
|---|---|---|---|---|---|
| `s4-t84c-run1` | bug_fix | PASS | 0.0291 | 1.0% | First live token figure: 1,473 output tokens, finishing runner counted |
| `s4-t84c-run2` | new_feature | FAIL | 0.0326 | 1.1% | First live scenarios rollback crashed `pb rollback`; fixed below |
| `s4-t84c-run3` | new_feature | stopped | 0.0291 | 1.0% | The Haiku lens asked about the task's arithmetic, so G:scenarios asked a human |

S4 is far under the cap: about 1% per run. Runs 1 and 3 stopped at G:scenarios on a lens ambiguity, so this session's S4
covered only the scenarios stage, its lens, refuter, a fix, a Haiku course check and a rollback. Run 3's question was
about the sample task's own arithmetic ("10 x 2 is 20"), the same kind of question as T2b's nf 2, and the gate asking was
right. Repriced to Haiku, the worst `new_feature` safety net would be about $0.24 and the worst whole task about $0.64,
both inside $3. The smoke caps are unchanged.

### Bugs the live runs found

All three were first live exercises of the fix loop and `pb rollback`. Each was fixed test-first in its own commit, and
the runs after them passed the same points.

- **`pb rollback` crashed on a run with no checkpoint yet.** `checkpoints` is an optional ledger field, and the rollback
  read it unguarded, so the first rollback of a fresh run's scenarios stage failed with `Cannot read properties of
  undefined (reading 'filter')`, and the stage stopped as a failed step. The red form had the same read. Found by S4 run 2.
- **A fix with nothing left to change stopped the safety net.** Two lenses reported the same comment defect. The fixer for
  the second group found it already fixed and, as its agent file said, returned empty lists and no ambiguity, which `pb
  checkpoint --step fix` stops on. The fixers now give the reason in `ambiguity`, and the fix loop keeps such a fix without
  a course check, since there is no new `fix.diff` to read. Found by run A. Merging duplicate findings across lenses before
  the fix loop would save the extra fixer; that is left open.
- **S4 expected the finishing runner to go uncounted.** It now expects it, and requires a known token figure, which makes S4
  the live check of D9's route.

### Where the projection is weak

- One real diff, 2 safety-net runs, 6 lenses, 12 refuters, 10 fixes, 5 checks. The ranges are extremes of a small sample.
- Opus lenses, Opus refuters, bias check, synthesizer, the scenario writer and drafter as fixers, and every plan stage were
  not measured, only repriced. Plan stages read documents, not diffs.
- No course checker rejected anything, so a rejected attempt's checker cost is the accepted ones' cost.
- Worst stacks every worst case on one stage. Treat it as a bound, not a forecast.
- A lens cost $0.07 to $0.11 here and $0.57 to $1.07 in T1c. Sonnet's price is a factor of 2 of that; shorter reads
  and the cheaper 5-minute cache are the rest. A larger diff will cost more.

## T5 verification: S4 to a draft PR

Question: does auto mode now reach a draft PR, with the safety net's lens record, a rolled-back fix with its private ref,
and no finding text in the record or the PR? Claude Code 2.1.322, 2026-11-11, `bug_fix` sample, every agent on Haiku
5.5 through S4's forced cheap model, `ANTHROPIC_API_KEY` unset in every child (S4 refuses any `ANTHROPIC_` name but the
two model aliases). Total live spend was **$0.78 of the $6 limit**, four runs, each under its $3 cap.

**Headline: run 4 passed end to end for $0.21, 7% of the cap, in 313 s. G:publish passed under the auto policy with its
binding, and `pb publish` opened one `--draft` PR on the shim into `develop`.** The safety net's three lenses kept 3
findings, the first fix was forced red and rolled back under
`refs/pairingbuddy/fix/apply-discount-percent/rollback/code-safety-net/1`, the retry was kept, and none of the 6 lens
claims showed verbatim in any ledger snapshot, the unit record, or the PR's title and body. G:task-end asked once, for
open questions in a fix and two refuter returns, and S4 answered it as the human.

| Run | Result | $ | Share of the $3 cap | What it showed |
|---|---|---|---|---|
| `s4-t85-run1` | FAIL | 0.1985 | 6.6% | Scenarios passed with the task now in the lens prompt. Lens record, red rollback with its ref. G:publish asked: the claims lens left an open question, and S4 did not answer G:publish yet |
| `s4-t85-run2` | FAIL | 0.1498 | 5.0% | First live auto pass at G:publish, with its binding. The main session then held `pb publish` back on its own. The safety net found nothing, so no fix ran and no rollback could be forced |
| `s4-t85-run3` | FAIL | 0.2241 | 7.5% | The stale README gave the corpus lens a true finding. Red, then repeated-approach rollback. G:publish asked for an open question, S4 approved as the human, the draft PR opened. S4's own gate check then put a copied `unit.json` back |
| `s4-t85-run4` | PASS | 0.2108 | 7.0% | Everything above, with G:publish passed by the auto policy |

How the rollback is forced, test-only: S4's sample carries a README the bug fix makes wrong, so the corpus lens has a true
finding, and the sample's test command runs behind `tests/smoke/force-red.mjs`, which fails the first test run of the
first safety-net fix once. Only S4's throwaway test config names it.

### Bugs the live runs found

The three product bugs were each fixed test-first in their own commit. The last one was in S4 itself, which has no tests of its own, and was fixed with the rest of S4. Run 4 passed on all four.

- **A lens never saw the task.** The scenarios lens got the scenarios, the corpus and its lens name, and said it could not
  tell which bug the task named, so G:scenarios asked a human in both T84c runs. The lens prompt now carries the task.
- **The main session ignored an auto pass at G:publish.** It read the pr-draft findings that a kept fix had dealt with as
  blocking and declined to run `pb publish`. The coding skill now says the auto pass is the approval.
- **A kept artifact-mode fix was not counted.** The pr-draft report said `fixes.attempts` 0 after a kept redraft, since only
  checkpoints and rollbacks were counted. Filed fix returns now count too.
- **S4's own confinement check left a copy of the run behind.** It put the captured run back to test a read and removed it
  only when `run/` had been missing, so a copied `unit.json` outlived the publish. It now removes only what it added.

### What stays open

- G:task-end asked in 3 of 4 runs and G:publish in 2, each for an open question in a Haiku return. The gates are right to
  ask, so S4 answers them as the human and says so in its result. A run that reaches the auto pass at G:publish needs
  none of the pr-draft returns to leave a question; run 4 had none.
- S3 was updated for the lens record and not run live (decision 68).

## T6a verification: S5 refactoring run

`node tests/smoke/s5.mjs` ran once live on the cheap model, with `ANTHROPIC_API_KEY` unset and only the alias-to-model
mapping in the child env, the recording `gh` shim and S3's repo with S2's `cart.py` as the sample.

| Run | Result | Cost (USD) | Of the $3 cap | Notes |
|---|---|---|---|---|
| `s5-run1` | PASS | 0.3051 | 10.2% | 251 s; scope (4 agents), apply (6), safety net (11), then a draft PR |

The run went scope, apply, safety net in order. One `refactor-step` commit landed (`refactor:`), and the second step came
back as nothing left to change, with its reason, since the first step had already done it. No feat or fix commit was
made. The safety-net lens record names behaviour-preservation at opus, tests and corpus-misalignment at sonnet. G:scope,
G:task-end and G:publish each asked once, every time for an open question in a Haiku return, and S5 answered them as
the human, as S4 does. No bugs were found live. The spike half of S5 comes with T6b.

## T6 verification: S5 refactoring and spike runs

`node tests/smoke/s5.mjs` ran live on the cheap model, with `ANTHROPIC_API_KEY` unset in the child env, the recording
`gh` shim, and one shared spend cap. Each half runs on its own fresh S3 repo.

| Run | Result | Cost (USD) | Notes |
|---|---|---|---|
| `s5-t91-run1` | FAIL | 0.3322 | Refactoring passed. Spike: the main session stopped in setting-up-spike to ask in chat (no AskUserQuestion under `claude -p`), so no run opened. Fixed in b9d7a48. |
| `s5-t91-run2` | FAIL | 0.4114 | Refactoring passed. Spike: both units ran and G:unit repeated once, but the tap dropped the write-up's fix return (no fixer entry for code-spike-document) and `pb rollback --artifact` crashed on the missing artifact, so the stage stopped step-failed. Fixed in 64d40aa. |
| `s5-t91-run3` | PASS | 0.4846 | Refactoring: 1 refactor commit, no feat or fix commit, draft PR, 260 s. Spike: 2 units explored (two `chore:` commits), one `docs:` write-up commit, no publish run, no PR, unit closed, 259 s, $0.21. |

All three runs together spent $1.23 of the $3 ceiling. In run 3, G:task-end and G:publish asked once each in the
refactoring half, and G:unit and G:task-end once each in the spike half, every time for an open question in a cheap-model
return. S5 answered them as the human, as S4 does.
