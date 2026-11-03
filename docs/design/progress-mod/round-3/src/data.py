"""Values taken from tests/smoke/recordings/. Times are seconds from the recording's start."""

NF_TASK = ("Add order_total(lines) to cart.py: it takes a list of (price, quantity) pairs and returns "
           "the sum of line_total(price, quantity) over them, so order_total([(10, 2), (4, 1)]) returns 30.0, "
           "which is 25.0 plus 5.0. One test for exactly that example is the whole scope")
BUG_TASK = ("Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90. "
            "Cover the edge cases too, such as 0 and 100 percent")
BUG_TASK_SHORT = "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90"

# t52-nf-6, new_feature, one test, with REFACTOR. (start, seconds, phase, role, label-tail)
NF6_SPAWNS = [
    (71.8, 3.863, "scenarios", "enumerate-scenarios-and-test-cases", "-"),
    (76.4, 2.836, "scenarios", "runner", "-"),
    (87.6, 2.963, "setup", "runner", "-"),
    (91.3, 9.808, "setup", "create-test-placeholders", "-"),
    (101.9, 3.111, "setup", "runner", "-"),
    (105.9, 16.328, "RED", "implement-tests", "order-total-example-sums-lines"),
    (123.0, 3.151, "RED", "runner", "order-total-example-sums-lines"),
    (128.3, 8.025, "GREEN", "implement-code", "order-total-example-sums-lines"),
    (138.2, 3.732, "GREEN", "runner", "order-total-example-sums-lines"),
    (142.8, 6.606, "REFACTOR", "identify-test-issues", "order-total-example-sums-lines"),
    (150.3, 9.170, "REFACTOR", "refactor-tests", "order-total-example-sums-lines"),
    (160.3, 3.053, "REFACTOR", "runner", "order-total-example-sums-lines"),
    (164.1, 6.771, "REFACTOR", "identify-code-issues", "order-total-example-sums-lines"),
    (171.6, 9.791, "REFACTOR", "refactor-code", "order-total-example-sums-lines"),
    (182.2, 3.322, "REFACTOR", "runner", "order-total-example-sums-lines"),
    (187.0, 5.437, "verify", "verify-test-coverage", "-"),
    (193.3, 3.035, "verify", "runner", "-"),
    (202.3, 3.355, "safety-net", "update-documentation", "-"),
    (206.4, 7.937, "safety-net", "runner", "-"),
]
NF6_COMMITS = [  # (ledger t, sha, step, message or None)
    (103.3, "7badf99", "placeholders", None),
    (124.6, "6b4b1f6", "red", None),
    (140.3, "e5e43a1", "green", "feat: Add order_total to sum line totals"),
    (161.8, "a30ee1d", "refactor", "test: Tidy order_total example test imports and names"),
    (183.8, "1e94ffb", "refactor", "refactor: Refactor line_total to name VAT multiplier and parameters"),
]
NF6_BASE = "6890fbb"

# probe-2, bug_fix, stop: step-failed after RED r1..r3 of zero-percent-keeps-full-price each ran green.
P2_SPAWNS = [
    (34.5, 5.813, "scenarios", "enumerate-scenarios-and-test-cases", "-"),
    (41.1, 2.780, "scenarios", "runner", "-"),
    (51.9, 2.620, "setup", "runner", "-"),
    (55.6, 11.456, "setup", "create-test-placeholders", "-"),
    (67.8, 2.941, "setup", "runner", "-"),
    (71.4, 7.942, "RED", "implement-tests", "ten-percent-off-hundred r1"),
    (80.2, 3.090, "RED", "runner", "ten-percent-off-hundred"),
    (84.2, 7.926, "GREEN", "implement-code", "ten-percent-off-hundred r1"),
    (92.9, 3.250, "GREEN", "runner", "ten-percent-off-hundred"),
    (97.1, 10.470, "RED", "implement-tests", "zero-percent-keeps-full-price r1"),
    (108.4, 3.167, "RED", "runner", "zero-percent-keeps-full-price"),
    (112.3, 8.702, "RED", "implement-tests", "zero-percent-keeps-full-price r2"),
    (121.8, 2.673, "RED", "runner", "zero-percent-keeps-full-price"),
    (125.9, 8.608, "RED", "implement-tests", "zero-percent-keeps-full-price r3"),
    (135.2, 2.607, "RED", "runner", "zero-percent-keeps-full-price"),
    (138.6, 2.579, "setup", "runner", "-"),
]
P2_STOP_T = 139.7
P2_STOP = "step-failed: a step of the stage failed past its retries, and a re-run continues from tests{}"


def mmss(t):
    t = int(round(t))
    return f"{t // 60}:{t % 60:02d}"


def secs(t):
    return f"{t:.1f}s"
