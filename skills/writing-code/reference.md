# Code Patterns Reference

## Contents

- [SOLID Principles](#solid-principles)
- [Clean Code Practices](#clean-code-practices)
- [Minimal Code Approach](#minimal-code-approach)
- [Simple Design](#simple-design)

## SOLID Principles

### Single Responsibility Principle (SRP)

Each class should have ONE reason to change.

**Violation:**
```python
class OrderProcessor:
    def process(self, order):
        if not order.email:
            raise ValueError("Invalid email")
        stripe.charge(order.amount)
        db.save(order)
        send_email(order.email, "Order confirmed")
```

**Solution:**
```python
class OrderProcessor:
    def __init__(self, validator, payment, repository, notifications):
        self.validator = validator
        self.payment = payment
        self.repository = repository
        self.notifications = notifications

    def process(self, order):
        self.validator.validate(order)
        self.payment.charge(order.amount)
        self.repository.save(order)
        self.notifications.send_confirmation(order)
```

### Dependency Inversion Principle (DIP)

Design with interfaces/abstractions, not concrete implementations. Inject dependencies, don't hardcode them.

**Violation:**
```python
class PaymentProcessor:
    def process(self, payment):
        stripe = Stripe('sk_test_...')
        return stripe.charge(payment)
```

**Solution:**
```python
class PaymentProcessor:
    def __init__(self, gateway):
        self.gateway = gateway

    def process(self, payment):
        return self.gateway.charge(payment)
```

### Open/Closed Principle (OCP)

Design APIs that can be extended without modification. Prefer polymorphism over if/else for different types.

**Violation:**
```python
class PaymentProcessor:
    def process(self, payment):
        if payment.type == "stripe":
            return process_stripe(payment)
        elif payment.type == "paypal":
            return process_paypal(payment)
```

**Solution:**
```python
class PaymentProcessor:
    def __init__(self, gateway):
        self.gateway = gateway

    def process(self, payment):
        return self.gateway.charge(payment)
```

### Interface Segregation Principle (ISP)

Design focused interfaces - don't force classes to implement methods they don't need.

**Violation:**
```python
class PaymentGateway:
    def charge(self, payment): pass
    def refund(self, transaction_id): pass
    def subscribe(self, plan): pass
```

**Solution:**
```python
class PaymentGateway:
    def charge(self, payment): pass

class RefundableGateway:
    def refund(self, transaction_id): pass

class SubscriptionGateway:
    def subscribe(self, plan): pass
```

### Liskov Substitution Principle (LSP)

Subtypes must be substitutable for their base types. If a subclass throws exceptions for inherited methods or changes expected behavior, redesign the hierarchy.

**Violation:**
```python
class PaymentGateway:
    def refund(self, transaction_id): pass

class NonRefundableGateway(PaymentGateway):
    def refund(self, transaction_id):
        raise NotImplementedError("Refunds not supported")
```

**Solution:**
```python
class PaymentGateway:
    def charge(self, payment): pass

class RefundableGateway(PaymentGateway):
    def refund(self, transaction_id): pass
```

## Clean Code Practices

### Meaningful Names

**Intention-revealing:** Name tells you why it exists and what it does.

**Violation:**
```python
class Manager:
    def do_stuff(self, data): pass
    def handle_thing(self, x): pass
```

**Solution:**
```python
class OrderValidator:
    def validate_customer_information(self, order): pass
    def validate_payment_details(self, order): pass
```

**Class names are nouns:** `PaymentProcessor`, `OrderValidator`

**Method names are verbs:** `process()`, `validate()`, `send()`

**Pick one word per concept:** Don't mix `fetch`, `retrieve`, `get` for same thing.

### Function Design

**Small:** 20 lines or less ideally.

**Do one thing:** Single purpose at one level of abstraction.

**Few arguments:** Ideal: 0-1, Good: 2, Avoid: 3+

**Violation:**
```python
def process_order(order_id, customer_id, items, shipping_address,
                  billing_address, payment_method, discount_code):
    if not order_id:
        raise ValueError("Invalid order")
    total = sum(item.price for item in items)
    discount = lookup_discount(discount_code) if discount_code else 0
    final_total = total - discount
    stripe.charge(payment_method, final_total)
    db.save({"order_id": order_id, "total": final_total})
```

**Solution:**
```python
def process_order(order):
    validate_order(order)
    charge_payment(order)
    save_order(order)
    send_confirmation(order)

def validate_order(order):
    if not order.id:
        raise ValueError("Invalid order")

def charge_payment(order):
    total = calculate_total(order)
    gateway.charge(order.payment_method, total)
```

### Error Handling

**Use exceptions, not error codes:**

**Violation:**
```python
def find_user(id):
    user = database.find_by_id(id)
    if not user:
        return None
    return user

def process_user(user):
    if user is None:
        return -1
```

**Solution:**
```python
def find_user(id):
    user = database.find_by_id(id)
    if not user:
        raise UserNotFoundError(id)
    return user

def find_user_optional(id):
    return database.find_by_id(id)
```

**Don't return null:** Throw exception, return Optional, or use Null Object pattern.

**Don't pass null:** Validate at boundary, throw if null.

### Law of Demeter

**Talk to friends, not strangers:** Avoid chains like `a.get_b().get_c().do_something()`.

**Violation:**
```python
total = order.get_items().get_cart().get_discount().calculate()

if user.get_account().get_settings().get_notifications().is_enabled():
    send_notification()
```

**Solution:**
```python
class Order:
    def calculate_total(self):
        return self.items.calculate_items_total()
```

## Minimal Code Approach

The Lazy Programmer: Only implement what the assertions explicitly check.

**Not:**
- What makes logical sense
- What you know you'll need later
- What the "real" implementation should do

**Only:**
- What makes the assertion pass
- Literally hardcode values if that passes the test
- Next test will force real logic

**Example:**
```python
def test_adds_two_numbers():
    sut = Calculator()

    result = sut.add(2, 3)

    assert result == 5

class Calculator:
    def add(self, a, b):
        return 5  # Hardcode passes first test!

def test_adds_different_numbers():
    sut = Calculator()

    result = sut.add(10, 20)

    assert result == 30

class Calculator:
    def add(self, a, b):
        return a + b  # Now forced to implement real logic
```

If hardcoding passes the test, the test is incomplete or you need one more test.

## Simple Design

Kent Beck's 4 Rules of Simple Design (in priority order):

1. **Runs all the tests** - Correct behavior is non-negotiable
2. **Contains no duplication** - DRY principle
3. **Expresses intent clearly** - Readable, self-documenting
4. **Minimizes classes and methods** - No unnecessary complexity

### SOLID vs Minimal Code

Minimal code does NOT mean violating SOLID.

"Keep it simple" does NOT mean:
- Putting everything in one class (violates SRP)
- Hardcoding dependencies (violates DIP)
- Using if/else for polymorphism (violates OCP)
- Fat interfaces (violates ISP)

Minimal code following SOLID means:
- Implement only what tests require
- Follow SOLID structure while doing so
- Don't add features beyond tests
- Don't over-engineer

**When SOLID Applies:**
- Classes and objects (always)
- External dependencies (database, email, APIs, file system - always)
- Business logic (always separate concerns)
- Multiple implementations exist or likely (use interfaces)

**When SOLID Less Relevant:**
- Pure functions with no dependencies (focus on SRP only)
- Internal helpers (can skip interfaces if truly internal and never mocked)
