# Task Classification

This module defines how to classify coding tasks and delegate to the appropriate specialized skill.

## Task Types and Specialized Skills

| Task Type | Specialized Skill | Invocation Method | When to Use |
|-----------|------------------|-------------------|-------------|
| **Build new feature** | build-new-feature | Skill tool | Creating new functionality from scratch |
| **Fix bug** | fix-bug | Skill tool | Addressing existing defects with regression tests |
| **Extend functionality** | extend-functionality | Skill tool | Adding to existing features, maintaining consistency |
| **Refactor app code** | refactor-app-code | Task tool (subagent) | Improve production code structure (SOLID, Clean Code) |
| **Refactor test code** | refactor-test-code | Task tool (subagent) | Improve test quality (xUnit patterns, test smells) |
| **Extend test coverage** | extend-test-coverage | Task tool (subagent) | Fill coverage gaps in existing code |
| **Optimize test execution** | optimize-test-execution | Task tool (subagent) | Fix test pyramid violations, improve test speed |

## Classification Heuristics

### Keywords Analysis

**Build new feature** indicators:
- "add", "create", "implement", "build", "new feature"
- "from scratch", "new functionality"
- Git status: No related files exist yet

**Fix bug** indicators:
- "fix", "bug", "defect", "error", "broken", "not working"
- "regression", "reproduce"
- Git status: Modified files (usually)

**Extend functionality** indicators:
- "extend", "add to", "enhance", "improve existing"
- "support additional", "handle more cases"
- Git status: Modified files with existing tests

**Refactor app code** indicators:
- "refactor", "clean up", "improve structure"
- "SOLID", "Clean Code", "organize code"
- "extract", "split", "separate concerns"
- No mention of test code specifically

**Refactor test code** indicators:
- "refactor tests", "clean up tests", "improve test quality"
- "test smells", "xUnit patterns", "test structure"
- "obscure test", "fragile test"

**Extend test coverage** indicators:
- "coverage", "add tests", "missing tests"
- "test gaps", "untested code", "improve coverage"
- Git status: Existing code, request for tests

**Optimize test execution** indicators:
- "test pyramid", "slow tests", "optimize tests"
- "test performance", "test speed"
- "integration tests should be unit tests"

### Context Clues

**Git status analysis**:
- New files created → Likely build-new-feature
- Modified app files only → Likely extend-functionality or fix-bug
- Modified test files only → Likely refactor-test-code or extend-test-coverage
- No changes yet → Depends on request (could be any)

**Recent commit messages**:
- Feature commits → Likely extending or building
- Bug fix commits → Likely fixing more bugs
- Refactor commits → Likely continuing refactoring

## Decision Logic

### Clear Classification

If request contains clear indicators AND no conflicting signals:
1. Announce classification
2. State which skill will be invoked
3. Proceed with delegation

Example:
```
I've classified this as: Build new feature
Delegating to: build-new-feature skill
```

### Ambiguous Classification

If multiple task types could apply OR request is vague:
1. State why classification is ambiguous
2. Read `modules/ambiguity-resolution.md`
3. Use AskUserQuestion with options from that module
4. Proceed based on user's answer

Example:
```
The request could be either "extend functionality" or "build new feature".
Reading modules/ambiguity-resolution.md for guidance...
```

## Delegation Patterns

### Using Skill Tool (Task Skills)

**For:** build-new-feature, fix-bug, extend-functionality

**Pattern:**
```
I'm delegating to the [skill-name] skill to handle this work.
```

Then invoke Skill tool with skill name.

**Why Skill tool:**
- These skills orchestrate the main TDD workflow
- Need access to conversation context
- Guide user interactively through phases
- Make decisions based on user responses

### Using Task Tool (Component Skills)

**For:** refactor-app-code, refactor-test-code, extend-test-coverage, optimize-test-execution

**Pattern:**
```
I'm spawning a subagent to [purpose] following the [skill-name] skill.
```

Then:
1. Read `subagent-templates/[skill-name].md` for context guidance
2. Construct Task tool prompt based on that guidance
3. Wait for subagent to complete and report back

**Why Task tool (subagent):**
- These skills perform independent analysis
- Don't need conversation history
- Isolating them prevents context window bloat
- Fresh analysis without bias from previous work

## Common Patterns

**New feature from scratch:**
```
Request: "Add email validation"
Git status: Clean
Classification: build-new-feature
Method: Skill tool
```

**Bug in existing code:**
```
Request: "Fix pagination off-by-one error"
Git status: Modified files
Classification: fix-bug
Method: Skill tool
```

**Adding to existing feature:**
```
Request: "Support additional email formats"
Git status: Modified files, existing tests
Classification: extend-functionality
Method: Skill tool
```

**Code quality improvement:**
```
Request: "Refactor UserService to follow SOLID"
Git status: Clean (analyzing existing)
Classification: refactor-app-code
Method: Task tool (subagent)
```

**Test quality improvement:**
```
Request: "Clean up obscure tests in AuthModule"
Git status: Test files
Classification: refactor-test-code
Method: Task tool (subagent)
```

**Coverage gaps:**
```
Request: "Add missing tests for edge cases"
Git status: Existing code, low coverage
Classification: extend-test-coverage
Method: Task tool (subagent)
```

**Test performance:**
```
Request: "Tests are too slow, optimize them"
Git status: Test files
Classification: optimize-test-execution
Method: Task tool (subagent)
```
