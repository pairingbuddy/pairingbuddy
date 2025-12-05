---
name: writing-code
description: Provides SOLID principles, Clean Code practices, and minimal code approach for writing production code. Use when implementing features or writing code that tests require. Covers dependency injection, function design, and error handling.
---

# Writing Code

Reference material for writing clean, maintainable production code.

## Contents

- [Quick Reference](#quick-reference) - SOLID principles at a glance
- [Detailed Patterns](./reference.md) - Deep dive with examples

## Quick Reference

### SOLID Principles

| Principle | Meaning |
|-----------|---------|
| **S**ingle Responsibility | Each class has ONE reason to change |
| **O**pen/Closed | Open for extension, closed for modification |
| **L**iskov Substitution | Subtypes must be substitutable for base types |
| **I**nterface Segregation | Focused interfaces, not fat ones |
| **D**ependency Inversion | Depend on abstractions, not concretions |

### Clean Code Essentials

**Meaningful Names:**
- Class names are nouns: `PaymentProcessor`, `OrderValidator`
- Method names are verbs: `process()`, `validate()`, `send()`
- Pick one word per concept (don't mix `fetch`, `retrieve`, `get`)

**Function Design:**
- Small: 20 lines or less
- Do one thing at one level of abstraction
- Few arguments: 0-1 ideal, 2 good, 3+ avoid

**Error Handling:**
- Use exceptions, not error codes
- Don't return null (throw, return Optional, or Null Object)
- Don't pass null (validate at boundary)

### Minimal Code Approach

Only implement what the assertions explicitly check:
- What makes the assertion pass
- Literally hardcode values if that passes
- Next test will force real logic

If hardcoding passes, the test is incomplete or you need more tests.

### Simple Design (Kent Beck's 4 Rules)

In priority order:
1. Runs all the tests
2. Contains no duplication
3. Expresses intent clearly
4. Minimizes classes and methods
