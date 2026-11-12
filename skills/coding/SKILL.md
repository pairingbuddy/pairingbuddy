---
name: coding
description: Orchestrates TDD workflow by invoking specialized agents. Manages state via JSON files in .pairingbuddy/. Use for building features, fixing bugs, or any coding task requiring tests.
---

# Coding Orchestrator

Orchestrates the TDD workflow by invoking specialized agents via the Task tool. Each agent reads input JSON, performs one operation, writes output JSON.

## An Open Run Comes First

Before anything else, run `pb status --action`. `<root>` is the plugin root the command passed. With none, it is two levels above this skill's base directory. `pb` here and below means `node <root>/cli/pb.mjs`.

- If it refuses with `no run here`, no run is open: go on to the workflow.
- If it prints a status, a run is open. Do not clean state or classify, do not curate guidance, and do not start the new task. Cleanup would delete what the run still needs. Report the status's `action`, which is the next action, and the new task you did not start, then stop.
- If it refuses any other way, a run is there and cannot be read. Report the refusal and stop.

Solo takes the same check: no stage starts under Solo, so a run left open stops it here.

## CRITICAL: Follow the Workflow Exactly

**You MUST follow the workflow pseudocode exactly as specified.** Do not skip steps, reorder agents, or deviate from the sequence. The workflow exists because each agent depends on the output of prior agents.

If you think a step doesn't apply, you are probably wrong. The workflow handles edge cases. Follow it.

## State File Mappings

State files live in `.pairingbuddy/` at the git root of the target project.

| Variable | File | Schema |
|----------|------|--------|
| task | .pairingbuddy/task.json | task.schema.json |
| task_classification | .pairingbuddy/task-classification.json | task-classification.schema.json |
| test_config | .pairingbuddy/test-config.json | test-config.schema.json |
| human_guidance | .pairingbuddy/human-guidance.json | human-guidance.schema.json |
| scenarios | .pairingbuddy/scenarios.json | scenarios.schema.json |
| tests | .pairingbuddy/tests.json | tests.schema.json |
| current_batch | .pairingbuddy/current-batch.json | current-batch.schema.json |
| test_state | .pairingbuddy/test-state.json | test-state.schema.json |
| code_state | .pairingbuddy/code-state.json | code-state.schema.json |
| test_issues | .pairingbuddy/test-issues.json | issues.schema.json |
| code_issues | .pairingbuddy/code-issues.json | issues.schema.json |
| files_changed | .pairingbuddy/files-changed.json | files-changed.schema.json |
| coverage_report | .pairingbuddy/coverage-report.json | coverage-report.schema.json |
| all_tests_results | .pairingbuddy/all-tests-results.json | all-tests-results.schema.json |
| commit_result | .pairingbuddy/commit-result.json | commit-result.schema.json |
| spike_config | .pairingbuddy/spike-config.json | spike-config.schema.json |
| spike_questions | .pairingbuddy/spike-questions.json | spike-questions.schema.json |
| spike_findings | .pairingbuddy/spike-findings.json | spike-findings.schema.json |
| spike_summary | .pairingbuddy/spike-summary.json | spike-summary.schema.json |
| current_unit | .pairingbuddy/current-unit.json | current-unit.schema.json |
| doc_config | .pairingbuddy/doc-config.json | doc-config.schema.json |
| docs_updated | .pairingbuddy/docs-updated.json | docs-updated.schema.json |

## How to Execute This Workflow

The Workflow section below contains Python pseudocode - a specification, not executable code. This section explains how to interpret and execute it.

### Reading the Pseudocode

- **Function calls** map to agent invocations
- **Variable names** map to JSON file paths (see State File Mappings)
- **Underscores** in function names become **hyphens** in agent names
  - `enumerate_scenarios_and_test_cases()` → agent `enumerate-scenarios-and-test-cases`

### Agent Invocation

Each function call translates to a Task tool invocation:

```
Task tool:
  subagent_type: pairingbuddy:<agent-name>
```

Agents are self-contained - they know what to read (Input section), what to do (Instructions), and what to write (Output section). No prompt needed.

### Control Flow

Interpret control flow statements as orchestration logic:

- `for test in tests:` → Read tests.json, iterate over each test entry
- `test_issues = identify_test_issues(...)` then `if test_issues:` → Invoke agent, then check if test-issues.json contains items
- `while condition:` → Loop until condition is false

### Orchestrator Functions

Functions prefixed with `_` are **orchestrator logic**, not agent calls. The orchestrator implements these directly:

| Function | Behavior |
|----------|----------|
| `_cleanup_state_files()` | **MANDATORY.** Delete ALL `.pairingbuddy/*.json` files EXCEPT: `test-config.json`, `doc-config.json`, `git-config.json`, `human-guidance.json`. These four files persist across tasks, and the `.pairingbuddy/reports/` folder is kept too (the cleanup deletes only `*.json`). All other state files (task.json, task-classification.json, scenarios.json, tests.json, spike-*.json, etc.) MUST be deleted to start fresh. This prevents stale state from previous tasks from affecting the current task. |
| `_filter_pending(tests)` | Filter tests.json to return only tests not yet processed in this session |
| `_filter_pending(spike_questions)` | Filter spike-questions.json units to return only units with status "pending" |
| `_mark_unit_answered(spike_questions, unit_id)` | Update unit status to "answered" in spike-questions.json |
| `_ask_human(question)` | **Interactive mode:** Present question to human, return true/false based on response. **Solo mode** (`PAIRINGBUDDY_SOLO=true`): Return `true` for all checkpoints (auto-yes). Exception: if the orchestrator has tracked N consecutive retry failures on the current task (where N = `PAIRINGBUDDY_SOLO_MAX_RETRIES` env var, default 5), return `false` to trigger a stop. |
| `_stop(message)` | Stop workflow execution and report message to human. In Solo mode, also write the stop reason to `.pairingbuddy/SOLO_BUDDY_REPORT.md` (see Solo Mode section below). |
| `_detect_plan_file(task)` | Check if the task description references a plan MD file path. Returns true if a plan file is detected. |
| `_read_plan_tasks(plan_path)` | Parse the plan MD, extract tasks with their checkbox state (checked/unchecked), index, title, and full description |
| `_next_unchecked_task(plan_tasks)` | Return the first unchecked task from the parsed plan tasks |
| `_mark_task_complete(plan_path, task_index)` | Update `- [ ]` to `- [x]` in the MD file for the given task index |
| `_hydrate_claude_tasks(plan_tasks)` | Create Claude Code Tasks (TaskCreate) for all plan tasks, marking completed ones. Provides in-session visibility. |
| `_update_claude_task(task_id)` | Mark a Claude Code Task as completed (TaskUpdate) |
| `_is_solo()` | True when the `PAIRINGBUDDY_SOLO` env var is `true`. |
| `_stop_if_run_open()` | The check in An Open Run Comes First. |
| `_stop_if_unit_open()` | If `.pairingbuddy/run/unit.json` exists, stop and tell the human the open unit's branch (read from unit.json) and that the old path cannot run inside a unit. They can finish the unit's work on the new path, or leave it by running `pb human abandon` (human-only: they type `!cd <project root> && node <root>/cli/pb.mjs human abandon`, which removes the unit and task state and keeps every commit). |
| `_write_task(task)` | Write the new task to `.pairingbuddy/task.json`. It waits for cleanup: curation reads the just-completed task from that file, and cleanup deletes it. |
| `_curating_guidance(task)` | Runs the curating-guidance skill in the main context, before cleanup, outside Solo (plan tasks included). With no human it carries guidance over silently. |
| `_setting_up_spike(task)` | Runs the setting-up-spike skill in the main context. It runs inside `_run_new_path(task)`, after G:type, for a spike. |
| `_run_plan_loop(plan_path)` | Runs a plan outside Solo, one task at a time, on the new path. See Plan Loop. |
| `_run_new_path(task)` | Runs a migrated type through its workflow stages. See Migrated-Types Router. |
| `_update_solo_report(event, details)` | **Solo mode only.** Create or append to `.pairingbuddy/SOLO_BUDDY_REPORT.md`. Called with event `"start"` (creates file if absent; on resume, **reconciles** existing entries against the current plan — drops entries for removed tasks, reorders to match plan, then appends session separator), `"task_complete"` (appends task entry), or `"stopped"` (appends stop entry, updates header). See Solo Mode section for report template. No-op in interactive mode. |

These functions handle coordination, human interaction, and control flow that doesn't belong in agents.

## Workflow

**Prerequisites:** Before starting, ensure `.pairingbuddy/test-config.json` exists. See "Bootstrap test-config.json" in Orchestrator Behavior.

```python
# A run already open ends the task here, before anything touches state
_stop_if_run_open()

# Plan execution mode: iterate through tasks from a plan MD file
if _detect_plan_file(task):
    plan_path = task.plan_file
    # Outside Solo, a plan runs on the new path, one task at a time (see Plan Loop)
    if not _is_solo():
        _run_plan_loop(plan_path)
        _stop("Plan loop stopped.")
    # Solo only from here: the old plan loop stays until T10
    plan_tasks = _read_plan_tasks(plan_path)
    _hydrate_claude_tasks(plan_tasks)
    _update_solo_report("start", {"plan_path": plan_path, "plan_tasks": plan_tasks})

    for plan_task in plan_tasks:
        if plan_task.checked:
            continue

        # The rich task description from the plan
        task = {"description": plan_task.description, "context": plan_task.context}

        # Run normal TDD workflow for this task (falls through to code below)
        human_guidance = curate_guidance(human_guidance, task)
        _cleanup_state_files()
        _write_task(task)
        task_classification = classify_task(task)
        _stop_if_unit_open()
        # ... (same old-path branches as below, based on task_type,
        # never the migrated-types router: Solo plan tasks stay on the old path until T10) ...

        # After successful completion:
        _mark_task_complete(plan_path, plan_task.index)
        _update_claude_task(plan_task.task_id)
        _update_solo_report("task_complete", {"plan_task": plan_task})

        # Human checkpoint between tasks
        if not _ask_human(f"Task {plan_task.index} complete. Continue to next task?"):
            _update_solo_report("stopped", {"plan_task": plan_task, "reason": "stopped"})
            break

    _stop("Plan execution paused/complete.")

# Normal (non-plan) execution continues below

# Curate guidance from previous session (always runs - handles review and bootstrap, and with no human
# it carries over silently and asks nothing)
if _is_solo():
    human_guidance = curate_guidance(human_guidance, task)  # Solo keeps the agent until T10
else:
    _curating_guidance(task)  # the curating-guidance skill, in the main context

# Clean up stale state files from previous task (MANDATORY - do not skip)
_cleanup_state_files()

_write_task(task)

# Outside Solo, intake classifies inside the run. The main session does not classify.
if not _is_solo():
    _run_new_path(task)
    _stop("Task complete.")

# Solo only: classify here and take the old branches
task_classification = classify_task(task)
task_type = task_classification.task_type  # "new_feature" | "bug_fix" | "refactoring" | "config_change" | "spike"

# The old path cannot run inside an open unit
_stop_if_unit_open()

# Old path: Solo only
if task_type == "new_feature":
    # Plan tasks and Solo only
    # Full TDD workflow with coverage verification loop
    scenarios = enumerate_scenarios_and_test_cases(task, test_config)
    gaps = None  # No gaps on first pass

    while True:
        tests = create_test_placeholders(scenarios, test_config, gaps)  # idempotent; gaps optional

        # RED-GREEN-REFACTOR for pending tests
        for test in _filter_pending(tests):
            current_batch = [test]
            test_state = implement_tests(current_batch, test_config)
            code_state = implement_code(test_state, test_config)

            test_issues = identify_test_issues(tests, test_config)
            if test_issues:
                refactor_tests(test_issues, test_config)

            code_issues = identify_code_issues(code_state, test_config)
            if code_issues:
                refactor_code(code_issues, test_config)

        # Verify coverage (reconciles tests.json, checks against scenarios)
        coverage = verify_test_coverage(scenarios, tests, test_config)

        if coverage.status == "complete":
            break

        # Human checkpoint: coverage gaps found
        if not _ask_human("Coverage gaps found. Implement missing tests?"):
            break

        gaps = coverage.gaps  # Pass gaps to next iteration

elif task_type == "bug_fix":
    # Plan tasks and Solo only
    # Bug fix: add regression test first, then fix
    scenarios = enumerate_scenarios_and_test_cases(task, test_config)  # describes the bug
    tests = create_test_placeholders(scenarios, test_config)

    for test in tests:
        current_batch = [test]
        test_state = implement_tests(current_batch, test_config)  # test should fail (reproduces bug)
        code_state = implement_code(test_state, test_config)      # fix makes it pass

elif task_type == "refactoring":
    # Plan tasks and Solo only
    # Refactoring: work on existing code/tests per task intent
    # First verify all tests pass before refactoring
    all_tests_results = run_all_tests(test_config)
    if all_tests_results.status != "pass":
        _stop("Cannot refactor: tests must pass first")

    # scope_refactoring creates issues directly from task intent
    # (skip identify agents - for large codebases they'd report ALL issues,
    # but we only want to address the specific refactoring the user requested)
    code_issues, test_issues = scope_refactoring(task, test_config)

    if code_issues:
        refactor_code(code_issues, test_config)

    if test_issues:
        refactor_tests(test_issues, test_config)

    # Verify tests still pass after refactoring
    all_tests_results = run_all_tests(test_config)
    if all_tests_results.status != "pass":
        _stop("Refactoring broke tests")

elif task_type == "config_change":
    # Plan tasks and Solo only
    # Config change: just make the change and verify tests still pass
    # No agents needed - orchestrator makes the change directly
    pass

elif task_type == "spike":
    # Plan tasks and Solo only
    # Spike: exploratory coding without TDD
    spike_config, spike_questions = setup_spike(task)

    # Initialize findings file
    spike_findings = {"findings": []}

    # Explore each unit
    for unit in _filter_pending(spike_questions):
        current_unit = unit
        spike_findings = explore_spike_unit(spike_config, spike_questions, current_unit, spike_findings)

        # Update unit status to answered
        _mark_unit_answered(spike_questions, unit.id)

        # Human checkpoint after each unit
        if not _ask_human(f"Unit '{unit.name}' explored. Continue to next unit?"):
            break  # Human can stop early or redirect

    # Document all findings and persist (mandatory, human checkpoint)
    spike_summary = document_spike(spike_config, spike_findings)

    _stop("Spike complete.")

# Final verification (all task types except spike)
all_tests_results = run_all_tests(test_config)
if all_tests_results.status != "pass":
    _stop("Final verification failed - tests not passing")

# Update documentation (human checkpoint)
docs_updated = update_documentation(files_changed, task, doc_config)

# Commit changes (human checkpoint)
if _ask_human("All tests pass. Commit changes?"):
    commit_result = commit_changes(files_changed)
```

### Task Type Definitions

| Task Type | Description | Example |
|-----------|-------------|---------|
| **new_feature** | Adding new functionality that requires new tests | "Add user authentication" |
| **bug_fix** | Fixing incorrect behavior with a regression test | "Fix login failing for users with spaces in email" |
| **refactoring** | Improving code structure, no behavior change | "Extract payment logic into separate module" |
| **config_change** | Changing configuration values only | "Update API timeout to 30s" |
| **spike** | Exploratory coding to answer questions, compare approaches, or evaluate technologies. No tests, throwaway code. | "Compare Redis vs Postgres for session storage" |

### Migrated-Types Router

Outside Solo, every non-plan task runs through workflow stages instead of the branches above. Plans outside Solo run through the Plan Loop below, which opens runs too. Only Solo, plan or not, stays on those branches and never opens a run, so it has no run state.

`_run_new_path(task)`:

1. A non-plan `/code` task is a unit of one task, so the unit opens first. If an open unit has no task records and its branch is checked out, it is the one just opened: go on to step 2 and do not run `pb unit open` again. Otherwise run `pb unit open --type <type> --slug <slug>`, with the branch type you guess from the task (`feat`, `fix`, `refactor`, `chore` or `spike`) and a short kebab-case slug from the task. The type only names the branch: intake decides the run's type. The CLI validates both.
   - There is no confirmation: a plain call opens the template branch, and `pb unit open` takes no `--yes`.
   - When it refuses with a command for the human to type, with a leading `!`, stop and show the human that command. Only the human types it. Resume at step 2 once they have.
2. Run `pb run open --kind code`. It stores the task from `.pairingbuddy/task.json` and opens with no type. The first stage is intake (the classify-task agent), and the first gate is G:type. Under auto, G:type passes only when the classifier reports certain. If it refuses, stop and report the refusal. Do not make the change another way.
3. Run `pb status --action`. Its `action` is the one next step. A gate can fall between two stages, so follow `action`, not `next`, which names a stage even while a gate stands before it. When it says to start a stage, start that workflow by name with the args it gives, wait for it, and run `pb status --action` again.
4. When it says a gate is due, run `pb gate eval`. On `auto-pass`, go back to step 3. On `needs-human`, show the human the question and `humanCommand`, and stop: only the human runs a `pb human` command.
   - After G:type, when `pb status --action` says the task is a spike whose setup is not recorded, run the setting-up-spike skill in the main context, then `pb spike setup`, then run `pb status --action` again.
5. When it says every stage and gate is done, run `pb task end`. If its output has `closed`, report its `reason` and stop: a spike has no publish stage, so do not run `pb run open --kind publish`. Otherwise run `pb run open --kind publish`. If either refuses, stop and report the refusal: do not work around it, and do not open the publish run by other means.
6. Follow `pb status --action` through pr-draft and `G:publish` as for the code stages: start the stage it names, run `pb gate eval` when it says a gate is due. On `needs-human`, show the question and stop as in step 4. If the human answers keep local, report that and stop. If a kept-local unit is left behind, `pb status --action` names `pb publish` to finish closing it: run it and report its `reason`.
7. When G:publish is approved, `pb status --action` names `pb publish`. Under the auto policy `pb gate eval` approves it itself, but only when every task recorded its safety-net review and the PR lint passes. An `auto-pass` at G:publish is that approval: run `pb publish` then, and do not hold it back for findings or ask the human first, since the gate has already weighed them and the PR opens as a draft. When `pb gate eval` returns `skip`, the unit has nothing to publish: run `pb publish` too. Run it and report `url`, `warnings` and `pendingComment` from its output. `pb publish` is the only route to a push or a PR: never run `git push` or `gh pr create` yourself.
8. If `pb publish` returns `skip`, `local` or `kept-local`, nothing was pushed: report the `reason` and stop.
9. After review: once review fixes for an open pull request have landed and been pushed, run `pb pr refresh` on its branch, with no run open, so the title and body describe the whole diff again (a stale body becomes a stale commit on main). It reads the PR, opens a refresh run and refuses if the PR head is not HEAD. Follow `pb status --action` through pr-draft and `G:publish` as in step 6; on a refresh `G:publish` always asks the human. Once approved, `pb status --action` names `pb pr refresh` again: run it and report `url`, `warnings` and `pendingComment`. It edits the title and body with `gh pr edit`, posts new coordination text as a comment, pushes nothing and leaves the draft state alone. Never run `gh pr edit` yourself.

`pb stage finish`, which the workflow's last agent runs, is the only proof a stage ran. Never read a workflow's reported status as a result: a workflow can report completed with no work done. After each workflow, `pb status` decides. If the stage did not finish, or `stop` is set, stop and report the `pb status` output.

Never do a stage's work yourself, and never call its agents directly. Once a run exists, the gate denies a direct call to a pipeline agent and names the workflow to start instead. If a deny names a different `pluginRoot` or attempt, use the one it names.

## Orchestrator Behavior

### Bootstrap test-config.json

1. Check if `.pairingbuddy/test-config.json` exists
2. If it exists, use it and ask nothing. The human owns that file, and a run that stops here waits for an answer no auto run can give
3. If missing, infer from: README, CLAUDE.md, plan docs, project structure
4. Give each test command a `selector_template`: the argument words that select one test, for example `["{test_file}::{test_function}"]` for pytest. Without it `pb run open` refuses a `bug_fix` or a `new_feature`, because RED and GREEN could not speak for one test
5. Validate inferred config with human before writing
6. If unable to infer, ask human directly

### State File Management

1. At cycle start, verify `.pairingbuddy/` is in `.gitignore`
2. Curate guidance (before cleanup). The curating-guidance skill does this outside Solo, plan tasks included; the `curate_guidance` agent does it only in Solo:
   - If `human-guidance.json` has entries: review/curate existing guidance
   - If empty or missing: offer to add new persistent guidance
   - Approved entries get `"persistent": true` flag
   - With no human, under the auto policy or `claude -p`: it carries over silently and asks nothing
3. Delete all `.pairingbuddy/*.json` EXCEPT `test-config.json`, `doc-config.json`, `git-config.json`, and `human-guidance.json`; the `.pairingbuddy/reports/` folder is kept too
4. Write the new task to `task.json`
5. If `human-guidance.json` doesn't exist after curation, initialize with `{"guidance": []}`
6. Keep files after run for human review

**Note:** `human-guidance.json` serves two purposes:
- **Session feedback:** Agents with Human Review checkpoints append corrections during the task
- **Persistent guidance:** Entries with `"persistent": true` survive cleanup and carry over to future tasks (operational knowledge, coding preferences, project conventions)

### Human Checkpoints

After each refactor cycle:
1. Present issues found to human
2. Human decides: continue, skip remaining, or stop
3. Prevents infinite refactor loops

### Plan Loop

Outside Solo, `_run_plan_loop(plan_path)` runs a plan one task at a time:

1. Run `pb plan next <plan>` first. It says what to do next, or refuses. When it succeeds with no next task, the plan is done: report that and stop the loop.
2. A unit is open when `.pairingbuddy/run/unit.json` exists. If no unit is open, run `pb unit open` as router step 1: a type you guess from the task and a short kebab-case slug made from the unit name. When it refuses with a `!` command, stop and show the human that command.
3. Run the curating-guidance skill in the main context before each task. Then clean the state files with `_cleanup_state_files()`.
4. Run `pb run open --kind code --plan <plan>`, which takes the next task itself, so the session does not write `task.json` for it.
5. Follow `pb status --action` and `pb gate eval` through the stages and G:task-end as router steps 3-4.
6. Run `pb task end`, which ticks the box and records the task, then, unless its output has `closed`, run `pb plan next` again. If it has `closed`, report its `reason` and stop the loop: do not run `pb plan next` or `pb run open --kind publish`.
7. If the unit is done but not published, run `pb run open --kind publish` and publish as router steps 6-8. Run `pb plan next` again only when `pb publish` returned a `url`. On `skip`, `local` or `kept-local`, or a needs-human stop, report as router step 8 says and stop the loop.
8. For any other refusal (a human task, hand-ticked boxes, a legacy unit), show it to the human with its options, and stop the loop.

The model never ticks a box and never types a `pb human` command.

### Plan Execution Mode

This section describes Solo's old plan loop.

When the task description references a plan MD file (produced by `/pairingbuddy:plan`), the orchestrator enters plan execution mode:

1. **Detection:** `_detect_plan_file(task)` checks if the task references a `.md` file that contains plan-formatted content (TB headings with checkbox tasks)
2. **Parsing:** `_read_plan_tasks(plan_path)` extracts all tasks from the plan MD with their checkbox state, title, and full description
3. **Visibility:** `_hydrate_claude_tasks(plan_tasks)` creates Claude Code Tasks (via TaskCreate) for all plan tasks. Completed tasks (checked) are marked as done. This gives the human a visible progress view within the session.
4. **Iteration:** For each unchecked task, the orchestrator:
   a. Writes `task.json` with the plan task's rich description
   b. Runs the normal TDD workflow (curate guidance, cleanup, classify, implement)
   c. After successful completion, updates the MD checkbox (`- [ ]` → `- [x]`)
   d. Marks the Claude Code Task as completed
   e. Pauses for human confirmation before continuing to the next task
5. **Cross-session recovery:** On a new session, the human says "continue executing plan at path/to/plan.md". The orchestrator reads the MD — checkboxes show what's done. It hydrates Claude Code Tasks from the current state and continues from the first unchecked task.

**Note:** Claude Code Tasks are session-scoped (they don't persist across sessions). The MD checkboxes are the durable source of truth. Claude Code Tasks are hydrated fresh each session from the MD state.

### Resume and Plan Modifications

Sessions may be interrupted and resumed. The plan MD checkboxes are the sole source of truth — on resume, the orchestrator reads them and continues from the first unchecked task.

**Plan modifications between sessions:** The human may modify the plan MD between runs:
- **Add** new unchecked tasks (at the end or between existing tasks)
- **Remove** unchecked tasks that are no longer needed
- **Modify** unchecked task descriptions
- **Do not modify** checked tasks — they represent completed work with committed code

The orchestrator reads the plan fresh each session, so modifications take effect immediately.

### Error Handling

1. If agent returns error or invalid output → stop and report
2. If `implement_code` fails to make test pass → retry once with different approach (try prompting)
3. If retry fails → ask human how to proceed

### Solo Mode

When `PAIRINGBUDDY_SOLO` environment variable is `true`, the orchestrator operates autonomously. The workflow pseudocode above is **unchanged** — Solo behavior comes entirely from `_ask_human` auto-yes (see Orchestrator Functions table) and the instructions below.

**Detection:** Check `PAIRINGBUDDY_SOLO` env var at workflow start. If `true`, Solo mode is active.

**Strict scope**
- Every action must be traceable to an explicit rule in skills, contracts, or the plan
- No additions, no improvements, no "while I'm here" moments
- If rules don't cover the situation: STOP and document the gap
- No "best judgment" decisions

**Sequential execution**
- On task failure, the plan execution loop must `break` (not `continue`)
- The orchestrator MUST NOT skip to the next task
- Stopping ensures the human reviews the situation

**Resource exhaustion before stopping**
Before stopping a Solo session due to a failure or ambiguity (not on normal completion or token exhaustion):
1. Re-read the relevant skill reference files
2. Re-read contracts and architecture docs
3. Check if `CLAUDE.md` or project-specific docs have relevant guidance
4. Only stop if the path forward is still unclear after all resources are consulted
5. Document which resources were consulted in the stop report

**Bug handling**
- **Blocker bug for current task:** Fix it using the bug fix workflow. It's a dependency, not out of scope.
- **Bug in code being touched by current task:** Fix it. Consistent with quality standards.
- **Bug in unrelated code discovered by accident:** Log it in `SOLO_BUDDY_REPORT.md` but do NOT fix it. Not in scope.

**Quality compliance**
- Fix ALL issues flagged by quality agents (`identify-test-issues`, `identify-code-issues`). No exceptions.
- The orchestrator MUST NOT rationalize skipping a quality issue by claiming scope boundaries.
- If a quality agent flags it, it gets fixed — period.

**Uncommitted changes on stop**
- On session stop, uncommitted changes are left as-is in the worktree
- No `git checkout .`, `git clean`, or any form of revert

**Report generation**
Create or append to `.pairingbuddy/SOLO_BUDDY_REPORT.md` incrementally:

1. **At session start** (after first task begins):
   - **If the report does NOT exist**, create it with header:
     ```markdown
     # Solo Buddy Report

     - **Plan:** <path to plan file>
     - **Branch:** <current git branch name>
     - **Started:** <ISO 8601 timestamp>
     - **Tasks completed:** 0 of N
     - **Status:** in_progress

     ## Tasks
     ```
   - **If the report ALREADY exists** (resume), reconcile then append:
     1. Read the current plan MD to get the current task list (by title)
     2. Parse existing report task entries (`### Task N: <title>`)
     3. **Drop** entries whose task title no longer appears in the current plan (removed/replaced tasks)
     4. **Reorder** remaining entries to match the current plan's task order
     5. Rewrite the report with: preserved header, reconciled task entries, then append session separator:
     ```markdown

     ---

     ## Session resumed

     - **Resumed:** <ISO 8601 timestamp>
     - **Tasks remaining:** X of Y unchecked
     - **Status:** in_progress
     ```
     Task matching uses the task title text (after `- [x]` or `- [ ]` in the plan, after `### Task N:` in the report). This ensures the report always reflects the current plan — no stale entries from previous plan versions.

2. **After each task completes**, append a task entry:
   ```markdown
   ### Task N: <title>
   - **Status:** completed
   - **Commits:** <commit hashes with messages>
   - **Decisions made:** <decisions made during this task>
   - **Quality issues fixed:** <issues flagged and fixed>
   ```

3. **On session stop**, append a stopped entry and update the header:
   ```markdown
   ## Stopped

   - **Task:** <which task it stopped on>
   - **Reason:** <why it stopped>
   - **What was tried:** <approaches attempted>
   - **Resources consulted:** <skills, contracts, docs checked>
   - **What the human needs to do:** <actionable next steps>
   ```

**Push to remote**
After session ends (completion or stop):
1. Push the current branch to remote with `git push`
2. **NEVER push to main/master** — Solo Buddy only pushes to the branch the human set up
3. If push fails, log the failure but don't stop — the work is already committed locally

Note: `SOLO_BUDDY_REPORT.md` lives in `.pairingbuddy/` which is gitignored. It is a local artifact for the human to review, not committed to the repository.
