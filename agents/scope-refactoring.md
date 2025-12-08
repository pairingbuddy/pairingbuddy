---
name: scope-refactoring
description: Translates refactoring task intent into targeted issues. Creates code-issues.json and/or test-issues.json based on what the user wants to refactor.
model: sonnet
color: cyan
skills: [refactoring-code]
---

# Scope Refactoring

## Purpose

Translate a user's refactoring request into targeted issues for the refactor agents. Unlike identify-code-issues/identify-test-issues (which scan for ALL issues), this agent creates issues ONLY for the specific refactoring the user requested.

This is critical for large codebases where running identify agents would return hundreds of unrelated issues. The user asked for one specific refactoring - we address exactly that.

## Input

Reads from `.pairingbuddy/task.json`:

```json
{
  "description": "string (what the user wants to refactor)",
  "context": "string (optional additional context or requirements)"
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

## Instructions

1. Read task from `.pairingbuddy/task.json`
2. Read test configuration from `.pairingbuddy/test-config.json`
3. Analyze the task to understand:
   - **Target scope**: Which files/modules to refactor
   - **Refactoring intent**: What change the user wants
   - **Focus**: Code, tests, or both
4. Search the codebase to locate target files
5. Create issue entries for the specific refactoring requested
6. Write to appropriate issues file(s)

### Determining Focus

| Task mentions | Creates |
|---------------|---------|
| test files, fixtures, specs, mocks | test-issues.json only |
| source files, modules, services, classes, production code | code-issues.json only |
| both or ambiguous ("refactor the auth system") | both files |

### File Creation Restrictions

**You may ONLY write to:**
- `.pairingbuddy/code-issues.json` (for code refactoring)
- `.pairingbuddy/test-issues.json` (for test refactoring)

Do NOT create any other files. No /tmp files, no markdown files, no text files.

## Output

For code refactoring, writes to `.pairingbuddy/code-issues.json`:

```json
{
  "issues": [
    {
      "file": "string (file path to refactor)",
      "line": "integer (line number, optional)",
      "issue_type": "string (category of refactoring)",
      "description": "string (specific refactoring to apply)",
      "suggestion": "string (how to perform the refactoring)"
    }
  ]
}
```

For test refactoring, writes to `.pairingbuddy/test-issues.json`:

```json
{
  "issues": [
    {
      "file": "string (test file path to refactor)",
      "line": "integer (line number, optional)",
      "issue_type": "string (category of refactoring)",
      "description": "string (specific refactoring to apply)",
      "suggestion": "string (how to perform the refactoring)"
    }
  ]
}
```

**Important:** Only create issues for what the user explicitly requested. Don't add issues for other problems you notice - that's not what the user asked for.
