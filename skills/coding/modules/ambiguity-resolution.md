# Ambiguity Resolution

This module defines how to use AskUserQuestion when task classification is unclear.

## When to Ask

Use AskUserQuestion when:
- Request contains vague language ("improve code", "fix this")
- Multiple task types could apply equally
- Context clues conflict with request keywords
- User's intent is genuinely unclear

**Never guess** when classification affects workflow. Better to ask than delegate incorrectly.

## AskUserQuestion Structure

Use AskUserQuestion with these option labels and reference skill descriptions:

**Primary task types:**
- "Build new feature from scratch" → build-new-feature skill description
- "Fix an existing bug" → fix-bug skill description
- "Extend existing functionality" → extend-functionality skill description
- "Refactor production code" → refactor-app-code skill description

**Test-specific improvements (if user selects "Other"):**
- "Refactor test code" → refactor-test-code skill description
- "Extend test coverage" → extend-test-coverage skill description
- "Optimize test execution" → optimize-test-execution skill description

**Note:** Use each skill's actual description from its SKILL.md frontmatter. Don't duplicate descriptions here.

## Phrasing the Question

**Context-aware introduction:**
```
I've analyzed your request: "[user request]"
Git status shows: [brief status summary]

This could be classified as [option 1] or [option 2] because [brief reason].

To ensure I use the correct workflow, I need to clarify the task type.
```

Then present the AskUserQuestion.

## Handling User Response

After user selects option:
1. Acknowledge: "Thank you for clarifying. Proceeding with [task type]."
2. Return to main workflow
3. Use classification from user's answer
4. Delegate to appropriate skill

## Example Flow

```
User: "Improve the authentication code"

Orchestrator analyzes:
- "Improve" is vague
- Could be: build new feature, extend functionality, or refactor
- Git status: Existing auth files

Orchestrator asks:
"I've analyzed your request: 'Improve the authentication code'
Git status shows: Existing authentication files

This could be classified as:
- Extend functionality (add new auth methods)
- Refactor production code (improve existing auth structure)
- Build new feature (add new auth-related feature)

To ensure I use the correct workflow, I need to clarify the task type."

[Presents AskUserQuestion with options]

User selects: "Refactor production code"

Orchestrator:
"Thank you for clarifying. Proceeding with refactor-app-code.
I'm spawning a subagent to improve code structure following the refactor-app-code skill."

[Continues with subagent invocation]
```

## Common Ambiguous Requests

**"Fix this"** → Could be fix-bug or refactor-app-code
- Ask: Is there a defect (bug) or quality issue (refactor)?

**"Add tests"** → Could be extend-functionality or extend-test-coverage
- Ask: Are you adding tests for new code or filling gaps in existing code?

**"Improve code"** → Could be any task type
- Ask: All 7 options with full descriptions

**"Make tests faster"** → Could be refactor-test-code or optimize-test-execution
- Ask: Focus on test quality (refactor) or test performance (optimize)?

## Quality Criteria

Before using AskUserQuestion:
- [ ] Attempted automatic classification first
- [ ] Identified specific ambiguity (can articulate why unclear)
- [ ] Presented relevant options only (not all 7 if some clearly don't apply)
- [ ] Included context in question phrasing
- [ ] Provided clear descriptions for each option
