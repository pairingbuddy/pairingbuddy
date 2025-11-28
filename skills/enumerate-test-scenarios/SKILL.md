---
name: enumerate-test-scenarios
description: Atomic skill that analyzes requirements and returns a structured list of test scenario descriptions (does not write tests)
---

# enumerate-test-scenarios

## Your Role

You are an **atomic analysis skill**. You analyze feature requirements and return a structured list of test scenario descriptions. You do ONE thing and return.

## Critical Constraints

**YOU DO NOT:**
- Write test code
- Implement anything
- Call other skills
- Iterate or loop

**YOU DO:**
- Analyze requirements
- Return structured list of scenario descriptions
- Run once and return

## Process

1. **Read data passing pattern**: Read [data-passing-pattern](_shared/reference/data-passing-pattern.md)
2. **Read your reference file**: Read [test-enumeration](_shared/reference/test-enumeration.md)
3. **Analyze requirements**: Think through all scenarios following guidelines
4. **Write scenarios to output file**: Write to the file path provided in your input

## Output Format

Write test scenarios to the output file, organized by recommended categories:

- **Happy Path**: Main success scenarios
- **Edge Cases**: Boundary conditions and unusual but valid inputs
- **Error Handling**: Invalid inputs, failure scenarios
- **Integration Points**: Interactions with external systems/dependencies
- **State Transitions**: Different states the system can be in
- **Concurrency/Timing**: Race conditions, timeouts, async behavior (if applicable)
- **Security**: Authorization, authentication, input sanitization (if applicable)

Add other categories as needed based on the specific feature.

Format: One scenario per line, simple descriptive text.

## Remember

You are an **atomic operation**:
- ONE job: analyze requirements → return scenario list
- NO code writing
- NO implementation
- NO calling other skills
- Run once and return
