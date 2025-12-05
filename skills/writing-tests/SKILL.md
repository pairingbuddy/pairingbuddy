---
name: writing-tests
description: Provides test structure patterns, FIRST principles, and anti-patterns for writing effective tests. Use when implementing, reviewing, or refactoring test code. Covers four-phase structure, fixture usage, and common test smells.
---

# Writing Tests

Reference material for writing effective, maintainable tests.

## Contents

- [Quick Reference](#quick-reference) - Four-phase, SUT, FIRST at a glance
- [Detailed Patterns](./reference.md) - Deep dive with examples
- [Anti-Patterns](./anti-patterns.md) - What to avoid and fixes
- [Python & pytest](./python.md) - Language-specific conventions

## Quick Reference

### Four-Phase Test Structure

Every test follows: **Setup, Exercise, Verify, Teardown** (SEVT).

```python
def test_retries_failed_operations():
    # Setup
    attempts = []
    def operation():
        attempts.append(1)
        if len(attempts) < 3:
            raise ConnectionError("failed")
        return "success"

    # Exercise
    result = retry_operation(operation)

    # Verify
    assert result == "success"
    assert len(attempts) == 3
```

Use blank lines to separate phases, not comments.

### SUT Convention

Name the System Under Test `sut` for easy identification:

```python
def test_validates_email_format():
    sut = EmailValidator()

    result = sut.validate("invalid-email")

    assert result.is_valid == False
```

### FIRST Principles

| Principle | Meaning |
|-----------|---------|
| **Fast** | Milliseconds, not seconds. Use fakes, not real databases. |
| **Independent** | No shared state between tests. Each test runs in isolation. |
| **Repeatable** | Same result in any environment (local, CI, offline). |
| **Self-validating** | Pass/fail via assertions, no manual inspection. |
| **Timely** | Written before production code (TDD practice). |

### Test Smells Quick Check

**Clarity:**
- Clear at a glance? (no Obscure Test)
- Tests ONE thing? (no Eager Test)
- All data visible? (no Mystery Guest)
- No if/for/while? (no Conditional Test Logic)

**Reliability:**
- Assertions have messages? (no Assertion Roulette)
- Won't break from unrelated changes? (no Fragile Test)
- Deterministic? (no Erratic Test)
- Fast? (no Slow Tests)

**Coverage:**
- Has assertions? (no Missing Assertions)
- Exercises new code? (no Untested Code)
