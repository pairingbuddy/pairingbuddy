from schedule import duration, format_time, overlaps, parse_time


def test_parse_time_counts_minutes_since_midnight():
    assert parse_time("09:30") == 570


def test_format_time_pads_hours_and_minutes():
    assert format_time(65) == "01:05"


def test_duration_is_end_minus_start():
    assert duration(("10:00", "11:15")) == 75


def test_touching_bookings_do_not_overlap():
    assert not overlaps(("10:00", "11:00"), ("11:00", "12:00"))
