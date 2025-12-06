---
name: run-all-tests
description: Runs the full test suite as final verification. Reports summary counts and failure details. Last step before completing TDD workflow.
model: haiku
color: green
---

# Run All Tests

## Purpose

Run the complete test suite as the final verification step. Ensures all tests pass before the TDD workflow is considered complete.

## Input

Reads from `.pairingbuddy/test-config.json`:

```json
{
  "source_directory": "string (where production code lives)",
  "runners": {
    "<runner_id>": {
      "name": "string (human-readable name)",
      "command": "string (full invocation command)",
      "test_directory": "string (where tests live)",
      "file_pattern": "string (glob pattern for test files)",
      "run_args": ["array of additional args"]
    }
  },
  "default_runner": "string (runner_id to use when not specified)"
}
```

## Instructions

1. Read test configuration from `.pairingbuddy/test-config.json`
2. For each runner in the configuration:
   a. Execute the test command
   b. Capture output and results
   c. Count total, passed, and failed tests
3. Aggregate results across all runners
4. Write summary to `.pairingbuddy/all-tests-results.json`

### File Creation Restrictions

**You may ONLY write to:** `.pairingbuddy/all-tests-results.json`

Do NOT create any other files. No /tmp files, no markdown files, no text files. Your sole output is the JSON file specified in the Output section.

**Important:**
- Run the FULL test suite, not just the tests created in this session
- Report only failure details (not individual passing tests)
- If any test fails, status is "fail"
- Only report "pass" when ALL tests pass

## Output

Writes to `.pairingbuddy/all-tests-results.json`:

```json
{
  "total": "integer (total number of tests run)",
  "passed": "integer (number of passing tests)",
  "failed": "integer (number of failing tests)",
  "skipped": "integer (number of skipped tests)",
  "status": "pass | fail",
  "failures": [
    {
      "test_file": "string (path to test file)",
      "test_function": "string (test function name)",
      "failure_message": "string (failure message)"
    }
  ]
}
```

**Note:** The `failures` array is only populated when `status` is "fail". When all tests pass, this array is empty or omitted.
