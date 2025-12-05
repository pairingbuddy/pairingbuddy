# Test Anti-Patterns

## Contents

- [Obscure Test](#obscure-test)
- [Eager Test](#eager-test)
- [Mystery Guest](#mystery-guest)
- [Conditional Test Logic](#conditional-test-logic)
- [Assertion Roulette](#assertion-roulette)
- [Fragile Test](#fragile-test)
- [Erratic Test](#erratic-test)
- [Slow Tests](#slow-tests)

## Obscure Test

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

## Eager Test

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

## Mystery Guest

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

## Conditional Test Logic

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

## Assertion Roulette

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

## Fragile Test

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

## Erratic Test

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

## Slow Tests

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
