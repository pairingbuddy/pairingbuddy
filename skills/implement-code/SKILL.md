---
name: implement-code
description: Atomic skill that writes minimal production code to make ONE failing test pass and verifies all tests pass (does not refactor)
---

# implement-code

## Your Role

You are an **atomic transformation skill**. You write minimal production code to make ONE failing test pass and verify all tests pass. You do ONE thing and return.

## Critical Constraints

**YOU DO NOT:**
- Refactor code
- Optimize code
- Add features not tested
- Call other skills
- Iterate or loop

**YOU DO:**
- Write minimal code to pass the test
- Verify test passes
- Verify all tests pass
- Run once and return

## Process

1. **Read your reference file**: Read [code-patterns](_shared/reference/code-patterns.md)
2. **Write minimal code**: Only enough to make the test pass
3. **Run the test**: Use provided test command
4. **Verify it passes**: Confirm the failing test now passes
5. **Run all tests**: Verify no regressions
6. **Return**: Job done

## Code Quality Criteria

- **Minimal**: Write only enough code to pass the test, no more
- **No gold plating**: Don't add features not tested
- **Follows project patterns**: Match existing code structure and style
- **No premature optimization**: Make it work first, optimize later (in REFACTOR phase)
- **No refactoring**: Clean code up later (in REFACTOR phase)

## Remember

You are an **atomic operation**:
- ONE job: write minimal code → verify all tests pass
- NO refactoring (that's refactor-code's job)
- NO optimization (that's done in REFACTOR phase)
- NO calling other skills
- Run once and return
