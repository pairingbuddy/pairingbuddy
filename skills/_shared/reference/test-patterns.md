# Test Patterns

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

## F.I.R.S.T. Principles

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

## Common Test Anti-Patterns

### Obscure Test

Hard to understand what's being tested.

**Violation:**
```python
def test_process():
    assert process(get_data(setup_thing())) == calc()
```

**Solution:**
```python
def test_processes_valid_order_successfully():
    order = create_valid_order(item="laptop", quantity=1)
    sut = OrderProcessor()

    result = sut.process(order)

    assert result.status == "completed"
```

### Eager Test

Tests multiple behaviors in one test.

**Violation:**
```python
def test_order_processing():
    sut = OrderProcessor()

    result1 = sut.validate(order)
    assert result1 == True

    result2 = sut.process(order)
    assert result2.status == "completed"

    result3 = sut.send_confirmation(order)
    assert result3 == True
```

Split into separate tests, one behavior per test.

### Mystery Guest

Test depends on external data (files, database).

**Violation:**
```python
def test_loads_user():
    sut = UserLoader()

    user = sut.load_from_file("test_user.json")

    assert user.name == "John"
```

**Solution:**
```python
def test_loads_user():
    user_data = '{"name": "John", "age": 30}'
    sut = UserLoader()

    user = sut.load_from_string(user_data)

    assert user.name == "John"
```

### Conditional Test Logic

if/for/while statements in test code.

**Violation:**
```python
def test_validates_emails():
    emails = ["valid@example.com", "invalid", "another@example.com"]
    sut = EmailValidator()

    for email in emails:
        result = sut.validate(email)
        if "@" in email:
            assert result.is_valid == True
```

Enumerate test cases explicitly, one test per case.

### Assertion Roulette

Can't tell which assertion failed.

**Violation:**
```python
def test_order_totals():
    sut = OrderCalculator()

    assert sut.calculate(order1) == 100
    assert sut.calculate(order2) == 200
    assert sut.calculate(order3) == 300
```

**Solution:**
```python
def test_calculates_order_with_single_item():
    sut = OrderCalculator()
    order = create_order(items=[{"price": 100}])

    result = sut.calculate(order)

    assert result == 100, f"Expected 100, got {result}"

def test_calculates_order_with_multiple_items():
    sut = OrderCalculator()
    order = create_order(items=[{"price": 100}, {"price": 100}])

    result = sut.calculate(order)

    assert result == 200, f"Expected 200, got {result}"
```

### Fragile Test

Breaks from unrelated changes. Tests internal implementation instead of behavior.

**Violation:**
```python
def test_caches_results():
    sut = DataProcessor()

    sut.process(data)

    assert sut._cache_size == 1
```

**Solution:**
```python
def test_returns_same_result_for_duplicate_requests():
    sut = DataProcessor()

    result1 = sut.process(data)
    result2 = sut.process(data)

    assert result1 == result2
```

### Erratic Test

Passes and fails non-deterministically.

**Causes:**
- Shared state between tests
- Timing dependencies
- Random values
- External systems

**Solution:**
- Use fresh fixtures
- Eliminate shared state
- Use deterministic values (never random)
- Mock external systems

### Slow Tests

Tests take too long to run.

**Causes:**
- Database access
- File I/O
- Network calls
- Asynchronous code with delays

**Solution:**
- Replace with test doubles (fakes, stubs)
- Use in-memory databases
- Use synchronous testing

## Test Smells Quick Check

**Clarity:**
- Clear at a glance? (no Obscure Test)
- Tests ONE thing? (no Eager Test)
- All data visible? (no Mystery Guest)
- No if/for/while? (no Conditional Test Logic)
- No copy-paste code? (no Test Code Duplication)

**Reliability:**
- Assertions have messages? (no Assertion Roulette)
- Won't break from unrelated changes? (no Fragile Test)
- Deterministic? (no Erratic Test)
- Fast? (no Slow Tests)

**Coverage:**
- Has assertions? (no Missing Assertions)
- Exercises new code? (no Untested Code)
- No test-only production code? (no Test Logic in Production)
