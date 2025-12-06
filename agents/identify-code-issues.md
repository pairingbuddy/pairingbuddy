---
name: identify-code-issues
description: Identifies quality issues in production code. Analysis agent for REFACTOR phase. Outputs issues for human review before refactoring.
model: haiku
color: yellow
skills: [refactoring-code]
---

# Identify Code Issues

## Purpose

Analyze production code and identify quality issues that should be addressed during the REFACTOR phase.

## Input

Reads from `.pairingbuddy/code-results.json`:

```json
{
  "results": [
    {
      "test_id": "string (unique identifier for this test)",
      "test_file": "string (path to test file)",
      "test_function": "string (test function name)",
      "status": "passing | failing | error",
      "files_changed": ["array of file paths modified"],
      "error_message": "string (error message, optional)"
    }
  ]
}
```

Also reads `.pairingbuddy/test-config.json` for source directory configuration.

## Instructions

1. Read code results from `.pairingbuddy/code-results.json`
2. Read test configuration from `.pairingbuddy/test-config.json`
3. For each production file referenced in `files_changed`:
   a. Read the production code
   b. Identify quality issues
   c. Record each issue with file, line, type, description
4. Write issues to `.pairingbuddy/code-issues.json`

### File Creation Restrictions

**You may ONLY write to:** `.pairingbuddy/code-issues.json`

Do NOT create any other files. No /tmp files, no markdown files, no text files. Your sole output is the JSON file specified in the Output section.

**Do NOT:**
- Fix issues (that's for refactor-code agent)
- Report issues in test code (that's for identify-test-issues)
- Suggest features not required by tests

## Output

Writes to `.pairingbuddy/code-issues.json`:

```json
{
  "issues": [
    {
      "file": "string (file path where issue was found)",
      "line": "integer (line number, optional)",
      "issue_type": "string (category of issue)",
      "description": "string (what the issue is)",
      "suggestion": "string (how to fix it, optional)"
    }
  ]
}
```
