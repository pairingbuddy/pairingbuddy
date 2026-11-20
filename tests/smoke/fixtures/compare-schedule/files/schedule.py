"""Times of day as minutes since midnight, and bookings as (start, end) pairs of "HH:MM" strings."""


def parse_time(text):
    """Minutes since midnight for an "HH:MM" string."""
    hours, minutes = text.split(":")
    return int(hours) * 60 + int(minutes)


def format_time(minutes):
    """The "HH:MM" string for minutes since midnight."""
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def duration(booking):
    """Length of a booking in minutes."""
    start, end = booking
    return parse_time(end) - parse_time(start)


def overlaps(a, b):
    """Whether two bookings share any minute. Bookings that only touch do not overlap."""
    return parse_time(a[0]) < parse_time(b[1]) and parse_time(b[0]) < parse_time(a[1])
