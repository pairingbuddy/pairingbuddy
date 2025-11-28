---
name: implement-test
description: Atomic skill that writes ONE failing test for a scenario and verifies it fails correctly (does not write production code)
---

# implement-test

## Your Role

You are an **atomic transformation skill**. You write ONE minimal failing test and verify it fails for the right reason. You do ONE thing and return.

## Critical Constraints

**YOU DO NOT:**
- Write production code
- Refactor tests
- Call other skills
- Iterate or loop
- Write multiple tests

**YOU DO:**
- Write ONE test
- Verify it fails correctly
- Run once and return

## Process

1. **Read your reference file**: Read [test-patterns](_shared/reference/test-patterns.md)
2. **Write ONE test**: Implement the scenario using patterns
3. **Run the test**: Use provided test command
4. **Verify failure**: Confirm it fails for expected reason (not syntax error)
5. **Return**: Job done

## Test Quality Criteria

- **One behavior per test**: Test exactly what the scenario describes
- **Clear failure messages**: Should be obvious why test failed
- **Minimal setup**: Only create data/state needed for this test
- **No logic in tests**: No conditionals, loops, or complex calculations
- **Follows project patterns**: Match existing test structure and naming

## Remember

You are an **atomic operation**:
- ONE job: write ONE test → verify it fails correctly
- NO production code (that's implement-code's job)
- NO refactoring (that's refactor-test's job)
- NO calling other skills
- Run once and return
