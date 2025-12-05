# Test Enumeration Reference

## Contents

- [One Behavior Per Test](#one-behavior-per-test)
- [What Behaviors to Enumerate](#what-behaviors-to-enumerate)
- [Anti-Patterns to Avoid](#anti-patterns-to-avoid)
- [Enumeration Techniques](#enumeration-techniques)
- [When to Stop vs Continue](#when-to-stop-vs-continue)
- [Section Organization](#section-organization)

## One Behavior Per Test

Each test should verify ONE distinct behavior. Avoid testing permutations of the same behavior.

**Boundaries ARE distinct behaviors** (off-by-one errors are common):

```
- accepts minimum valid age (18)
- accepts maximum valid age (120)
- accepts valid age within range (45)
- rejects age below minimum (17)
- rejects age above maximum (121)
```

Each boundary tests different comparison logic (`<` vs `<=`, correct constants, etc.).

**Arbitrary variations are NOT distinct behaviors:**

```
Bad:  "processes order with 1 item", "processes order with 2 items", "processes order with 5 items"
Good: "processes order with items" (use representative quantity like 2)
```

**But boundary cases still matter:**

```
- rejects order with zero items
- processes order with maximum allowed items (100)
```

**Key question:** Does this test verify different logic or catch a different potential bug?
- Boundary values? → Yes, different bugs (off-by-one)
- Arbitrary variations in the middle? → No, same behavior

**Philosophy:** Better one test too many than one test too few.
- Unit tests are cheap to run
- A missed test = a hole in the safety net = bugs in production
- When in doubt, include the test
- Focus on eliminating redundancy and non-behaviors, not on reducing test count

## What Behaviors to Enumerate

Think through what the feature must do:

| Category | What to Look For |
|----------|------------------|
| **Happy path** | What should happen when everything works correctly? |
| **Boundary** | Min/max values, empty/zero, first/last elements |
| **Validation** | What inputs should be rejected and why? |
| **Error handling** | How should the feature respond to failures? |
| **State/side-effects** | What changes should occur in the system? |
| **Edge cases** | Unusual but valid conditions (nulls, special characters, etc.) |
| **Integration** | How should the feature interact with external systems? |

For each dimension, ask: "What distinct behaviors must the feature exhibit?" and "Where could bugs hide?"

## Anti-Patterns to Avoid

**Read these rules before enumerating. These are common mistakes that create bad test specifications.**

### NEVER Enumerate Implementation Details

Implementation details are HOW the code works internally. Tests must verify WHAT the code does externally.

**Wrong:**
```
- modifies list in-place
- returns same object reference
- uses binary search algorithm
- calls helper method sort_by_key
```

**Correct:**
```
- sorts items in descending order by connection count
```

**If you're describing HOW it works, it's an implementation detail. Ask: what is the externally observable behavior?**

### NEVER Enumerate Context Variations

Don't create separate tests for calling the same function from different places.

**Wrong:**
```
- works correctly when called from PersonSearchService
- works correctly when called from MeetingSearchService
```

**Correct:**
```
- Only test if there's service-specific field handling that differs
```

**If the behavior is identical regardless of caller, you don't need separate tests.**

### NEVER Enumerate Verification Steps as Separate Tests

Verifications are assertions WITHIN tests, not separate tests themselves.

**Wrong:**
```
- verifies items are in descending order (this is an assertion)
- verifies counts are summed correctly (this is an assertion)
- verifies no items are lost (this is an assertion)
```

**Correct:**
```
- sorts by sum of multiple connection fields (the behavior being tested)
```

**If you're describing what the test checks rather than what the feature does, it's a verification step, not a test.**

### NEVER Create Redundant Variations

If multiple scenarios test the same underlying behavior with trivial variations, consolidate them.

**Wrong - Three separate tests:**
```
- handles missing field as zero
- handles None as zero
- handles empty list as zero
```

**Correct - One test:**
```
- treats missing, None, or empty connection fields as zero
```

**Wrong - Three separate tests:**
```
- handles empty input list
- handles list with no items
- handles results array with zero length
```

**Correct - One test:**
```
- handles empty input list
```

**If you find yourself writing "handles X", "handles Y", "handles Z" where X/Y/Z are just different ways to express the same condition, consolidate into one test.**

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

## When to Stop vs Continue

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

**Don't aim for perfection** - you won't think of everything upfront.

**Balance completeness with progress** - list obvious scenarios, then start. The TDD cycle handles discovery.

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
