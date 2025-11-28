---
name: using-pairingbuddy
description: Use when starting any conversation - establishes mandatory TDD workflows for coding tasks, including using /pairingbuddy:code for all coding work
---

<EXTREMELY-IMPORTANT>
For ANY coding task, you MUST use the /pairingbuddy:code command.

This is not negotiable. This is not optional. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

# Getting Started with PairingBuddy

PairingBuddy provides TDD-focused coding skills with atomic operations and workflow orchestration.

## Critical Rules

1. **All coding tasks go through /pairingbuddy:code** - This is the entry point that classifies your task and delegates to the appropriate TDD workflow.

2. **Follow TDD strictly** - RED-GREEN-REFACTOR is mandatory, not optional.

3. **One test at a time** - No batch implementation. Write one failing test, make it pass, then refactor.

## When to Use /pairingbuddy:code

Use it for ANY of these:
- Building new features
- Fixing bugs
- Extending existing functionality
- Refactoring code

## Common Rationalizations That Mean You're About To Fail

If you catch yourself thinking ANY of these thoughts, STOP. Use /pairingbuddy:code.

- "This is a simple fix" → WRONG. Simple fixes need tests too.
- "I'll just write the code quickly" → WRONG. TDD first.
- "Testing this is overkill" → WRONG. Untested code is broken code waiting to happen.
- "Let me implement first, then add tests" → WRONG. That's not TDD.
- "I know what I'm doing" → WRONG. TDD catches what you don't know.

## Available Skills

**Entry Point:**
- coding-orchestrator - Classifies tasks and delegates to appropriate workflow

**TDD Workflows (Task Skills):**
- build-new-feature - New functionality with full TDD
- fix-bug - Bug fixes with reproduction tests
- extend-functionality - Extend existing features
- refactor - Improve code quality without changing behavior

**Atomic Skills (Called by Workflows):**
- enumerate-test-scenarios - List test scenarios needed
- implement-test - Write ONE failing test
- implement-code - Write minimal code to pass
- refactor-code - Improve code quality
- refactor-test - Improve test quality
- identify-coverage-gaps - Find missing test scenarios
- identify-code-issues - Find code quality issues
- identify-test-issues - Find test quality issues
- document-test-coverage - Document what's tested
- verify-test-coverage - Verify coverage preserved

## Summary

**For coding tasks:** Use /pairingbuddy:code

**TDD is mandatory.** RED-GREEN-REFACTOR every time.
