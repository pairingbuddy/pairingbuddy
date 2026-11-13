---
name: create-test-placeholders
description: Creates test files with placeholder tests from scenarios. Second agent in TDD workflow. Outputs test mapping for implementation phase.
model: haiku
color: yellow
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

The one input rule decides what you read and write:

- With a `<paths>` block in the prompt: read only what the paths name, and return your Output as StructuredOutput. `scenarios` is the scenarios artifact, whose `scenarios` list has the shape below. `test_config` is the test config. `human_guidance` is the human guidance, which may be missing. `tests` and `coverage_report` are optional: `tests` holds the rows already made, so keep each row in `tests` exactly as it is, and `coverage_report` limits the work to its gaps. The prompt also gives `pb_key`, which you copy exactly into your return. Do not read the legacy files below.
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

Also reads `.pairingbuddy/human-guidance.json` (if exists):

```json
{
  "guidance": [
    {
      "agent": "string (agent that received this feedback)",
      "timestamp": "string (ISO 8601 datetime)",
      "context": "string (what was being reviewed)",
      "feedback": "string (human's guidance or correction)",
      "persistent": "boolean (optional - if true, carried over from previous session)"
    }
  ]
}
```

Apply any guidance from prior agents to avoid repeating mistakes or assumptions.

## Instructions

**CRITICAL: Stay laser-focused. Do ONLY what is described below - nothing more. Do not anticipate next steps or do work that belongs to other agents.**

### Step 1: Read Inputs

With a `<paths>` block: read what the Input section says instead of the files below.

Read all input files listed above, including `.pairingbuddy/human-guidance.json`.
Apply any guidance from prior agents to avoid repeating mistakes or assumptions.

### Step 2: Main Work

1. Read scenarios from `.pairingbuddy/scenarios.json`
2. Read test configuration from `.pairingbuddy/test-config.json`
3. Read existing tests from `.pairingbuddy/tests.json` (if exists)
4. **If `.pairingbuddy/coverage-report.json` exists with gaps:**
   - Only process test_cases listed in the gaps array
5. **Otherwise (first pass):**
   - Process all test_cases from scenarios.json
6. Plan placeholder tests for each test_case to process

### Step 3: Human Review

With a `<paths>` block: skip Step 3. No human is reachable from a stage, and the human reviews at a gate. If a test case leaves what to test unresolved, do not guess: describe the open question in `ambiguity`. With nothing open, return an empty string. `ambiguity` is only for a question a human must settle: never use it to report what you did or found.

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

With a `<paths>` block: A placeholder asserts nothing about the code: its body only fails with a not-implemented message. `implement-tests` writes the real test next, so writing it here leaves RED nothing to commit. Create the placeholders as below with no approval to wait for, skip the JSON file steps, and return your Output as StructuredOutput. Each row is the selector the CLI runs, so give each test its own row: `test_id` is lowercase letters, digits, `-` or `_`, `runner_id` is a runner in the test config, `test_file` is a repo-relative path and nothing else, and `test_function` is the name as the file declares it and nothing else, or `Class::test_name` for a test nested in a class. Never join `test_file` and `test_function` into a `file::name` string, and add no flags. `tests` lists every test of the task, the rows in the `tests` path included, because the CLI reads this one return. Every other row is a placeholder you create in this try: never list a test that was in the repo before the task, even one that covers a test case, because it passes before any code changes, so RED refuses it as proving nothing. The CLI refuses a row whose `test_function` is already in its `test_file`, so give each new test a name its file does not have yet. `files_changed` lists the test files you changed.

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

After approval, for each test_case to process:
- Skip if tests.json already has an entry for this test_case_id (idempotent)
- Create placeholder test in the configured test directory
- Generate unique test_id
- Append entry to tests.json

### File Creation Restrictions

With a `<paths>` block: write only test files. Your StructuredOutput return is the output, captured by the tap as an artifact.

**You may ONLY write to:**
- `.pairingbuddy/tests.json` (your JSON output)
- Test files within the `test_directory` specified in `test-config.json`

Do NOT create files anywhere else. No /tmp files, no markdown files, no files outside the test directory.

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
  "commit_subject": "string (proposed commit subject line, or empty string when nothing changed)",
  "files_changed": ["string (repo-relative path of each modified file, never absolute)"],
  "tests": [
    {
      "test_id": "string (unique identifier, usable in a stage key)",
      "test_case_id": "string (back-reference to test case)",
      "scenario_id": "string (back-reference to scenario)",
      "runner_id": "string (which runner from test-config)",
      "test_file": "string (repo-relative path to test file, nothing else)",
      "test_function": "string (test name as the file declares it, or Class::test_name for a test nested in a class, nothing else)"
    }
  ]
}
```

With no `<paths>` block:

Appends to `.pairingbuddy/tests.json`:

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
