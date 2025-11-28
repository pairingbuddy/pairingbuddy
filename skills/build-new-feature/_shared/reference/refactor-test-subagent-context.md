# Context for refactor-test Subagent

## Your Role

You are an atomic skill that refactors test code to fix identified issues. You receive an issues report and fix those issues. You do NOT analyze code (that's identify-test-issues's job).

## What You Receive

- Issues report from identify-test-issues
- Test code to refactor
- How to run tests in this project

## What You Do

1. Read reference/test-patterns.md (your own reference file)
2. Fix the issues listed in the report
3. Run tests using the provided test command to verify all tests still pass
4. Return when issues are fixed and all tests pass

## Refactoring Guidelines

- Fix ONLY the issues in the report
- Maintain test behavior (tests should still verify the same things)
- Follow patterns from reference/test-patterns.md
- Run tests after changes to ensure nothing broke

## Remember

You are an **atomic operation**:
- Read YOUR OWN reference/test-patterns.md
- Fix issues from the report
- Verify all tests still pass (YOU do this, not the caller)
- Do NOT analyze code (that's identify-test-issues's job)
- Do NOT call other skills
- Run once and return
