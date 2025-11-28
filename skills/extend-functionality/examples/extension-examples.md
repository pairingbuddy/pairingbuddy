# Extension Examples

Full Python code demonstrating how to extend existing functionality while maintaining consistency.

## Extending Validation Rules

```python
# ============================================================================
# Existing Tests (for understanding patterns)
# ============================================================================


def test_validates_email_format():
    sut = Validator()

    result = sut.validate_email("user@example.com")

    assert result is True


def test_rejects_invalid_email():
    sut = Validator()

    result = sut.validate_email("invalid")

    assert result is False


# ============================================================================
# Extension: Add Phone Validation
# ============================================================================


def test_validates_phone_format():
    sut = Validator()

    result = sut.validate_phone("555-1234")

    assert result is True


def test_rejects_invalid_phone():
    sut = Validator()

    result = sut.validate_phone("abc")

    assert result is False


def test_validates_international_phone():
    sut = Validator()

    result = sut.validate_phone("+1-555-1234")

    assert result is True
```

## Adding New Method to Existing Class

```python
# ============================================================================
# Existing Tests
# ============================================================================


def test_calculates_sum():
    sut = Calculator()

    result = sut.sum([1, 2, 3])

    assert result == 6


def test_calculates_average():
    sut = Calculator()

    result = sut.average([2, 4, 6])

    assert result == 4


# ============================================================================
# Extension: Add Median Calculation
# ============================================================================


def test_calculates_median_odd_count():
    sut = Calculator()

    result = sut.median([1, 3, 5])

    assert result == 3


def test_calculates_median_even_count():
    sut = Calculator()

    result = sut.median([1, 2, 3, 4])

    assert result == 2.5


def test_median_handles_single_value():
    sut = Calculator()

    result = sut.median([42])

    assert result == 42
```

## Extending with New Subclass

```python
# ============================================================================
# Existing Tests
# ============================================================================


def test_processes_text_file():
    sut = TextFileProcessor()

    result = sut.process("file.txt")

    assert result.format == "text"


def test_processes_csv_file():
    sut = CSVFileProcessor()

    result = sut.process("data.csv")

    assert result.format == "csv"


# ============================================================================
# Extension: Add JSON File Processor
# ============================================================================


def test_processes_json_file():
    sut = JSONFileProcessor()

    result = sut.process("data.json")

    assert result.format == "json"


def test_json_parses_array():
    sut = JSONFileProcessor()

    result = sut.process('["a", "b", "c"]')

    assert len(result.data) == 3


def test_json_parses_object():
    sut = JSONFileProcessor()

    result = sut.process('{"key": "value"}')

    assert result.data["key"] == "value"
```

## Matching Existing Error Handling Pattern

```python
# ============================================================================
# Existing Tests
# ============================================================================


def test_raises_value_error_for_negative():
    sut = Processor()

    with pytest.raises(ValueError, match="Cannot be negative"):
        sut.process(-1)


def test_raises_value_error_for_zero():
    sut = Processor()

    with pytest.raises(ValueError, match="Cannot be zero"):
        sut.process(0)


# ============================================================================
# Extension: Add Range Validation
# ============================================================================


def test_raises_value_error_above_maximum():
    sut = Processor()

    with pytest.raises(ValueError, match="Exceeds maximum"):
        sut.process(1001)


def test_raises_value_error_below_minimum():
    sut = Processor()

    with pytest.raises(ValueError, match="Below minimum"):
        sut.process(-1)
```
