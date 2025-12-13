---
name: committing-changes
description: Provides guidelines for creating clear, conventional git commits. Use when committing code changes. Covers commit message format, when to commit, and git best practices.
---

# Committing Changes

Reference material for creating effective git commits with clear messages.

## Contents

- [Quick Reference](#quick-reference) - Commit format and guidelines at a glance

## Quick Reference

### Conventional Commit Format

Every commit message follows: `TYPE: subject` (with colon and space)

```
refactor: extract validation logic into separate function
```

Optional body for context:
```
refactor: extract validation logic into separate function

Moved email validation from UserService to EmailValidator class.
This improves testability and reusability.
```

### Commit Types

| Type | When to Use | Example |
|------|-------------|---------|
| **feat** | New feature or capability | `feat: add email validation` |
| **fix** | Bug fix | `fix: handle null email addresses` |
| **refactor** | Code improvement (no behavior change) | `refactor: simplify validation logic` |
| **test** | Add or modify tests | `test: add email validator tests` |
| **docs** | Documentation only | `docs: update API documentation` |
| **chore** | Build, tooling, dependencies | `chore: update pytest to 8.0` |

### Subject Line Guidelines

- Keep it under 50 characters (aim for 40-50 to ensure visibility in git log output with context)
- Use imperative mood ("add feature" not "added feature")
- Don't end with a period
- Be specific about what changed

**Good:**
- `refactor: extract duplicate validation logic`
- `fix: prevent null pointer in email validator`
- `test: add edge cases for email validation`

**Bad:**
- `update code` (too vague)
- `Fixed a bug.` (not imperative, has period)
- `refactored the email validation logic to use a separate class and improved the error handling` (too long)

### When to Commit

**Do commit when:**
- Tests pass (GREEN phase complete)
- After successful refactoring
- Logical unit of work is complete
- Before switching tasks

**Don't commit when:**
- Tests are failing
- Code doesn't compile/run
- Work is incomplete or broken
- You haven't verified the changes

### Git Best Practices

1. **Stage intentionally** - Review what you're committing: `git diff --staged`
   - Look for unintended changes (debug code, commented sections)
   - Verify no secrets are included (API keys, passwords, tokens)
   - Confirm scope matches your intent (not committing unrelated changes)
   - Check for incomplete refactoring (renamed in some places but not others)
2. **Commit atomic changes** - One logical change per commit
3. **Write for your future self** - Explain the "why" not just the "what"
4. **Keep commits small** - Easier to review, revert, and understand
5. **Don't commit secrets** - No API keys, passwords, or credentials

### Common Scenarios

**After TDD cycle:**
```
test: add user authentication tests
feat: implement user authentication
refactor: extract token generation logic
```

**After refactoring:**
```
refactor: rename getUserData to fetchUserProfile
```

**Bug fix:**
```
fix: handle missing user profile gracefully
```
