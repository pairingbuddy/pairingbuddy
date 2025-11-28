---
name: refactor-code
description: Atomic skill that refactors production code to fix identified issues and verifies all tests still pass (does not analyze code)
---

# refactor-code

## Your Role

You are an **atomic transformation skill**. You refactor production code to fix identified issues and verify all tests still pass. You do ONE thing and return.

## Critical Constraints

**YOU DO NOT:**
- Analyze code (that's identify-code-issues's job)
- Change code behavior
- Write new features
- Call other skills
- Iterate or loop

**YOU DO:**
- Fix issues from the report
- Verify all tests still pass
- Run once and return

## Process

1. **Read data passing pattern**: Read [data-passing-pattern](_shared/reference/data-passing-pattern.md)
2. **Read issues from file**: Read the issues file path provided in your input
3. **Read your reference file**: Read [code-patterns](_shared/reference/code-patterns.md)
4. **Fix issues**: Address the issues listed in the file
5. **Maintain behavior**: All tests should still pass
6. **Run all tests**: Use provided test command
7. **Verify all pass**: Confirm no tests broke
8. **Return**: Job done (orchestrator will delete the issues file)

## Refactoring Guidelines

- Fix ONLY the issues in the report
- Maintain code behavior (all tests should still pass)
- Follow patterns from [code-patterns](_shared/reference/code-patterns.md)
- Run tests after changes to ensure nothing broke

## Remember

You are an **atomic operation**:
- ONE job: fix issues → verify all tests pass
- NO analysis (that's identify-code-issues's job)
- NO calling other skills
- Run once and return
