---
name: coding
description: Orchestrates TDD workflow by invoking specialized agents. Manages state via JSON files in .pairingbuddy/. Use for building features, fixing bugs, or any coding task requiring tests.
---

# Coding Orchestrator

Orchestrates the TDD workflow by invoking specialized agents via the Task tool. Each agent reads input JSON, performs one operation, writes output JSON.

## State File Mappings

State files live in `.pairingbuddy/` at the git root of the target project.

| Variable | File | Schema |
|----------|------|--------|
| task | .pairingbuddy/task.json | task.schema.json |
| test_config | .pairingbuddy/test-config.json | test-config.schema.json |
| scenarios | .pairingbuddy/scenarios.json | scenarios.schema.json |
| tests | .pairingbuddy/tests.json | tests.schema.json |
| current_batch | .pairingbuddy/current-batch.json | current-batch.schema.json |
| test_results | .pairingbuddy/test-results.json | test-results.schema.json |
| code_results | .pairingbuddy/code-results.json | code-results.schema.json |
| test_issues | .pairingbuddy/test-issues.json | issues.schema.json |
| code_issues | .pairingbuddy/code-issues.json | issues.schema.json |
| files_changed | .pairingbuddy/files-changed.json | files-changed.schema.json |
| coverage_report | .pairingbuddy/coverage-report.json | coverage-report.schema.json |

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

## Workflow

**Prerequisites:** Before starting, ensure `.pairingbuddy/test-config.json` exists. See "Bootstrap test-config.json" in Orchestrator Behavior.

```python
# Pre-coding phase
scenarios = enumerate_scenarios_and_test_cases(task, test_config)
tests = create_test_placeholders(scenarios, test_config)

# Red-Green-Refactor loop (batch size 1)
for test in tests:
    current_batch = [test]

    # RED: implement test
    test_results = implement_tests(current_batch, test_config)

    # GREEN: implement code
    code_results = implement_code(test_results, test_config)

    # REFACTOR: identify and fix issues (with human checkpoint)
    test_issues = identify_test_issues(tests, test_config)
    if test_issues:
        files_changed = refactor_tests(test_issues, test_config)

    code_issues = identify_code_issues(code_results, test_config)
    if code_issues:
        files_changed = refactor_code(code_issues, test_config)

# Coverage verification
coverage_gaps = identify_coverage_gaps(tests, test_config)
coverage_report = verify_coverage(tests, test_config)
```

## Orchestrator Behavior

### Bootstrap test-config.json

1. Check if `.pairingbuddy/test-config.json` exists
2. If exists, ask human: "Use existing test config?" (show current config)
3. If missing or human says no, infer from: README, CLAUDE.md, plan docs, project structure
4. Validate inferred config with human before writing
5. If unable to infer, ask human directly

### State File Management

1. At cycle start, verify `.pairingbuddy/` is in `.gitignore`
2. Delete all `.pairingbuddy/*.json` EXCEPT `test-config.json` at start of new task
3. Keep files after run for human review

### Human Checkpoints

After each refactor cycle:
1. Present issues found to human
2. Human decides: continue, skip remaining, or stop
3. Prevents infinite refactor loops

### Error Handling

1. If agent returns error or invalid output → stop and report
2. If `implement_code` fails to make test pass → retry once with different approach (try prompting)
3. If retry fails → ask human how to proceed
