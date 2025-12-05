# Refactoring Reference

## Contents

- [Code Smells](#code-smells)
- [Refactoring Techniques](#refactoring-techniques)
- [When to Apply](#when-to-apply)

## Code Smells

### God Object (violates SRP)

Class does too many things.

**Smell:**
```python
class Application:
    def validate_input(self): pass
    def process_payment(self): pass
    def save_to_database(self): pass
    def send_email(self): pass
    def generate_report(self): pass
```

**Fix:** Extract separate classes with focused responsibilities.

### Hardcoded Dependencies (violates DIP)

Class creates its own dependencies instead of receiving them.

**Smell:**
```python
class OrderService:
    def __init__(self):
        self.db = PostgresDatabase()
        self.email = SmtpEmailService()
```

**Fix:** Inject dependencies via constructor.

```python
class OrderService:
    def __init__(self, db, email):
        self.db = db
        self.email = email
```

### Type Discrimination (violates OCP)

Using if/else chains based on type instead of polymorphism.

**Smell:**
```python
def process_payment(payment_type, amount):
    if payment_type == "credit_card":
        process_credit_card(amount)
    elif payment_type == "paypal":
        process_paypal(amount)
```

**Fix:** Use polymorphism with gateway interfaces.

```python
class PaymentProcessor:
    def __init__(self, gateway):
        self.gateway = gateway

    def process(self, amount):
        return self.gateway.charge(amount)
```

### Long Method

Method does too much, hard to understand.

**Smell:** Method > 20 lines, multiple levels of abstraction.

**Fix:** Extract Method - pull out cohesive chunks into named methods.

```python
# Before
def process_order(order):
    # validate (10 lines)
    # calculate total (10 lines)
    # charge payment (10 lines)
    # save to db (10 lines)
    # send email (10 lines)

# After
def process_order(order):
    validate_order(order)
    total = calculate_total(order)
    charge_payment(order, total)
    save_order(order)
    send_confirmation(order)
```

### Long Parameter List

Method takes too many parameters.

**Smell:**
```python
def create_user(name, email, phone, address, city, state, zip_code, country):
    ...
```

**Fix:** Introduce Parameter Object.

```python
@dataclass
class UserInfo:
    name: str
    email: str
    phone: str
    address: Address

def create_user(user_info: UserInfo):
    ...
```

### Feature Envy

Method uses another object's data more than its own.

**Smell:**
```python
class OrderPrinter:
    def print_total(self, order):
        total = 0
        for item in order.items:
            total += item.price * item.quantity
        total -= order.discount
        total += order.tax
        return total
```

**Fix:** Move method to the class whose data it uses.

```python
class Order:
    def calculate_total(self):
        total = sum(item.price * item.quantity for item in self.items)
        return total - self.discount + self.tax
```

### Data Clumps

Same fields appear together in multiple places.

**Smell:**
```python
def create_address(street, city, state, zip_code): ...
def validate_address(street, city, state, zip_code): ...
def format_address(street, city, state, zip_code): ...
```

**Fix:** Extract class.

```python
@dataclass
class Address:
    street: str
    city: str
    state: str
    zip_code: str

def create_address(address: Address): ...
def validate_address(address: Address): ...
def format_address(address: Address): ...
```

## Refactoring Techniques

### Extract Method

Pull cohesive code into a named method.

```python
# Before
def process(data):
    # first chunk of logic
    x = data.value * 2
    y = x + data.offset
    result = y / data.scale

    # second chunk of logic
    ...

# After
def process(data):
    result = calculate_normalized_value(data)
    ...

def calculate_normalized_value(data):
    x = data.value * 2
    y = x + data.offset
    return y / data.scale
```

### Extract Class

Move related fields and methods into a new class.

### Inline Method

Replace method call with method body (reverse of Extract Method).

Use when: Method body is as clear as the name.

### Rename

Change name to better express intent.

Most common and most valuable refactoring.

### Move Method/Field

Move to the class that uses it most.

### Replace Conditional with Polymorphism

Replace if/else type checks with polymorphic classes.

## When to Apply

### During TDD

Refactor in the REFACTOR phase:
1. Tests are GREEN
2. Make one small refactoring
3. Run tests
4. Repeat or move to next RED

### Before Adding Features

"Make the change easy, then make the easy change."

1. Refactor code to make new feature easy to add
2. Commit the refactoring
3. Add the feature
4. Commit the feature

### When You See Duplication

If you're about to copy-paste:
1. Stop
2. Extract the common code
3. Call it from both places

### When You Don't Understand

If code is confusing:
1. Add tests for current behavior
2. Refactor for clarity
3. Keep tests passing
