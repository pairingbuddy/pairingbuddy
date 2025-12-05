# Test Patterns Reference

## Contents

- [Four-Phase Test Structure](#four-phase-test-structure)
- [SUT Naming Convention](#sut-naming-convention)
- [FIRST Principles](#first-principles)
- [Test File Organization](#test-file-organization)

## Four-Phase Test Structure

Every test should follow this clear structure with blank lines separating phases: Setup, Exercise, Verify, Teardown.

```python
def test_retries_failed_operations_three_times():
    attempts = []
    def operation():
        attempts.append(1)
        if len(attempts) < 3:
            raise ConnectionError("failed")
        return "success"

    result = retry_operation(operation)

    assert result == "success"
    assert len(attempts) == 3
```

**Setup:** Prepare test data and dependencies.

**Exercise:** Call the system under test.

**Verify:** Assert expected outcomes.

**Teardown:** Clean up resources (if needed).

Use blank lines to separate phases, not comments.

## SUT Naming Convention

The System Under Test should be named `sut` for easy identification.

```python
def test_validates_email_format():
    sut = EmailValidator()

    result = sut.validate("invalid-email")

    assert result.is_valid == False
```

If you cannot use `sut` (naming conflict, multiple SUTs), add a `# SUT` comment.

## FIRST Principles

### Fast

Tests run in milliseconds, not seconds.

**Violation:**
```python
def test_saves_to_database():
    db = RealDatabase()
    sut = UserRepository(db)

    sut.save(user)

    assert db.find(user.id) == user
```

**Solution:**
```python
def test_saves_to_database():
    db = FakeDatabase()
    sut = UserRepository(db)

    sut.save(user)

    assert db.find(user.id) == user
```

### Independent

Tests don't depend on each other or run order. No shared state.

**Violation:**
```python
shared_user = None

def test_creates_user():
    global shared_user
    shared_user = create_user()
    assert shared_user.id is not None

def test_updates_user():
    shared_user.name = "New Name"
    assert shared_user.name == "New Name"
```

**Solution:**
```python
def test_creates_user():
    sut = UserService()

    user = sut.create("John")

    assert user.id is not None

def test_updates_user():
    sut = UserService()
    user = sut.create("John")

    user.name = "New Name"

    assert user.name == "New Name"
```

### Repeatable

Run in any environment (local, CI, offline). No external dependencies.

**Violation:**
```python
def test_loads_config():
    sut = ConfigLoader()

    config = sut.load("/etc/app/config.json")

    assert config.api_key is not None
```

**Solution:**
```python
def test_loads_config():
    config_data = '{"api_key": "test-key"}'
    sut = ConfigLoader()

    config = sut.load_from_string(config_data)

    assert config.api_key == "test-key"
```

### Self-Validating

Pass/fail, no manual inspection needed.

**Violation:**
```python
def test_generates_report():
    sut = ReportGenerator()

    report = sut.generate(data)

    print(report)
```

**Solution:**
```python
def test_generates_report():
    sut = ReportGenerator()

    report = sut.generate(data)

    assert "Total: $1000" in report
    assert "Items: 5" in report
```

### Timely

Written just before production code (TDD practice).

## Test File Organization

### Keep It DRY with Fixtures

Extract repeated setup and teardown to fixtures.

```python
import pytest

@pytest.fixture
def email_validator():
    return EmailValidator()

def test_rejects_empty_email(email_validator):
    sut = email_validator

    result = sut.validate("")

    assert result.is_valid == False

def test_accepts_valid_email(email_validator):
    sut = email_validator

    result = sut.validate("user@example.com")

    assert result.is_valid == True
```

### Section Boundaries

Use visual section boundaries to organize tests by behavior category or workflow stage.

```python
# ============================================================================
# Input Validation Tests
# ============================================================================


def test_rejects_empty_email():
    sut = EmailValidator()

    result = sut.validate("")

    assert result.is_valid == False


def test_rejects_malformed_email():
    sut = EmailValidator()

    result = sut.validate("invalid")

    assert result.is_valid == False


# ============================================================================
# Happy Path Tests
# ============================================================================


def test_accepts_valid_email():
    sut = EmailValidator()

    result = sut.validate("user@example.com")

    assert result.is_valid == True
```

**Format:**
- Line 1 & 3: `# ` followed by 76 `=` characters
- Line 2: `# ` followed by descriptive section name in Title Case
- Two blank lines after closing boundary
- Two blank lines before next section boundary

**Organization strategies:**
- By behavior category: Happy path, edge cases, error handling
- By workflow stage: Input processing, business logic, output formatting
- By feature area: Different aspects of functionality

### When to Split Test Files

**Pattern 1: Testcase Class per Class (START HERE)**

One test class per production class.

```
tests/unit/
  test_person_search_service.py
  test_person_validator.py
```

**Pattern 2: Testcase Class per Feature (EVOLVE TO THIS)**

One test class per method/feature.

```
tests/unit/
  test_person_search_service_find_person_with_hints.py
  test_person_search_service_find_persons_by_name.py
```

**Pattern 3: Testcase Class per Fixture (ALTERNATIVE)**

One test class per test fixture/starting state.

```
tests/unit/
  test_person_search_service_with_empty_database.py
  test_person_search_service_with_existing_persons.py
```

Start with one file per class. Split when navigation becomes difficult.
