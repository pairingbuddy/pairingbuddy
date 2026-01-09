---
name: coding
description: Orchestrates TDD workflow by invoking specialized agents. Manages state via JSON files in .pairingbuddy/. Use for building features, fixing bugs, or any coding task requiring tests.
---

# Coding Orchestrator

Orchestrates the TDD workflow by invoking specialized agents via the Task tool. Each agent reads input JSON, performs one operation, writes output JSON.

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
| `_cleanup_state_files()` | **MANDATORY.** Delete ALL `.pairingbuddy/*.json` files EXCEPT: `test-config.json`, `doc-config.json`, `human-guidance.json`. These three files persist across tasks. All other state files (task.json, task-classification.json, scenarios.json, tests.json, spike-*.json, etc.) MUST be deleted to start fresh. This prevents stale state from previous tasks from affecting the current task. |
| `_filter_pending(tests)` | Filter tests.json to return only tests not yet processed in this session |
| `_filter_pending(spike_questions)` | Filter spike-questions.json units to return only units with status "pending" |
| `_mark_unit_answered(spike_questions, unit_id)` | Update unit status to "answered" in spike-questions.json |
| `_ask_human(question)` | Present question to human, return true/false based on response |
| `_stop(message)` | Stop workflow execution and report message to human |

These functions handle coordination, human interaction, and control flow that doesn't belong in agents.

## Workflow

**Prerequisites:** Before starting, ensure `.pairingbuddy/test-config.json` exists. See "Bootstrap test-config.json" in Orchestrator Behavior.

```python
# Curate guidance from previous session (always runs - handles review and bootstrap)
human_guidance = curate_guidance(human_guidance, task)

# Clean up stale state files from previous task (MANDATORY - do not skip)
_cleanup_state_files()

# Task classification
task_classification = classify_task(task)
task_type = task_classification.task_type  # "new_feature" | "bug_fix" | "refactoring" | "config_change"

if task_type == "new_feature":
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
    # Bug fix: add regression test first, then fix
    scenarios = enumerate_scenarios_and_test_cases(task, test_config)  # describes the bug
    tests = create_test_placeholders(scenarios, test_config)

    for test in tests:
        current_batch = [test]
        test_state = implement_tests(current_batch, test_config)  # test should fail (reproduces bug)
        code_state = implement_code(test_state, test_config)      # fix makes it pass

elif task_type == "refactoring":
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
    # Config change: just make the change and verify tests still pass
    # No agents needed - orchestrator makes the change directly
    pass

elif task_type == "spike":
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

## Orchestrator Behavior

### Bootstrap test-config.json

1. Check if `.pairingbuddy/test-config.json` exists
2. If exists, ask human: "Use existing test config?" (show current config)
3. If missing or human says no, infer from: README, CLAUDE.md, plan docs, project structure
4. Validate inferred config with human before writing
5. If unable to infer, ask human directly

### State File Management

1. At cycle start, verify `.pairingbuddy/` is in `.gitignore`
2. Invoke `curate_guidance` agent (before cleanup):
   - If `human-guidance.json` has entries: review/curate existing guidance
   - If empty or missing: offer to add new persistent guidance
   - Approved entries get `"persistent": true` flag
3. Delete all `.pairingbuddy/*.json` EXCEPT `test-config.json`, `doc-config.json`, and `human-guidance.json`
4. If `human-guidance.json` doesn't exist after curation, initialize with `{"guidance": []}`
5. Keep files after run for human review

**Note:** `human-guidance.json` serves two purposes:
- **Session feedback:** Agents with Human Review checkpoints append corrections during the task
- **Persistent guidance:** Entries with `"persistent": true` survive cleanup and carry over to future tasks (operational knowledge, coding preferences, project conventions)

### Human Checkpoints

After each refactor cycle:
1. Present issues found to human
2. Human decides: continue, skip remaining, or stop
3. Prevents infinite refactor loops

### Error Handling

1. If agent returns error or invalid output → stop and report
2. If `implement_code` fails to make test pass → retry once with different approach (try prompting)
3. If retry fails → ask human how to proceed
