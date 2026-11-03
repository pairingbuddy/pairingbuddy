# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `bug_fix` runs on the new path (Task 46): it joins the migrated types in `contracts/stages.json` and the coding skill. Its coverage check arrives with T2b
- `pb run open` refuses a task type with RED and GREEN when any runner in `test-config.json` has no `selector_template`, and names the fix. No template is guessed, because a wrong one can pass a test that never ran. A `config_change` needs none
- Smoke S2, `node tests/smoke/s2.mjs`: `/pairingbuddy:code` on a pytest sample repo, asserting stage order, the one placeholder commit, one RED and one GREEN commit per test, `tests{}` exit codes and gate sources. `tests/smoke/run-recorder.mjs`, test tooling only, saves spawn events, ledger snapshots and timing under `tests/smoke/recordings/` for the T4a replay rig
- `pb checkpoint --step placeholders|red|green` (Task 44): the key names the test and the row in the tests artifact supplies its selector, so no caller can choose what runs. RED needs a configured failure exit code on that one test, and GREEN needs exit 0 on it. The type is `test` at RED and `fix` or `feat` by task type at GREEN. Each test's run lands in `ledger.tests.perTest`, a refused one included, and the stage report carries its RED excerpt. RED may change only the test directory and cannot leave its test out, and GREEN cannot touch the test
- `selector_template` in `test-config.json`: the argument words that select one test, for example `["{test_file}::{test_function}"]`. RED and GREEN refuse a runner with none, because a run of a file cannot speak for one test in it. `pb test` uses it too, and records whether its result is per test or per file
- `test_function` accepts pytest's class path, `Class::test_name`. `::` means nothing else, and `pb` now checks both selector fields itself as well as the schema
- `code-tdd` stage (Task 45): placeholders, then for each test `implement-tests`, RED, `implement-code` and GREEN, one test at a time. A refusal goes back to a new agent at the next round, three tries per step. The script counts its spawns and stops at `stageMaxAgents` with `agent-budget`, and a re-run continues from `tests.perTest`. `pb tdd state` and `pb stage stop <reason>` are new runner verbs, auto-allowed only in their exact forms, and `tests:cycle` is new evidence that every test stands through RED and GREEN
- The `bug_fix` graph holds `code-scenarios`, `code-tdd` and `code-safety-net` with `G:scenarios` and `G:task-end`
- A test covered by an earlier GREEN (D16): when a test passes at its RED after at least one GREEN of the same task, `pb checkpoint --step red` keeps it, commits it as `test`, records it in `tests.perTest` as `covered` with its exit-0 run and the earliest GREEN before it, and prints `outcome: "covered"`. `code-tdd` then skips its GREEN, `pb checkpoint --step green` refuses it, `pb tdd state` lists it under `covered`, and `tests:cycle` counts it as closed. The stage report and `pb status` list it under `covered`, so the human sees a test that never failed. A test that passes before any GREEN is still refused at RED, as one that proves nothing. S2 accepts one `test` commit for such a test, and an open-scope `--task` is how a run meets one
- `pb checkpoint --step placeholders` refuses a tests row whose `test_function` is already in its `test_file` at the commit before the task's first placeholders, and names it. Such a test passes at its first RED, so RED could only refuse it later and stop the stage. The refusal is not a stop: `code-tdd` hands it to a new placeholders agent as it does any other. The checkpoint records that commit as `base`, so a re-run does not find its own placeholders there. `create-test-placeholders` lists only the tests it creates, never one already in the repo
- An `implement-tests` return's ambiguity no longer stops a gate once that return's test is `covered` in `tests.perTest`: the CLI already decided to keep it. Any other ambiguity still asks. `implement-tests` is told, in the paths mode, that a pass after an earlier GREEN is the CLI's call and not a question
- `code-scenarios` stage and `G:scenarios` (Task 42): the stage calls `enumerate-scenarios-and-test-cases` under the one input rule, with `pb_key`, `ambiguity` and the scenarios in the return, then ends with the runner's `pb stage finish`. `stages.json` holds the bug_fix graph and a new `migratedTypes` list, so a graph can land ahead of its flip: `pb run open` opens only migrated types, and bug_fix stays on the old path until Task 46. A non-empty `ambiguity` makes `pb gate eval` ask under auto
- A redo at a gate appends the human's note from the dialog to `human-guidance.json`, or a line saying the attempt was sent back when there is none, and the stage re-runs at the next attempt
- `create-test-placeholders`, `implement-tests` and `implement-code` follow the one input rule (Task 43): a `<paths>` block means no human review and a StructuredOutput return with `pb_key`, `ambiguity`, `commit_subject` and `files_changed`, and no block means the legacy files. The tests artifact holds one structured selector per row, with `test_id`, `test_file` and `test_function` constrained by schema
- Label contract reviewed against every D8 lens-map row (Tasks 40, 41): a refuter's `item` and `pb_key` carry the finding id it attacks, `contracts/schemas/refuter-verdict.schema.json` carries it too, and `readLabel` reports a label failing the regex as unknown. Label parts now follow the key's token rule, and a course checker cannot take the lens round.
- With no run state, `hooks/gate.mjs` denies a Workflow call naming a stage, or carrying a built-bundle copy, and points at `/pairingbuddy:code`, which opens the run. The stage names come from `contracts/stages.json`, read for Workflow calls only, and every other call stays silently allowed. If the contract or its loader fails, `pairingbuddy:` names are denied. Stage `meta` descriptions now say they are internal, and `commands/plan.md` and `commands/design-ux.md` name their skills in full
- Smoke S1 now runs `/pairingbuddy:code <task>` in one `claude -p` session on a branch made from main, and also asserts that run state is gone and, with no model, that out-of-order calls are denied. Per-run results are in `docs/spikes/workflow-platform-spike.md`
- Stop hook `hooks/stop.mjs` (D13): in every mode, with no stage running, it tells the model the next action through the block form probe P5 recorded. A stop, or a stage with no recorded run past its start lease, counts as not running, and the text gives the real remedy and the task stored in the ledger. It speaks only to the session that owns the run, or to any session while the run has no owner, and stays silent under Solo. One action is told once per session, with a notice per session, and a chain of changing actions has a ceiling, so a turn cannot loop. SessionStart reports open run state, the compact hook injects `pb status` and the next action in place of the guardian reminder, the guardian reminder is reworded while run state exists, and `pb run open` names the stop when it refuses the next task.
- Migrated-types router in `skills/coding/SKILL.md` (Section 7): `/pairingbuddy:code` sends a `config_change` to the workflow stages, and every other type, plan task and Solo run stays on the old path with no run state. `pb run open` takes `taskType` from `.pairingbuddy/task-classification.json`, and refuses a type with no stage graph, a malformed file, and Solo. `commands/code.md` passes the plugin root and the human's text as data, with no `allowed-tools`
- Recovery drill in `tests/drills/`: `force_wedge.mjs` forces each wedged run on demand, one flag per wedge, on a throwaway clone it made itself, and refuses this worktree or any other repo. `CONTRIBUTING.md` gains the recovery recipe, one section per wedge, and `tests/drills/test_wedges.py` runs each recipe's commands against its forced wedge
- Smoke S1 in `tests/smoke/`: a sample repo and a capped `claude -p --plugin-dir` runner on a cheap model with a clean env, asserting stage order, one commit, the gate source and a refused `pb stage finish`, outside pytest and `pb test --full`. The sample-task spike is recorded in `docs/spikes/workflow-platform-spike.md`
- `code-safety-net` stage (Section 4), lens-free for now: `update-documentation`, then the runner running `pb checkpoint --step docs`, `pb test --full` and `pb stage finish`. `code-config` now also ends with the runner, and the runner takes a list of commands. `stages.json` requires `checkpoint:docs`, which a no-change docs step satisfies
- `pb task end` (D12, D16): refuses an unfinished stage, a stop, an unpassed gate or a dirty tree, in that order and with the remaining files listed, ticks the plan box by title when the run has a plan, and removes `run/task/` alone. `shared-node/plan-boxes.mjs` holds the only checkbox writer
- `update-documentation` follows the one input rule: a `<paths>` block in the prompt means no human review and a StructuredOutput return with `pb_key`, `commit_subject` and `files_changed`, and no block means the legacy files
- `pb checkpoint --step config|docs --from <key>` (D16), in `shared-node/checkpoint.mjs`: granular commits with the type fixed by the step, and subject and paths read from the current stage's artifact. It stages only the listed paths, refuses `.pairingbuddy/`, paths outside the repo, symlinks out and protected branches, runs the full suite first, adds no trailer, and appends each commit to `ledger.commits`. A hook that changes files gets one retry, and a second failure or a signing failure sets `ledger.stop`. The gate auto-allows the runner's exact form
- `pb gate eval` with the gate policy (D4, D13): `hooks/gate.mjs` records `permission_mode`, or Solo's `PAIRINGBUDDY_GATE_POLICY=auto`, into the ledger when it changes, `continue` gates pass under `auto` with `source: auto`, and every other mode and each always-stop condition asks with the `PB gate: <name>` question. `hooks/tap.mjs` records the human's answer, a second eval with no answer prints the `!` command, stage order refuses a gate without an approval, and an `AskUserQuestion` carrying its own answers is denied. Rules live in `shared-node/gates.mjs`
- T0 platform probes in `tests/probes/`: a re-runnable harness, fixture plugin and captured hook payload fixtures, with results recorded in `docs/spikes/workflow-platform-spike.md`
- Runbooks and fixtures for the T0 human probes in `tests/probes/human/`
- Workflow bundler `scripts/build-workflows.mjs`: bundles stage modules from `workflows-src/` into `workflows/`, with a `--check` mode that fails on drift between committed output and source
- Workflow control-flow harness `tests/js/harness.mjs`, run through `tests/test_js_suite.py` under `uv run pytest`
- Run ledger with stage keys and workflow labels, and the `pb run open` command to open a run
- Tap hook `hooks/tap.mjs`: captures agent returns into run state, and does nothing outside a run
- Added the `apply-config-change` agent and the direct `code-config` workflow stage (`workflows-src/stages/code-config.mjs`, built to `workflows/code-config.js`). The bundler inlines shared-node modules via `// pb-inline-module PATH`.
- Gate hook `hooks/gate.mjs` with the stage graph `contracts/stages.json`: during a run it enforces stage order, one active stage, `attempt`, `pluginRoot` and the built bundle, and denies a main-context `Agent` call for a pipeline agent. A stage must be called as `pairingbuddy:<stage>`, a stage with no built bundle or a `scriptPath` the hook cannot read is denied, and an active stage with no recorded `runId` can be restarted at the same attempt once its 120-second start lease, counted from the new ledger field `stage.startedAt`, has expired
- Gate hook fails closed: during a run it denies `Write`, `Edit` and `NotebookEdit` on `.pairingbuddy/run/**`, `test-config.json` and `git-config.json`, denies plan checkbox changes, and denies on any hook error and on platform drift in the payload. It finds run state by walking up from the cwd and the target path, with no git call, and its rules moved to `shared-node/gate-rules.mjs`. An empty `.pairingbuddy/run/` no longer stops that walk, and `hooks/tap.mjs` now uses the same `shared-node/run-root.mjs` walk instead of `git rev-parse`, so a git repo nested inside a run reaches the run
- CLI verb table `shared-node/verbs.mjs`, used by `cli/pb.mjs` and the gate. The gate now covers `Bash`: during a run it denies `pb human` in any command text, denies a verb from the wrong caller class, and auto-allows the runner's exact CLI command
- `pb human approve <gate>` and `pb human accept`, reachable only by a human `!`. `approve` passes the due or pending gate with `source: human-cli`, and refuses a ledger with a SHA mismatch, pointing to `accept`. `accept` re-signs a hand-edited ledger that is otherwise well-formed and records it in the new optional ledger field `acceptances`
- Run binding: the gate claims `ledger.owner` for the first main-context session it sees in a run, and writes a session pointer under `<os.tmpdir()>/pairingbuddy-sessions/`. `gate.mjs` and `tap.mjs` read it when the walk from the cwd finds nothing, so every rule holds after `cd /tmp`. The printed `!` commands start with `cd <run root> &&`
- Gate answers take effect: `redo` clears the gate record and the stage's done state so the stage restarts at the next attempt, `stop` sets `ledger.stop`, and `pb human approve` also passes a gate answered either way, clearing the stop
- `pb test` and `pb test --full`, with the `runner` agent that calls them (D5, R3). The human-owned command is split into words and spawned with no shell, and the CLI records exit code, signal, timeout and a bounded excerpt in `ledger.tests`. `--full` runs every configured runner, and plain `pb test` takes its test files from the current attempt's tests artifact. RED counts only for the new optional runner field `failure_exit_codes`, default `[1]`. The new optional `timeout_seconds`, default 540, kills the whole process group. A changed config hash refuses
- `pb stage finish`, `pb stage report`, `pb stage fail`, `pb artifact check` and `pb status` (D3, D9), in `shared-node/stage-run.mjs`. `stage finish` takes no arguments, reads the stage from the ledger, refuses unless the `contracts/stages.json` evidence (`artifact:<role>`, `checkpoint:<step>`, `tests:<run>`, now validated) is present at this attempt and the stage has a recorded run, leaves a stop when it is not, and writes `report.json` stamped with the attempt, stating what ran and what was not covered. `stage fail` closes the active stage for a restart at attempt+1 and clears a stop the run raised, never a human's. Returns and reports of a voided attempt no longer count in evidence or gates, and the tap drops late returns to a failed attempt. `pb checkpoint` records each step, a no-change step included, in the new optional ledger field `checkpoints`. `status` prints stage and task spend against the new contract field `maxAgents`: agents from recorded returns, and output tokens as 0 and unknown until a stage can supply `budget.spent()`

### Changed

- An ambiguity a human approved at a gate no longer asks again at a later gate. Approving a gate settles the returns of its stage and every stage before it, an auto pass settles nothing, and a gate now names every open return, since approving it settles them all
- `commands/code.md` names `pairingbuddy:coding` and its path, and warns off itself and the stages, because "the coding skill" sent every S1 session to the command itself
- `curate_guidance` asks nothing under the auto policy or `claude -p`: it carries the guidance over silently, and the gate denies its question under the auto policy, so it no longer ends a headless run before a run opens
- With no run the gate also denies a direct Agent call for an agent listed in `newPathAgents` in `contracts/stages.json`, a bundle copy differing only in trailing whitespace, and a script naming a stage or one of those agents literally
- `/pairingbuddy:code` with a run already open reports the run's next action and touches nothing, and `pb status --action` gives that action. Under Solo the gate denies a stage start
- `pb run open` stores the task from `.pairingbuddy/task.json` in the ledger, and the gate refuses a `<this task>`-style placeholder as `args.task`
- The run reminder reaches the main context only, not a stage's agents
- The gate denies a stage start with no `task`, where the stage used to refuse inside the workflow and strand itself active. `pluginRoot` was already denied
- `hooks/gate-boot.mjs` is now the registered PreToolUse command. It imports `gate.mjs` dynamically, so a syntax error there denies during a run and names the recovery, instead of failing open. A syntax error in `gate-boot.mjs` itself still fails open. `force_wedge.mjs` gains `--gate-boot-parse`, and `--gate-parse` now denies
- `pb checkpoint --step config` takes no change only from a return with an empty `files_changed` and a non-empty `ambiguity`, which the task-end gate then asks about. A return listing a file that did not change, an empty one with no ambiguity, or no return at all refuses and stops the run, so a refused edit can no longer leave `code-config` done. A no-change docs step stays valid
- The active-stage deny says that a stranded stage is cleared by the human running `pb stage fail`
- The `pb takes literal words` rule reads the shell structure: a bare `pb` counts only in command position or after a known wrapper, and a whole `pb.mjs` counts anywhere except as a quoted argument of a text command, so a word or pattern that merely mentions pb stays untouched
- `pb checkpoint` re-checks the key against the ledger after the tests and under the lock when recording, and stamps a record from its key. A checkpoint orphaned by `pb stage fail` is refused, commits nothing and raises no stop. After the tests it also re-checks the branch, HEAD and the staged paths, and any difference stops the run with nothing committed. The branch is read at the run root, not the cwd, and a listed directory that is gone is refused
- `pb stage fail` clears a run-raised stop in any stage state, and a human's `stop` stays refused
- `pb run open` validates `test-config.json` before hashing it, and `pb human accept` also takes a changed `test-config.json`, re-pinning `configHash` and recording old and new in `ledger.configAcceptances`
- During a run the gate denies any `pb` call under an assignment or the `env` command, and counts a `pb` name followed by a known verb in any position of a simple command, apart from the arguments of text commands such as `grep`, so `env -u`, `node -r`, `find -exec` and `coproc` forms are invocations
- The tap files a return only from the agent its key names, `pairingbuddy:<role>`
- `pb test` takes a selector only from under the runner's `test_directory`, and refuses a leading `-` or `@`
- `pb test` records the HEAD it ran from. `pb stage finish` and `pb task end` refuse once HEAD has moved past a green full run, and `pb task end` refuses a recorded commit that left HEAD's history. `.pairingbuddy/` no longer counts as dirty in `pb task end`
- Runner commands quote the plugin path, and the gate's auto-allow matches the quoted form
- `update-documentation` returns `ambiguity`, which the task-end gate reads as it does for `apply-config-change`
- A gate question must equal the question `pb gate eval` emitted, alone in its call, at PreToolUse and in the tap. Plan checkboxes compare by task title. `pb gate eval` through the gate denies when the policy cannot be recorded. A SHA mismatch names the `!... human accept` command from the CLI and from hook denies. During a run, `Write`, `Edit` and `NotebookEdit` are denied on `.claude/settings.json` and `.claude/settings.local.json`, and any `pb` or `pb.mjs` text with a shell expansion or glob after the name, an `xargs` feeding `pb` or `pb.mjs`, or another letter case of `pb.mjs`, is denied. A lock file with a future mtime counts as stale

## [0.7.0] - 2026-07-31

### Added

- Solo Buddy: autonomous execution mode via `scripts/solo-buddy.sh`
  - Shell script entry point with `claude -p`, env var signal, API key safety (unsets `ANTHROPIC_API_KEY` by default)
  - Guardian hook Solo mode: halved injection cadence (2 min), Solo constraint prompt on SessionStart
  - 15 agents with Solo Mode section: skip Step 3 Human Review when `PAIRINGBUDDY_SOLO=true`
  - Coding orchestrator Solo mode: `_ask_human` auto-yes, strict scope, sequential execution, resource exhaustion before stopping, bug handling, quality compliance
  - `SOLO_BUDDY_REPORT.md` incremental report generation with session resumability
  - Push-to-remote and GitHub PR creation on success via `gh pr create`
- Solo Buddy observability
  - Live terminal renderer: styled progress bar, task list (✓/→/○), spinner on active task, colored agent names
  - Guardian-based agent tracking: guardian writes `lastAgent`/`lastTool`/`lastDescription` to session file on every tool call
  - Renderer reads source files directly (plan MD, task.json, guardian session file) — independent of hook reliability
  - `hooks/solo-progress.mjs`: append-only progress log for post-session analysis
  - Current test file surfaced in `solo-status` and the progress log, read from `current-batch.json` with `tests.json` as fallback
  - Final 100% status display on completion with PR/report links
- `caffeinate -s` sleep prevention for macOS (prevents App Nap/system sleep during unattended runs)
- Report reconciliation on resume: preserves entries from previous sessions, drops stale entries for tasks removed from plan, maintains correct ordering
- Branch guard: refuses to push/create PR on main/master

### Changed

- `committing-changes` skill: added "What Not to Include" section covering no AI co-author trailers, no auto-formatting noise, and no "tests pass" notes (only call out skipped/failing tests)

### Fixed

- `hooks/solo-progress.mjs`: exits cleanly when `.pairingbuddy/` directory is absent
- `solo-buddy.sh`: `stop_caffeinate` runs first in cleanup to prevent orphan processes
- `solo-buddy.sh`: `require_positive_number` rejects all zero representations
- `solo-buddy.sh`: push branch before `gh pr create` to avoid interactive prompt in headless mode
- Output format set to `json` — `text` format causes early session termination

## [0.6.0] - 2026-03-15

### Added

- Session drift guardian: time-based `PostToolUse` hook that re-injects workflow compliance reminders every 5 minutes of activity, plus always after context compaction (`SessionStart:compact`), to prevent the session agent from skipping steps, avoiding subagents, or doing agent work in the main context
- `/pairingbuddy:plan` command for tracer bullet planning workflow
  - Planning orchestrator skill with adaptive brainstorming, architecture management, tracer bullet decomposition, and task sequencing
  - Four planning agents:
    - brainstorm-requirements: adaptive Socratic exploration of requirements
    - solidify-architecture: analyze/create/update architecture documents
    - decompose-tracer-bullets: decompose into thin end-to-end tracer bullet slices
    - sequence-tasks: sequence tasks within TBs and write plan markdown document
  - Two new reference skills:
    - decomposing-tracer-bullets: tracer bullet methodology and thin E2E slicing patterns
    - sequencing-tasks: task sequencing for TDD-ready plans
  - Four new JSON schemas: plan-config, plan-requirements, plan-architecture, plan-tracer-bullets
  - Plan state isolated in `.pairingbuddy/plan/` (not affected by `/code` cleanup)
  - Plan resumability: detect existing plan, offer resume/re-plan/start fresh
- `/code` plan execution mode
  - Detects plan MD files and iterates through unchecked tasks
  - Claude Code Task visibility for in-session progress tracking
  - Automatic MD checkbox updates on task completion (`- [ ]` → `- [x]`)
  - Cross-session recovery via MD checkboxes (source of truth)
  - Human checkpoint between tasks

### Changed

- Convert all hooks from bash to Node.js for cross-platform compatibility
- Update using-pairingbuddy skill to reflect current architecture: three commands (/code, /plan, /design-ux), agent-based workflows, and commit step enforcement

### Fixed

- Agent output file reliability: agents with human review sometimes completed without writing output JSON files
  - Strengthened `workflow_step4_output` canonical block with mandatory verification step (read-back confirmation)
  - Removed 9 vague agent-specific one-liners ("After approval, write to X") that LLM agents misinterpreted as summaries
  - Affected agents: enumerate-scenarios-and-test-cases, identify-test-issues, identify-code-issues, brainstorm-requirements, solidify-architecture, decompose-tracer-bullets, scope-refactoring, verify-test-coverage, setup-spike
- Spike findings overwrite bug in explore-spike-unit agent: replaced vague append instruction with explicit read-modify-write steps to prevent losing previous units' findings

### Changed

- Agent count increased from 25 to 29
- Schema count increased from 35 to 39
- Skill count increased from 14 to 17 (3 orchestrators, 1 entry, 13 reference)
- Test count increased from ~881 to ~1037
- Added soft wrapping markdown formatting guideline to document-spike agent

## [0.5.0] - 2026-02-20

### Added

- Design UX skill for creating production-ready design systems
  - New orchestrator skill: designing-ux with `/pairingbuddy:design-ux` command
  - Seven new agents for the design workflow:
    - design-ux-explorer: establishes domain grounding and design intent before generation
    - design-ux-architect: makes strategic layout, color, component, and typography decisions
    - design-ux-token-generator: generates three-tier token architecture (global/alias/component)
    - design-ux-visual-builder: creates preview.html and example.html with Playwright feedback
    - design-ux-critic: evaluates designs using 6-pass UX analysis framework
    - design-ux-validator: validates structural correctness of design artifacts
    - design-ux-gallery-generator: creates web-hostable gallery for comparing explorations
  - Six new reference skills for design agents:
    - differentiating-designs: craft knowledge for intentional differentiation
    - applying-design-principles: Laws of UX, specifications, Norman's principles
    - critiquing-designs: 6-pass UX critique framework
    - building-components: component patterns and domain packs
    - generating-design-previews: preview and example HTML templates
    - generating-exploration-gallery: gallery and comparison templates
  - Fourteen new JSON schemas for design state management:
    - brand, design-artifacts, design-brief, design-critique, design-decisions
    - design-direction, design-experience-config, design-session
    - design-system-config, design-validation, domain-spec
    - exploration-status, gallery-output, tokens-generated
  - Design state lives in `.pairingbuddy/design-ux/{exploration-name}/`
  - Parallel exploration support with isolated session state
  - Web output: preview.html, example.html with Tailwind CDN and dark mode
  - Three-tier token architecture: global tokens → alias tokens → component tokens
  - Multi-brand architecture support via brand.schema.json

### Fixed

- Front-loaded file restrictions in explore-spike-unit to prevent /tmp writes
  - Moved file creation restrictions to start of Step 2 (before main work begins)
  - Previously restrictions came after instructions, causing LLM to create markdown files in /tmp

- Made state file cleanup explicit in workflow pseudocode
  - Added `_cleanup_state_files()` orchestrator function with crystal-clear description
  - Added mandatory call in workflow after `curate_guidance`, before `classify_task`
  - Previously cleanup was only described in prose, causing Claude to skip it

### Changed

- Agent count increased from 18 to 25
- Schema count increased from 21 to 35
- Skill count increased from 7 to 14 (2 orchestrators, 1 entry, 11 reference)
- Test count increased from ~565 to ~881

- Upgraded models for better task performance
  - implement-tests: haiku → sonnet (tests may require design decisions beyond mechanical translation)
  - refactor-tests: haiku → sonnet (consistency with refactor-code which was already sonnet)
  - explore-spike-unit: sonnet → opus (spikes involve complex research and exploration)
  - identify-test-issues: haiku → opus (critical quality gate - misses have compounding effects)
  - identify-code-issues: haiku → opus (critical quality gate - misses have compounding effects)

- Improved curate-guidance agent to show actual entries during human review

- Replaced `summarize-spike` agent with `document-spike` agent
  - Now MANDATORY at end of spike workflow (was optional)
  - Creates comprehensive documentation capturing ALL findings (not a summary that loses information)

- Improved Human Review step to require comprehensive descriptions
  - Updated canonical `workflow_step3_human_review` content block with explicit instructions
  - All 10 agents with Human Review updated to match new canonical content

- Added mandatory output file writing instructions to Step 4: Output
  - New canonical `workflow_step4_output` content block with explicit Write tool requirements
  - Three write modes: "Writes to" (overwrite), "Appends to" (read-add-write), "Updates" (read-modify-write)
  - All 10 agents with Step 4: Output updated to match new canonical content

## [0.4.0] - 2026-01-06

### Added

- curate-guidance agent for selective carry-over of human guidance between tasks
  - Analyzes existing guidance entries and classifies as task-specific (drop) or general (keep)
  - Proposes consolidation of similar entries into principles
  - Human checkpoint for approval with ability to modify or add new entries
  - Supports bootstrap mode when no existing guidance (offer to seed persistent guidance)
- Persistent guidance feature via `persistent` field in human-guidance.schema.json
  - Entries with `persistent: true` survive cleanup between tasks
  - Preserves operational knowledge (how to run tests, where to document, coding preferences)

### Changed

- Agent count increased from 17 to 18
- Human review checkpoint count increased from 9 to 10
- Updated orchestrator workflow to invoke curate-guidance before task classification
- human-guidance.json now persists across tasks (like test-config.json and doc-config.json)

## [0.3.0] - 2025-12-17

### Added

- update-documentation agent for keeping docs in sync with code changes
  - Analyzes code changes and identifies documentation needing updates
  - Supports both in-repo and external documentation locations
  - Human checkpoint before making updates
  - New persistent doc-config.json for documentation locations
  - New docs-updated.json output for commit context
- Two new schemas: doc-config.schema.json, docs-updated.schema.json
- Agent count increased from 16 to 17
- Schema count increased from 19 to 21

### Changed

- Restructured Human Review workflow with explicit Step 1-4 pattern:
  - Step 1: Read Inputs (always includes human-guidance.json first)
  - Step 2: Main Work (agent-specific analysis)
  - Step 3: Human Review (with retry loop back to Step 2 on feedback)
  - Step 4: Output (only after explicit approval)
- Moved Human Review content into Step 3 (removed separate ## Human Review section)
- Added canonical content blocks: workflow_read_inputs, workflow_step3_human_review
- All 9 agents with Human Review now enforce: read guidance first, redo work after feedback, never proceed to output without approval
- Test count changed from ~500 to ~565
- Refactor agents (refactor-tests, refactor-code) now run targeted tests with verify-fix loop:
  - Run only modified test files or tests that exercise modified code (not entire suite)
  - Retry loop: if tests fail, analyze and fix before proceeding
  - Ask human operator if stuck after 3 attempts

## [0.2.0] - 2025-12-17

### Added

- Spike workflow for exploratory coding without TDD
  - Three new agents: setup-spike, explore-spike-unit, summarize-spike
  - Five new schemas for spike state management
  - New task type "spike" in classify-task agent
- Human guidance persistence across agents via human-guidance.json
- Focus warning in all agents to prevent scope creep
- Human review checkpoints in setup-spike and explore-spike-unit agents
- Architecture documentation (ARCHITECTURE.md)
- Claude Code context file (CLAUDE.md)

### Changed

- Human review section integrated into Instructions via markdown links
- Expanded agent count from 13 to 16
- Expanded schema count from 14 to 19
- Expanded test count from ~300 to ~500

## [0.1.0] - 2025-12-13

### Added

- Agent-based architecture replacing nested skill structure
  - Thirteen TDD agents with single-responsibility design
  - JSON state contracts between agents
  - Python pseudocode workflow in orchestrator
- Core TDD workflow agents
  - classify-task: Determine task type (new_feature, bug_fix, refactoring, config_change)
  - enumerate-scenarios-and-test-cases: Analyze requirements into test scenarios
  - create-test-placeholders: Create test file structure
  - implement-tests: RED phase - write failing tests
  - implement-code: GREEN phase - write minimal passing code
  - identify-test-issues and refactor-tests: REFACTOR phase for tests
  - identify-code-issues and refactor-code: REFACTOR phase for code
  - verify-test-coverage: Coverage verification with gap detection
  - run-all-tests: Final test suite verification
  - commit-changes: Git integration
  - scope-refactoring: Entry point for refactoring workflow
- Reference skills for language-specific guidance
  - writing-tests: Test patterns, FIRST principles, anti-patterns
  - writing-code: SOLID principles, Clean Code practices
  - refactoring-code: Code smell identification, refactoring techniques
  - enumerating-tests: Test scenario enumeration patterns
  - committing-changes: Git commit best practices
- Contract-driven development infrastructure
  - Fourteen JSON schemas for state validation
  - agent-config.yaml as single source of truth
  - Approximately 300 structural tests
- Human review checkpoints in six agents
- Entry point command: /pairingbuddy:code

### Removed

- Nested skill architecture (replaced by flat agents)
- Direct superpowers dependency
