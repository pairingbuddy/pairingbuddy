# Test Enumeration

## CRITICAL: Anti-Patterns to Avoid

**YOU MUST READ AND FOLLOW THESE RULES BEFORE ENUMERATING.**

These are common mistakes that create bad test specifications. Do NOT make these mistakes:

**1. NEVER enumerate implementation details:**

Implementation details are HOW the code works internally. Tests must verify WHAT the code does externally.

❌ WRONG: "modifies list in-place"
❌ WRONG: "returns same object reference"
❌ WRONG: "uses binary search algorithm"
❌ WRONG: "calls helper method sort_by_key"

✅ CORRECT: "sorts items in descending order by connection count"

**If you're describing HOW it works, it's an implementation detail. Stop and ask: what is the externally observable behavior?**

**2. NEVER enumerate context variations:**

Don't create separate tests for calling the same function from different places.

❌ WRONG: "works correctly when called from PersonSearchService"
❌ WRONG: "works correctly when called from MeetingSearchService"

✅ CORRECT: Only test if there's service-specific field handling that differs

**If the behavior is identical regardless of caller, you don't need separate tests.**

**3. NEVER enumerate verification steps as separate tests:**

Verifications are assertions WITHIN tests, not separate tests themselves.

❌ WRONG: "verifies items are in descending order" - this is an assertion in every sorting test
❌ WRONG: "verifies counts are summed correctly" - this is an assertion in the multi-field test
❌ WRONG: "verifies no items are lost" - this is an assertion, not a behavior

✅ CORRECT: "sorts by sum of multiple connection fields" - the behavior being tested

**If you're describing what the test checks rather than what the feature does, it's a verification step, not a test.**

**4. NEVER create redundant variations:**

If multiple scenarios test the same underlying behavior with trivial variations, consolidate them.

❌ WRONG: Three separate tests:
- "handles missing field as zero"
- "handles None as zero"
- "handles empty list as zero"

✅ CORRECT: One test: "treats missing, None, or empty connection fields as zero"

❌ WRONG: Three separate tests:
- "handles empty input list"
- "handles list with no items"
- "handles results array with zero length"

✅ CORRECT: One test: "handles empty input list"

**If you find yourself writing "handles X", "handles Y", "handles Z" where X/Y/Z are just different ways to express the same condition, consolidate into one test.**

## Process

Before writing any implementation code, discover and enumerate test scenarios.

### 1. List Test Scenarios

Identify all behaviors you need to verify based on requirements.

**Guidelines:**
- One test per behavior (not one test per permutation)
- Clear descriptive names (e.g., "rejects empty email", "retries failed operations 3 times")
- Think exhaustively: happy path, edge cases, error conditions
- Focus on externally observable behaviors, not implementation details

**Example:**
```python
def test_accepts_valid_email_with_domain():
    pytest.fail("Not implemented yet")

def test_rejects_email_without_at_symbol():
    pytest.fail("Not implemented yet")

def test_rejects_email_without_domain():
    pytest.fail("Not implemented yet")

def test_rejects_empty_email():
    pytest.fail("Not implemented yet")
```

### 2. Create Failing Placeholders

Write test stubs that fail immediately.

**Python:**
```python
def test_scenario_name():
    pytest.fail("Not implemented yet")
```

Placeholders create visible checklist of work remaining.

### 3. Discover as You Go

When implementation reveals new cases, add them as placeholders immediately.

**During implementation:**
```python
def test_accepts_email_with_subdomain():
    pytest.fail("Not implemented yet")
```

## Enumeration Techniques

### Happy Path

The main success scenario. Start here.

```python
def test_processes_valid_payment():
    pytest.fail("Not implemented yet")

def test_returns_order_confirmation():
    pytest.fail("Not implemented yet")
```

### Edge Cases

Boundary conditions and unusual but valid inputs.

```python
def test_handles_zero_amount():
    pytest.fail("Not implemented yet")

def test_handles_maximum_amount():
    pytest.fail("Not implemented yet")

def test_handles_empty_cart():
    pytest.fail("Not implemented yet")
```

### Error Cases

Invalid inputs and failure scenarios.

```python
def test_rejects_negative_amount():
    pytest.fail("Not implemented yet")

def test_rejects_invalid_payment_method():
    pytest.fail("Not implemented yet")

def test_retries_on_network_failure():
    pytest.fail("Not implemented yet")
```

### Boundary Conditions

Values at the limits of acceptable ranges.

```python
def test_accepts_minimum_valid_age():
    pytest.fail("Not implemented yet")

def test_rejects_age_below_minimum():
    pytest.fail("Not implemented yet")

def test_accepts_maximum_valid_age():
    pytest.fail("Not implemented yet")

def test_rejects_age_above_maximum():
    pytest.fail("Not implemented yet")
```

## When to Stop vs Continue Enumerating

### Enumerate Upfront

You already know requirements - list what you know upfront.

```python
def test_accepts_valid_email():
    pytest.fail("Not implemented yet")

def test_rejects_email_without_at_symbol():
    pytest.fail("Not implemented yet")

def test_rejects_empty_email():
    pytest.fail("Not implemented yet")
```

**Benefits:**
- Visible checklist of remaining work
- Complete picture of scope
- No context switching

### Add During Implementation

New cases discovered while implementing - add as placeholders immediately.

```python
def test_rejects_multiple_at_symbols():
    pytest.fail("Not implemented yet")

def test_accepts_email_with_plus_sign():
    pytest.fail("Not implemented yet")
```

List what you know, start implementing. The workflow handles discovery.

## Section Organization

Group enumerated tests by category using section boundaries.

```python
# ============================================================================
# Happy Path Tests
# ============================================================================


def test_accepts_valid_email():
    pytest.fail("Not implemented yet")


def test_returns_validation_success():
    pytest.fail("Not implemented yet")


# ============================================================================
# Edge Cases
# ============================================================================


def test_accepts_email_with_subdomain():
    pytest.fail("Not implemented yet")


def test_accepts_email_with_plus_sign():
    pytest.fail("Not implemented yet")


# ============================================================================
# Error Handling Tests
# ============================================================================


def test_rejects_empty_email():
    pytest.fail("Not implemented yet")


def test_rejects_email_without_at_symbol():
    pytest.fail("Not implemented yet")
```

## Practical Guidelines

**Don't aim for perfection:** You won't think of everything upfront.

**Add new cases as placeholders:** When you discover new scenarios during implementation, add them immediately.

**Start implementing:** After listing known scenarios, start. Don't spend hours enumerating edge cases.

**Balance completeness with progress:** List obvious scenarios, then start. The TDD cycle handles discovery.
