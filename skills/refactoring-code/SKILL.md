---
name: refactoring-code
description: Provides code smell identification and refactoring techniques for improving existing code. Use when reviewing code for issues or refactoring to improve quality. Covers anti-patterns, when to refactor, and common refactoring moves.
---

# Refactoring Code

Reference material for identifying code smells and applying refactoring techniques.

## Contents

- [Quick Reference](#quick-reference) - Common smells at a glance
- [Detailed Patterns](./reference.md) - Deep dive with examples

## Quick Reference

### Common Code Smells

| Smell | Symptom | Fix |
|-------|---------|-----|
| **God Object** | Class does everything | Extract focused classes |
| **Hardcoded Dependencies** | `self.db = PostgresDatabase()` | Inject via constructor |
| **Type Discrimination** | `if type == "x": ... elif type == "y":` | Use polymorphism |
| **Long Method** | Method > 20 lines | Extract methods |
| **Long Parameter List** | 3+ parameters | Introduce parameter object |
| **Feature Envy** | Method uses other class's data more | Move method |
| **Data Clumps** | Same fields appear together | Extract class |

### When to Refactor

**During TDD (REFACTOR phase):**
- After tests pass (GREEN)
- Before next test (RED)
- Small, incremental changes

**Signs you should refactor:**
- Duplicate code
- Hard to understand
- Hard to change without breaking other things
- Excessive complexity for what it does

**Signs you should NOT refactor:**
- Tests are failing (fix tests first)
- You're about to add a feature (add first, then refactor)
- Code is untested (add tests first)

### Refactoring Safety

1. Tests must pass before refactoring
2. Make small changes
3. Run tests after each change
4. Commit frequently
5. If tests break, revert and try smaller step
