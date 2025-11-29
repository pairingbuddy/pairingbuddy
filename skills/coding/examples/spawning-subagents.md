# Spawning Subagents - Real-World Examples

This file shows complete examples of how to spawn component skills as subagents using the Task tool.

## Example 1: Spawning refactor-app-code

**Scenario:** User has implemented a user authentication feature. All tests pass, but the Authenticator class is doing too much - handling validation, session management, and persistence. User asks: "Refactor the authentication code to follow SOLID principles"

**Task tool invocation:**
```
Task tool with:
  subagent_type: "general-purpose"
  description: "Refactor authentication code"
  prompt: "Use and follow the refactor-app-code skill exactly as written.

**User's request:** Refactor the authentication code to follow SOLID principles

**Files to refactor:**
- src/auth/authenticator.py (main authentication logic)
- src/auth/session.py (session management)
- src/auth/persistence.py (database operations)

**Current state:** All 15 tests passing

**Specific concerns:** The Authenticator class is handling validation, session management, and persistence. This violates Single Responsibility Principle.

**Constraints:** Cannot change the public API - existing code depends on Authenticator.authenticate(username, password) signature."
```

**Expected subagent response:**
- Analysis of SOLID violations found (SRP violation in Authenticator)
- Refactoring plan (extract SessionManager, extract UserRepository)
- Changes made with test results after each refactoring
- Final verification that all tests still pass

---

## Example 2: Spawning refactor-test-code

**Scenario:** User has written tests for a payment processing system. Tests work but are hard to understand and take 30 seconds to run. User asks: "Clean up the payment tests - they're really messy"

**Task tool invocation:**
```
Task tool with:
  subagent_type: "general-purpose"
  description: "Refactor payment tests"
  prompt: "Use and follow the refactor-test-code skill exactly as written.

**User's request:** Clean up the payment tests - they're really messy

**Test files to refactor:**
- tests/test_payment_processor.py (main test file, 450 lines)
- tests/test_payment_validation.py (validation tests, 200 lines)

**Current state:** All 23 tests passing (execution time: 30 seconds)

**Specific concerns:** Tests are hard to understand, have lots of duplication in setup code, and some tests have unclear assertions.

**Production code context:**
- PaymentProcessor handles credit card payments
- PaymentValidator validates card numbers, expiry, CVV
- Tests hit real stripe test API (causing slowness)"
```

**Expected subagent response:**
- Test smells identified (obscure tests, slow tests, duplicated setup)
- Refactoring plan (extract test fixtures, clarify assertions, mock stripe API)
- Changes made with test results
- Final verification showing improved clarity and faster execution

---

## Example 3: Spawning extend-test-coverage

**Scenario:** User has implemented a date range validation function. Basic tests exist but code review shows edge cases aren't covered. User asks: "Add tests for edge cases in date validation"

**Task tool invocation:**
```
Task tool with:
  subagent_type: "general-purpose"
  description: "Extend date validation coverage"
  prompt: "Use and follow the extend-test-coverage skill exactly as written.

**User's request:** Add tests for edge cases in date validation

**Files to analyze:**
- src/validators/date_validator.py (validation logic)
- tests/test_date_validator.py (existing tests)

**Current coverage:** 75% line coverage, 60% branch coverage

**Current state:** All 8 tests passing

**Specific scenarios to cover:** Leap years, timezone boundaries, date format edge cases (mentioned in code review)"
```

**Expected subagent response:**
- Coverage analysis showing gaps (leap year handling, timezone edge cases, invalid formats)
- Testability assessment (code is testable as-is)
- List of missing tests (10 edge cases identified)
- Implementation of missing tests using RED-GREEN-REFACTOR
- Final coverage metrics (95% line, 90% branch)

---

## Example 4: Spawning optimize-test-execution

**Scenario:** User's integration tests take 5 minutes to run. User asks: "These tests are way too slow, can we speed them up?"

**Task tool invocation:**
```
Task tool with:
  subagent_type: "general-purpose"
  description: "Optimize slow integration tests"
  prompt: "Use and follow the optimize-test-execution skill exactly as written.

**User's request:** These tests are way too slow, can we speed them up?

**Test files to analyze:**
- tests/integration/test_api_endpoints.py (35 tests, 180 seconds)
- tests/integration/test_database_operations.py (28 tests, 120 seconds)

**Current execution time:** 5 minutes total (300 seconds)

**Current state:** All 63 tests passing

**Performance concerns:** CI pipeline times out, developers skip running tests locally due to slowness"
```

**Expected subagent response:**
- Test pyramid analysis (many integration tests doing unit-level checks)
- Pyramid violations identified (15 tests should be unit tests)
- Performance analysis (database setup/teardown in every test, no connection pooling)
- Optimization plan (move unit-level tests to unit suite, add connection pooling, parallelize where safe)
- Changes made with before/after timing (300s → 45s)
- Final verification all tests still pass
