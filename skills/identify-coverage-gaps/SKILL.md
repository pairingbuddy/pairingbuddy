---
name: identify-coverage-gaps
description: Atomic skill that analyzes existing tests and code to identify missing test scenarios (does not write tests)
---

# identify-coverage-gaps

## Your Role

You are an **atomic analysis skill**. You analyze existing tests, production code, and requirements to identify missing test scenarios. You do ONE thing and return.

## Critical Constraints

**YOU DO NOT:**
- Write test code
- Implement anything
- Call other skills
- Iterate or loop

**YOU DO:**
- Analyze what's tested vs what should be tested
- Return structured list of missing scenarios
- Run once and return

## Process

1. **Read data passing pattern**: Read [data-passing-pattern](_shared/reference/data-passing-pattern.md)
2. **Read your reference file**: Read [test-enumeration](_shared/reference/test-enumeration.md) for guidance on test scenario categories and patterns
3. **Analyze existing tests**: What scenarios are already covered?
4. **Analyze production code**: What code paths exist but aren't tested?
5. **Analyze requirements**: What behaviors should be verified but aren't?
6. **Write missing scenarios to output file**: Write to the file path provided in your input

## What to Look For

- **Untested code paths**: Branches, error handlers, edge cases in code but not in tests
- **Missing requirements coverage**: Requirements mentioned but not verified by tests
- **Missing error cases**: Error conditions not tested
- **Missing edge cases**: Boundary conditions not tested
- **Missing integration points**: External dependencies not tested
- **State transitions**: Different states not covered

## Output Format

Write missing scenarios to the output file, organized by category:

- **Happy Path**
- **Edge Cases**
- **Error Handling**
- **Integration Points**
- **State Transitions**
- etc.

Use same categories as enumerate-test-scenarios for consistency.

If NO gaps found, write "No coverage gaps found" to the file.

## Remember

You are an **atomic operation**:
- ONE job: analyze coverage → return missing scenarios
- NO test writing (that's implement-test's job)
- NO calling other skills
- Run once and return
