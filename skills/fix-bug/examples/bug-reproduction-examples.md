# Bug Reproduction Examples

Full Python code demonstrating bug reproduction patterns.

## Off-by-One Error

```python
def test_reproduces_off_by_one_at_upper_bound():
    sut = RangeValidator(min_value=0, max_value=10)

    result = sut.is_valid(10)

    assert result is True


def test_reproduces_off_by_one_at_lower_bound():
    sut = RangeValidator(min_value=0, max_value=10)

    result = sut.is_valid(0)

    assert result is True
```

## Missing Null/None Check

```python
def test_reproduces_crash_on_none_input():
    sut = DataProcessor()

    with pytest.raises(AttributeError):
        sut.process(None)
```

## State Leakage Between Calls

```python
def test_reproduces_state_leakage():
    sut = Counter()

    sut.count([1, 2, 3])
    result = sut.count([4, 5])

    assert result == 2
```

## Empty Collection Handling

```python
def test_reproduces_crash_on_empty_list():
    sut = ListProcessor()

    with pytest.raises(IndexError):
        sut.process([])
```

## Type Confusion

```python
def test_reproduces_wrong_type_accepted():
    sut = NumberCalculator()

    result = sut.add("5", "3")

    assert result == "53"
```

## Boundary Condition Miss

```python
def test_reproduces_failure_at_max_capacity():
    sut = BoundedQueue(capacity=3)
    sut.enqueue("a")
    sut.enqueue("b")
    sut.enqueue("c")

    with pytest.raises(OverflowError):
        sut.enqueue("d")
```

## Enumeration of Related Scenarios

```python
# ============================================================================
# Reproduction Test
# ============================================================================


def test_reproduces_division_by_zero():
    sut = Calculator()

    with pytest.raises(ZeroDivisionError):
        sut.divide(10, 0)


# ============================================================================
# Related Scenarios
# ============================================================================


def test_related_negative_divisor():
    sut = Calculator()

    result = sut.divide(10, -2)

    assert result == -5


def test_related_float_division():
    sut = Calculator()

    result = sut.divide(10, 3)

    assert result == pytest.approx(3.333, rel=1e-3)


def test_related_zero_dividend():
    sut = Calculator()

    result = sut.divide(0, 5)

    assert result == 0
```
