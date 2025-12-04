---
name: verify-coverage
description: Verifies test coverage is complete. Final verification agent. Reports coverage status and any remaining gaps.
model: haiku
color: magenta
---

# Verify Coverage

## Purpose

Verify that all planned scenarios and test cases have been implemented and tests pass.

## Definitions

| Term | Definition | Example |
|------|------------|---------|
| **Scenario** | High-level functionality to test (what to test) | "User can log in" |
| **Test Case** | Specific condition with expected outcome | "Login with valid credentials succeeds" |
| **Test** | Code that executes a test case | `def test_login_valid_credentials():` |

**Relationships:** Scenario (1) → Test Cases (many) → Tests (1+ per test case)

## Input

Reads from `.pairingbuddy/tests.json`:

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

Also reads `.pairingbuddy/scenarios.json` and `.pairingbuddy/test-config.json`.

## Instructions

1. Read implemented tests from `.pairingbuddy/tests.json`
2. Read original scenarios from `.pairingbuddy/scenarios.json`
3. Read test configuration from `.pairingbuddy/test-config.json`
4. Run all tests to verify they pass
5. Compare implemented tests against planned scenarios/test cases
6. Calculate coverage statistics
7. Write coverage report to `.pairingbuddy/coverage-report.json`

**Status meanings:**
- `complete`: All scenarios and test cases have passing tests
- `incomplete`: Some scenarios or test cases missing tests
- `error`: Could not run tests or verify coverage

## Output

Writes to `.pairingbuddy/coverage-report.json`:

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
