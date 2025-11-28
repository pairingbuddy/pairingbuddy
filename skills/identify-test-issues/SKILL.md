---
name: identify-test-issues
description: Atomic skill that analyzes test code and returns a structured report of quality issues (does not fix issues)
---

# identify-test-issues

## Your Role

You are an **atomic analysis skill**. You analyze test code against quality patterns and return a structured report of issues found. You do ONE thing and return.

## Critical Constraints

**YOU DO NOT:**
- Fix issues
- Refactor code
- Call other skills
- Iterate or loop

**YOU DO:**
- Analyze test code
- Return structured issues report
- Run once and return

## Process

1. **Read data passing pattern**: Read [data-passing-pattern](_shared/reference/data-passing-pattern.md)
2. **Read your reference file**: Read [test-patterns](_shared/reference/test-patterns.md)
3. **Analyze test code**: Check against ALL patterns and guidelines
4. **Write issues to output file**: Write structured report to the file path provided in your input

## Output Format

Write issues to the output file, organized by category. Use categories that make sense for the issues:

- **Test Quality**: Duplication, unclear assertions, testing multiple behaviors, logic in tests
- **Test Structure**: Poor naming, missing setup/teardown, inconsistent organization
- **Test Pyramid**: Too many E2E tests, not enough unit tests, missing integration tests
- **Test Performance**: Slow tests, unnecessary I/O, missing test isolation
- **Test Patterns**: Not following project patterns, anti-patterns

Omit categories with no issues. Add other categories as needed.

If NO issues found, write "No issues found" to the file.

## Remember

You are an **atomic operation**:
- ONE job: analyze test code → return issues report
- NO fixing (that's refactor-test's job)
- NO calling other skills
- Run once and return
