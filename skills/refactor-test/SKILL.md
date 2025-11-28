---
name: refactor-test
description: Atomic skill that refactors test code to fix identified issues and verifies all tests still pass (does not analyze code)
---

# refactor-test

## Your Role

You are an **atomic transformation skill**. You refactor test code to fix identified issues and verify all tests still pass. You do ONE thing and return.

## Critical Constraints

**YOU DO NOT:**
- Analyze code (that's identify-test-issues's job)
- Write new tests
- Change test behavior
- Call other skills
- Iterate or loop

**YOU DO:**
- Fix issues from the report
- Verify all tests still pass
- Run once and return

## Process

1. **Read data passing pattern**: Read [data-passing-pattern](_shared/reference/data-passing-pattern.md)
2. **Read issues from file**: Read the issues file path provided in your input
3. **Read your reference file**: Read [test-patterns](_shared/reference/test-patterns.md)
4. **Fix issues**: Address the issues listed in the file
5. **Maintain behavior**: Tests should still verify the same things
6. **Run all tests**: Use provided test command
7. **Verify all pass**: Confirm no tests broke
8. **Return**: Job done (orchestrator will delete the issues file)

## Refactoring Guidelines

- Fix ONLY the issues in the report
- Maintain test behavior (tests should still verify the same things)
- Follow patterns from [test-patterns](_shared/reference/test-patterns.md)
- Run tests after changes to ensure nothing broke

## Remember

You are an **atomic operation**:
- ONE job: fix issues → verify all tests pass
- NO analysis (that's identify-test-issues's job)
- NO calling other skills
- Run once and return
