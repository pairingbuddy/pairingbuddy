# Test Structure Examples

Full Python code demonstrating four-phase test structure and F.I.R.S.T. principles.

## Four-Phase Test Structure

```python
def test_add_returns_sum_of_two_numbers():
    sut = Calculator()

    result = sut.add(2, 3)

    assert result == 5


def test_divide_raises_error_for_zero_divisor():
    sut = Calculator()

    with pytest.raises(ZeroDivisionError):
        sut.divide(10, 0)


def test_cache_stores_and_retrieves_value():
    sut = Cache()

    sut.set("key", "value")
    result = sut.get("key")

    assert result == "value"


def test_database_connection_closes_after_query():
    sut = Database()
    sut.connect()

    sut.query("SELECT * FROM users")
    sut.close()

    assert sut.is_closed() is True
```

## Fast Tests

```python
def test_validates_email_format():
    sut = EmailValidator()

    result = sut.validate("user@example.com")

    assert result is True


def test_calculates_tax():
    sut = TaxCalculator()

    result = sut.calculate(100, 0.2)

    assert result == 20
```

## Independent Tests

```python
def test_creates_user():
    repository = InMemoryUserRepository()
    sut = UserService(repository)

    user = sut.create_user("alice", "alice@example.com")

    assert user.username == "alice"


def test_finds_user_by_email():
    repository = InMemoryUserRepository()
    sut = UserService(repository)
    sut.create_user("bob", "bob@example.com")

    user = sut.find_by_email("bob@example.com")

    assert user.username == "bob"
```

## Repeatable Tests

```python
def test_sorts_list_in_ascending_order():
    sut = Sorter()
    input_list = [3, 1, 2]

    result = sut.sort(input_list)

    assert result == [1, 2, 3]


def test_generates_random_with_seed():
    sut = RandomGenerator(seed=42)

    result1 = sut.next()
    sut = RandomGenerator(seed=42)
    result2 = sut.next()

    assert result1 == result2
```

## Self-Validating Tests

```python
def test_parses_json_successfully():
    sut = JsonParser()

    result = sut.parse('{"name": "Alice"}')

    assert result["name"] == "Alice"


def test_rejects_invalid_json():
    sut = JsonParser()

    with pytest.raises(ValueError):
        sut.parse("{invalid json}")
```

## Test Fixtures

```python
@pytest.fixture
def calculator():
    return Calculator()


@pytest.fixture
def populated_cache():
    cache = Cache()
    cache.set("key1", "value1")
    cache.set("key2", "value2")
    return cache


def test_uses_calculator_fixture(calculator):
    result = calculator.add(5, 7)

    assert result == 12


def test_uses_populated_cache(populated_cache):
    result = populated_cache.get("key1")

    assert result == "value1"
```

## Parameterized Tests

```python
@pytest.mark.parametrize("input_email,expected", [
    ("user@example.com", True),
    ("user@subdomain.example.com", True),
    ("user+tag@example.com", True),
    ("invalid", False),
    ("@example.com", False),
    ("user@", False),
])
def test_email_validation(input_email, expected):
    sut = EmailValidator()

    result = sut.validate(input_email)

    assert result == expected


@pytest.mark.parametrize("amount,discount,expected", [
    (100, 10, 90),
    (200, 25, 150),
    (50, 0, 50),
])
def test_discount_calculation(amount, discount, expected):
    sut = PriceCalculator()

    result = sut.apply_discount(amount, discount)

    assert result == expected
```

## Test Doubles

```python
class FakeEmailSender:
    def __init__(self):
        self.sent_emails = []

    def send(self, to, subject, body):
        self.sent_emails.append({"to": to, "subject": subject, "body": body})


def test_sends_welcome_email():
    email_sender = FakeEmailSender()
    sut = UserRegistration(email_sender)

    sut.register("alice", "alice@example.com", "password123")

    assert len(email_sender.sent_emails) == 1
    assert email_sender.sent_emails[0]["to"] == "alice@example.com"
    assert "welcome" in email_sender.sent_emails[0]["subject"].lower()


class StubUserRepository:
    def find_by_username(self, username):
        if username == "existing":
            return User("existing", "existing@example.com")
        return None


def test_rejects_duplicate_username():
    repository = StubUserRepository()
    sut = UserService(repository)

    with pytest.raises(ValueError, match="Username already exists"):
        sut.create_user("existing", "new@example.com")
```
