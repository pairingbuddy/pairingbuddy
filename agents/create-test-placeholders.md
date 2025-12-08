---
name: create-test-placeholders
description: Creates test files with placeholder tests from scenarios. Second agent in TDD workflow. Outputs test mapping for implementation phase.
model: haiku
color: cyan
skills: [writing-tests]
---

# Create Test Placeholders

## Purpose

Create test files with placeholder tests from scenarios and test cases.

## Definitions

| Term | Definition | Example |
|------|------------|---------|
| **Scenario** | High-level functionality to test (what to test) | "User can log in" |
| **Test Case** | Specific condition with expected outcome | "Login with valid credentials succeeds" |
| **Test** | Code that executes a test case | `def test_login_valid_credentials():` |

**Relationships:** Scenario (1) → Test Cases (many) → Tests (1+ per test case)

## Input

Reads from `.pairingbuddy/scenarios.json`:

```json
{
  "scenarios": [
    {
      "scenario_id": "string (unique identifier)",
      "description": "string (what this scenario covers)",
      "test_cases": [
        {
          "test_case_id": "string (unique identifier)",
          "description": "string (specific condition to verify)"
        }
      ]
    }
  ]
}
```

Also reads `.pairingbuddy/test-config.json`:

```json
{
  "source_directory": "string (where production code lives)",
  "runners": {
    "<runner_id>": {
      "name": "string (human-readable name)",
      "command": "string (full invocation including wrapper and runner)",
      "test_directory": "string (where these tests live)",
      "file_pattern": "string (glob pattern for test files)",
      "run_args": ["array of strings appended after test path"]
    }
  },
  "default_runner": "string (runner ID to use when not specified)"
}
```

**Optional:** `.pairingbuddy/coverage-report.json` - if present, only create placeholders for test_cases listed in the `gaps` array:

```json
{
  "status": "complete | incomplete | error",
  "scenarios_covered": "integer (number of scenarios with tests)",
  "scenarios_total": "integer (total number of scenarios)",
  "test_cases_covered": "integer (number of test cases with tests)",
  "test_cases_total": "integer (total number of test cases)",
  "gaps": [
    {
      "scenario_id": "string (scenario with missing coverage)",
      "test_case_id": "string (specific test case missing, optional)",
      "description": "string (what coverage is missing)"
    }
  ]
}
```

**Optional:** `.pairingbuddy/tests.json` (if exists) to check for existing test entries:

```json
{
  "tests": [
    {
      "test_id": "string (unique identifier for this test)",
      "test_case_id": "string (back-reference to test case)",
      "scenario_id": "string (back-reference to scenario)",
      "runner_id": "string (which runner from test-config)",
      "test_file": "string (path to test file)",
      "test_function": "string (test function name)"
    }
  ]
}
```

## Instructions

1. Read scenarios from `.pairingbuddy/scenarios.json`
2. Read test configuration from `.pairingbuddy/test-config.json`
3. Read existing tests from `.pairingbuddy/tests.json` (if exists)
4. **If `.pairingbuddy/coverage-report.json` exists with gaps:**
   - Only process test_cases listed in the gaps array
5. **Otherwise (first pass):**
   - Process all test_cases from scenarios.json
6. **For each test_case to process:**
   - Skip if tests.json already has an entry for this test_case_id (idempotent)
   - Create placeholder test in the configured test directory
   - Generate unique test_id
   - Append entry to tests.json

### File Creation Restrictions

**You may ONLY write to:**
- `.pairingbuddy/tests.json` (your JSON output)
- Test files within the `test_directory` specified in `test-config.json`

Do NOT create files anywhere else. No /tmp files, no markdown files, no files outside the test directory.

## Output

Writes to `.pairingbuddy/tests.json`:

```json
{
  "tests": [
    {
      "test_id": "string (unique identifier for this test)",
      "test_case_id": "string (back-reference to test case)",
      "scenario_id": "string (back-reference to scenario)",
      "runner_id": "string (which runner from test-config)",
      "test_file": "string (path to test file)",
      "test_function": "string (test function name)"
    }
  ]
}
```
