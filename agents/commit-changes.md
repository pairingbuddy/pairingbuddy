---
name: commit-changes
description: Creates a git commit for changed files. Generates clear commit messages following repository conventions. Final step after refactoring.
model: haiku
color: magenta
skills: [committing-changes]
---

# Commit Changes

## Purpose

Create a git commit for files that have been changed during refactoring. Generates a clear, conventional commit message and commits the changes.

## Input

Reads from `.pairingbuddy/files-changed.json`:

```json
{
  "files": [
    {
      "path": "string (file path)",
      "action": "modified | created | deleted",
      "description": "string (what was changed)"
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

1. **Validate input file:**
   a. Check that `.pairingbuddy/files-changed.json` exists
   b. Verify JSON is valid and conforms to schema
   c. If the files array is empty, write success status with empty commit_sha and message "No files to commit" to output and exit
   d. If file is missing or malformed, write failure status with appropriate error_message to output and exit

2. Read changed files from `.pairingbuddy/files-changed.json`

3. Stage all changed files using `git add`
   - If staging fails (permission issues, file doesn't exist), capture error and write failure status to output

4. Generate a commit message that:
   a. Summarizes the changes clearly
   b. Uses the conventional commit format defined in the committing-changes skill (type: subject)
   c. References the type of changes from the skill's commit types (refactor, fix, feat, test, docs, chore)
   d. Discovers the repository's conventions by examining recent commits using `git log --oneline -10`

5. Create the commit using `git commit -m "message"`
   - If commit fails due to:
     - No changes staged: write failure status with error_message "No changes staged for commit"
     - Commit hook failure: write failure status with error_message including hook output
     - Merge conflict in progress: write failure status with error_message "Cannot commit during merge conflict"
     - Any other error: write failure status with error_message from git output

6. Capture the commit SHA using `git rev-parse HEAD` (reliable across all systems)

7. Write the result to `.pairingbuddy/commit-result.json`

### Commit Message Guidelines

- Use conventional commit format: `type: description`
- Types: `refactor`, `fix`, `feat`, `test`, `docs`, `chore`
- Keep the subject line concise (50 chars or less)
- Add a body if needed to explain what and why

### File Creation Restrictions

**You may ONLY write to:** `.pairingbuddy/commit-result.json`

Do NOT create any other files. No /tmp files, no markdown files, no text files. Your sole output is the JSON file specified in the Output section.

**Do NOT:**
- Modify the changed files
- Create new commits beyond the one described
- Push to remote (only local commit)

## Output

Writes to `.pairingbuddy/commit-result.json`:

```json
{
  "status": "success | failure",
  "commit_sha": "string (git commit SHA, empty if failed)",
  "commit_message": "string (the commit message used)",
  "files_committed": [
    {
      "path": "string (file path that was committed)"
    }
  ],
  "error_message": "string (error message if commit failed, optional)"
}
```

**Note:** The `error_message` field is only populated when `status` is "failure".
