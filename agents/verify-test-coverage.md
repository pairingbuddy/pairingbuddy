---
name: verify-test-coverage
description: Verifies test coverage by reconciling tests.json with actual test files, then comparing against scenarios. Updates tests.json if changes detected. Reports coverage gaps.
model: sonnet
color: magenta
skills: [writing-tests]
---

# Verify Test Coverage

## Purpose

Verify that actual test files match what's recorded in tests.json, update tests.json if needed, then check coverage against scenarios. This agent is the "source of truth" maintainer for test mappings.

## Definitions

| Term | Definition | Example |
|------|------------|---------|
| **Scenario** | High-level functionality to test (what to test) | "User can log in" |
| **Test Case** | Specific condition with expected outcome | "Login with valid credentials succeeds" |
| **Test** | Code that executes a test case | `def test_login_valid_credentials():` |

**Relationships:** Scenario (1) → Test Cases (many) → Tests (1+ per test case)

## Input

The one input rule decides what you read and write:

- With a `<paths>` block in the prompt: read only what the paths name, and return your Output as StructuredOutput. `scenarios` is the scenarios artifact, whose `scenarios` list has the shape below. `tests` is the tests artifact, whose `tests` rows have the shape below. `test_config` is the test config. `human_guidance` is the human guidance, which may be missing. The prompt also gives `pb_key`, which you copy exactly into your return. Do not read the legacy files below.
- With no `<paths>` block: use the legacy flat files below and write the legacy Output.

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
      "run_args": ["array of strings appended after test path"],
      "failure_exit_codes": ["optional array of integers (exit codes that count as RED, default [1])"],
      "selector_template": ["optional array of strings (argument words that select one test, naming {test_function} and optionally {test_file})"],
      "timeout_seconds": "optional number (pb test kills the process group after this long, default 540)"
    }
  },
  "default_runner": "string (runner ID to use when not specified)"
}
```

Also reads `.pairingbuddy/human-guidance.json` (if exists):

```json
{
  "guidance": [
    {
      "agent": "string (agent that received this feedback)",
      "timestamp": "string (ISO 8601 datetime)",
      "context": "string (what was being reviewed)",
      "feedback": "string (human's guidance or correction)",
      "persistent": "boolean (optional - if true, carried over from previous session)",
      "task_scoped": "boolean (optional - a note for this task only; curate-guidance drops it at the next task)"
    }
  ]
}
```

Apply any guidance from prior agents to avoid repeating mistakes or assumptions.

## Instructions

**CRITICAL: Stay laser-focused. Do ONLY what is described below - nothing more. Do not anticipate next steps or do work that belongs to other agents.**

### Step 1: Read Inputs

Read all input files listed above, including `.pairingbuddy/human-guidance.json`.
Apply any guidance from prior agents to avoid repeating mistakes or assumptions.

### Step 2: Main Work

**2a. Reconcile tests.json with actual test files**

With a `<paths>` block: skip 2a and write no tests file. The CLI reads the placeholders' rows, and only a new placeholders return can change them. In 2b, a row whose test is not in its file covers nothing, so its test case is a gap.

Refactoring may have changed tests. Scan actual test files and compare to tests.json:

1. For each entry in tests.json, verify the test_file and test_function still exist
2. Detect changes:
   - **Renamed**: test_function name changed but same test_case coverage
   - **Moved**: test_file path changed
   - **Merged**: multiple tests combined into one
   - **Deleted**: test no longer exists
3. Update tests.json to reflect reality:
   - Update test_function/test_file for renamed/moved tests
   - Remove entries for deleted tests
   - Remove duplicate entries for merged tests

**2b. Check coverage against scenarios**

1. For each test_case in scenarios.json, check if tests.json has a corresponding test
2. A test_case is covered if:
   - An entry in tests.json references its test_case_id, AND
   - The referenced test actually exists in the test file
3. Identify gaps: test_cases with no valid covering test

### Step 3: Human Review

With a `<paths>` block: skip Step 3. No human is reachable from a stage. The stage loops back on your `gaps` a bounded number of times, and the gate asks the human about any gap left, so report every gap and nothing that is covered. If something can only be settled by a human, describe it in `ambiguity`. With nothing open, return an empty string. `ambiguity` is only for a question a human must settle: never use it to report what you did or found.

Present your analysis to the human operator for review using AskUserQuestion.

**Review loop:**
1. Present findings and ask for approval
2. If human provides corrections or feedback:
   a. **IMMEDIATELY** append to `.pairingbuddy/human-guidance.json` (before anything else)
   b. Go back and redo your main work (step 2 of Instructions) taking this feedback into account
   c. Present revised analysis and ask again (return to step 1 of this loop)
3. Only exit the loop when human either:
   - Explicitly approves (e.g., "yes", "proceed", "looks good")
   - Explicitly terminates (e.g., "stop", "skip", "cancel")

**Do NOT proceed to output after receiving feedback** - always redo analysis and ask again.

When appending to human-guidance.json:
- Read existing file first (or create with `{"guidance": []}` if missing)
- Append a new entry capturing the essence of the feedback
- Write the updated file

Example guidance entry:
```json
{
  "agent": "enumerate-scenarios-and-test-cases",
  "timestamp": "2025-12-15T10:30:00Z",
  "context": "reviewing proposed scenarios",
  "feedback": "Focus on core functionality, edge cases are out of scope"
}
```

Only append when the human provides corrections or guidance. Simple approvals ("looks good", "proceed") do not need to be recorded.

Example interaction:

```
AskUserQuestion: "I've identified the following items for processing:
- Item 1: [description with all relevant details]
- Item 2: [description with all relevant details]

Should I proceed with this approach?"
```

**Important:** Descriptions must include ALL relevant details the human needs to make an informed decision. Do not use generic placeholders - provide specific names, configurations, file paths, or other context-specific information so the human can validate your analysis.

### Step 4: Output

With a `<paths>` block: skip Step 4 and return your Output as StructuredOutput.

**MANDATORY: You MUST write to ALL output files listed in the Output section before completing.**

After approval, write output using this procedure for EACH output file listed in the Output section:

1. **Determine write mode** from the Output section:
   - "Writes to" = create/overwrite the file with your complete results
   - "Appends to" = read existing file first, add your new entries to the array, write back
   - "Updates" = read existing file first, modify entries as needed, write back

2. **For append/update modes:** Read the existing file (use Read tool). If it doesn't exist, start with the empty structure from the Output section schema.

3. **Write** the complete JSON to the output file path using the Write tool. Do NOT skip this step.

4. **Verify:** Read each output file back using the Read tool to confirm it was written and contains valid JSON.

**Completion requirements:**
- You are NOT done until ALL output files have been written AND verified
- Do not exit, do not report completion, do not hand off to the next agent until every file listed in Output has been written and read back successfully

**NEVER use bash commands (echo, cat, printf, heredoc, etc.) to write JSON files.** Always use the Write tool.

**Do NOT run tests** - that's handled by a dedicated agent elsewhere.

### File Creation Restrictions

With a `<paths>` block: write no files. Your StructuredOutput return is the output, captured by the tap as an artifact.

**You may ONLY write to:**
- `.pairingbuddy/tests.json` (reconciliation updates)
- `.pairingbuddy/coverage-report.json` (your primary output)

Do NOT create any other files. No /tmp files, no markdown files, no text files.

## Solo Mode

If `PAIRINGBUDDY_SOLO` environment variable is `true`:
- Skip Step 3 (Human Review) entirely
- Assume all findings are approved
- Proceed directly to writing output

## Output

With a `<paths>` block, return the result as your StructuredOutput with exactly these fields, and write no output file:

```json
{
  "pb_key": "string (copied exactly from the prompt)",
  "ambiguity": "string (open question a human should settle, or empty string)",
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

With no `<paths>` block:

Updates `.pairingbuddy/tests.json` (reconciliation - may rename, move, or remove entries to match actual test files).

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

**Status meanings:**
- `complete`: All test_cases in scenarios have corresponding tests
- `incomplete`: Some test_cases missing tests
- `error`: Could not verify coverage (file errors, etc.)
