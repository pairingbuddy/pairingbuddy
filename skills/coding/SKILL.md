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
| issues | .pairingbuddy/issues.json | issues.schema.json |
| files_changed | .pairingbuddy/files-changed.json | files-changed.schema.json |
| coverage_report | .pairingbuddy/coverage-report.json | coverage-report.schema.json |

## Workflow

**Prerequisites:** Before starting the workflow, ensure `.pairingbuddy/test-config.json` exists. See "Bootstrap test-config.json" in Orchestrator Behavior.

```python
# State files:
# task → .pairingbuddy/task.json
# test_config → .pairingbuddy/test-config.json
# scenarios → .pairingbuddy/scenarios.json
# tests → .pairingbuddy/tests.json
# current_batch → .pairingbuddy/current-batch.json
# test_results → .pairingbuddy/test-results.json
# code_results → .pairingbuddy/code-results.json
# issues → .pairingbuddy/issues.json
# files_changed → .pairingbuddy/files-changed.json
# coverage_report → .pairingbuddy/coverage-report.json

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

## Interpreting the Workflow

The Python pseudocode above is a specification, not executable code. Interpret it as follows:

1. **Function calls** = Task tool invocations to agents
   - `enumerate_scenarios_and_test_cases(task, test_config)` → invoke agent `pairingbuddy:enumerate-scenarios-and-test-cases`
   - Underscores in function names become hyphens in agent names

2. **Arguments** = JSON files the agent reads (agent knows where from its Input section)

3. **Return values** = JSON files the agent writes (agent knows where from its Output section)

4. **Control flow** = Your orchestration logic
   - `for test in tests:` → read tests.json, iterate over each test
   - `if test_issues:` → check if issues.json has items

Each agent is self-contained - it knows what to read, what to do, and what to write. Just invoke it:

```
Task tool:
  subagent_type: pairingbuddy:enumerate-scenarios-and-test-cases
```

## Orchestrator Behavior

### Bootstrap test-config.json

1. Check if `.pairingbuddy/test-config.json` exists
2. If missing, infer from: README, CLAUDE.md, plan docs, project structure
3. Validate inferred config with human before writing
4. If unable to infer, ask human directly

### State File Management

1. At cycle start, verify `.pairingbuddy/` is in `.gitignore`
2. Delete all `.pairingbuddy/*.json` at start of new task
3. Keep files after run for human review

### Human Checkpoints

After each refactor cycle:
1. Present issues found to human
2. Human decides: continue, skip remaining, or stop
3. Prevents infinite refactor loops

### Error Handling

1. If agent returns error or invalid output → stop and report
2. If `implement_code` fails to make test pass → retry once with different approach
3. If retry fails → ask human how to proceed
