# API Design Examples

Full Python code demonstrating SOLID principles and Clean Code practices.

## Single Responsibility Principle

Before:
```python
class UserManager:
    def create_user(self, username, email, password):
        if not self._validate_email(email):
            raise ValueError("Invalid email")

        hashed = self._hash_password(password)
        user = User(username, email, hashed)
        self._save_to_database(user)
        self._send_welcome_email(email)
        return user

    def _validate_email(self, email):
        return "@" in email

    def _hash_password(self, password):
        return hash(password)

    def _save_to_database(self, user):
        pass

    def _send_welcome_email(self, email):
        pass
```

After:
```python
class UserRegistration:
    def __init__(self, validator, hasher, repository, notifier):
        self._validator = validator
        self._hasher = hasher
        self._repository = repository
        self._notifier = notifier

    def register(self, username, email, password):
        self._validator.validate_email(email)
        hashed = self._hasher.hash_password(password)
        user = User(username, email, hashed)
        self._repository.save(user)
        self._notifier.send_welcome_email(email)
        return user


class EmailValidator:
    def validate_email(self, email):
        if "@" not in email:
            raise ValueError("Invalid email")


class PasswordHasher:
    def hash_password(self, password):
        return hash(password)


class UserRepository:
    def save(self, user):
        pass


class EmailNotifier:
    def send_welcome_email(self, email):
        pass
```

## Open/Closed Principle

Before:
```python
class PaymentProcessor:
    def process(self, payment_type, amount):
        if payment_type == "credit_card":
            return self._process_credit_card(amount)
        elif payment_type == "paypal":
            return self._process_paypal(amount)
        elif payment_type == "bitcoin":
            return self._process_bitcoin(amount)
        else:
            raise ValueError("Unknown payment type")

    def _process_credit_card(self, amount):
        pass

    def _process_paypal(self, amount):
        pass

    def _process_bitcoin(self, amount):
        pass
```

After:
```python
class PaymentMethod:
    def process(self, amount):
        raise NotImplementedError


class CreditCardPayment(PaymentMethod):
    def process(self, amount):
        pass


class PayPalPayment(PaymentMethod):
    def process(self, amount):
        pass


class BitcoinPayment(PaymentMethod):
    def process(self, amount):
        pass


class PaymentProcessor:
    def __init__(self, payment_method):
        self._payment_method = payment_method

    def process(self, amount):
        return self._payment_method.process(amount)
```

## Liskov Substitution Principle

Before:
```python
class Rectangle:
    def __init__(self, width, height):
        self.width = width
        self.height = height

    def set_width(self, width):
        self.width = width

    def set_height(self, height):
        self.height = height

    def area(self):
        return self.width * self.height


class Square(Rectangle):
    def set_width(self, width):
        self.width = width
        self.height = width

    def set_height(self, height):
        self.width = height
        self.height = height
```

After:
```python
class Shape:
    def area(self):
        raise NotImplementedError


class Rectangle(Shape):
    def __init__(self, width, height):
        self._width = width
        self._height = height

    def area(self):
        return self._width * self._height


class Square(Shape):
    def __init__(self, side):
        self._side = side

    def area(self):
        return self._side * self._side
```

## Interface Segregation Principle

Before:
```python
class Worker:
    def work(self):
        raise NotImplementedError

    def eat(self):
        raise NotImplementedError

    def sleep(self):
        raise NotImplementedError


class Human(Worker):
    def work(self):
        pass

    def eat(self):
        pass

    def sleep(self):
        pass


class Robot(Worker):
    def work(self):
        pass

    def eat(self):
        raise NotImplementedError

    def sleep(self):
        raise NotImplementedError
```

After:
```python
class Workable:
    def work(self):
        raise NotImplementedError


class Eatable:
    def eat(self):
        raise NotImplementedError


class Sleepable:
    def sleep(self):
        raise NotImplementedError


class Human(Workable, Eatable, Sleepable):
    def work(self):
        pass

    def eat(self):
        pass

    def sleep(self):
        pass


class Robot(Workable):
    def work(self):
        pass
```

## Dependency Inversion Principle

Before:
```python
class EmailService:
    def send(self, message):
        pass


class Notification:
    def __init__(self):
        self._email_service = EmailService()

    def notify(self, message):
        self._email_service.send(message)
```

After:
```python
class MessageSender:
    def send(self, message):
        raise NotImplementedError


class EmailService(MessageSender):
    def send(self, message):
        pass


class SMSService(MessageSender):
    def send(self, message):
        pass


class Notification:
    def __init__(self, sender):
        self._sender = sender

    def notify(self, message):
        self._sender.send(message)
```

## Clean Code: Minimal Implementation

```python
def calculate_discount(price, discount_percent):
    return price * (discount_percent / 100)


def apply_discount(price, discount_percent):
    discount = calculate_discount(price, discount_percent)
    return price - discount
```

## Clean Code: Descriptive Names

Before:
```python
def calc(p, d):
    return p - (p * d / 100)
```

After:
```python
def calculate_discounted_price(original_price, discount_percent):
    discount_amount = original_price * (discount_percent / 100)
    return original_price - discount_amount
```

## Clean Code: Error Handling

```python
class InvalidEmailError(Exception):
    pass


class EmailValidator:
    def validate(self, email):
        if not email:
            raise InvalidEmailError("Email cannot be empty")
        if "@" not in email:
            raise InvalidEmailError("Email must contain @")
        if "." not in email.split("@")[1]:
            raise InvalidEmailError("Email must have valid domain")
```
