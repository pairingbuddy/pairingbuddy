# Python & pytest Conventions

Python-specific testing patterns and pytest conventions.

## Contents

- [Placeholder Tests](#placeholder-tests)
- [Naming Conventions](#naming-conventions)
- [pytest Fixtures](#pytest-fixtures)
- [Parametrized Tests](#parametrized-tests)
- [Test Markers](#test-markers)
- [Directory Structure](#directory-structure)

## Placeholder Tests

Use `pytest.fail()` for placeholder tests that must be implemented:

```python
def test_calculates_order_total():
    pytest.fail("TODO: Implement test for order total calculation")
```

This ensures placeholder tests fail visibly until implemented.

## Naming Conventions

**Test files:** `test_*.py` or `*_test.py`

```
tests/
  test_calculator.py      # Preferred
  calculator_test.py      # Also valid
```

**Test functions:** `test_` prefix with descriptive name

```python
def test_adds_two_positive_numbers():
    ...

def test_rejects_invalid_email_format():
    ...
```

**Assertion messages:** Use f-strings for context

```python
assert result == expected, f"Expected {expected}, got {result}"
```

## pytest Fixtures

Create reusable setup with `@pytest.fixture`:

```python
import pytest

@pytest.fixture
def calculator():
    return Calculator()

def test_adds_numbers(calculator):
    sut = calculator

    result = sut.add(2, 3)

    assert result == 5
```

### Fixture Scopes

```python
@pytest.fixture(scope="function")  # Default: fresh for each test
def per_test_db():
    return InMemoryDatabase()

@pytest.fixture(scope="module")    # Shared across tests in file
def shared_config():
    return load_config()

@pytest.fixture(scope="session")   # Shared across entire test run
def expensive_resource():
    return create_expensive_thing()
```

## Parametrized Tests

Test multiple inputs with same logic:

```python
import pytest

@pytest.mark.parametrize("a,b,expected", [
    (2, 3, 5),
    (0, 0, 0),
    (-1, 1, 0),
])
def test_adds_numbers(a, b, expected):
    sut = Calculator()

    result = sut.add(a, b)

    assert result == expected
```

## Test Markers

Skip or mark tests conditionally:

```python
@pytest.mark.skip(reason="Not implemented yet")
def test_future_feature():
    ...

@pytest.mark.skipif(sys.platform == "win32", reason="Unix only")
def test_unix_specific():
    ...

@pytest.mark.slow
def test_integration():
    ...
```

Run specific markers: `pytest -m "not slow"`

## Directory Structure

```
project/
  src/
    calculator.py
  tests/
    __init__.py
    conftest.py           # Shared fixtures
    unit/
      test_calculator.py
    integration/
      test_api.py
```
