"""Round 2, direction A (instrument panel), reworked from the round-1 feedback.

Run: python3 src/mocks.py <outdir> [name-filter ...]
"""
import os
import subprocess
import sys

from lib import Screen, page
from cc import TW, WIDE_ROWS, transcript, spinner, prompt, wrap
from data import NF_TASK, BUG_TASK

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
ROWS = WIDE_ROWS


# ------------------------------------------------------------------ transcripts (real names and durations)
T_G1_HEAD = [
    ("user", "/pairingbuddy:code " + BUG_TASK),
    ("tool", "Skill", "pairingbuddy:coding", "Successfully loaded skill", "ok"),
    ("tool", "pairingbuddy:curate-guidance", "Curate human guidance", "Done (6.0s)", "ok"),
    ("tool", "pairingbuddy:classify-task", "Classify the task", "Done (5.4s)", "ok"),
    ("tool", "Workflow", "pairingbuddy:code-scenarios", "Done · 2 agents · 10.5s", "ok"),
]
T_G1_RUN = T_G1_HEAD + [
    ("tool", "Workflow", "pairingbuddy:code-tdd",
     ["implement-tests: pb1 code-tdd RED implement-tests", "zero-percent-original-price r1"], "run"),
]
T_G1_NET = T_G1_HEAD + [
    ("tool", "Workflow", "pairingbuddy:code-tdd", "Done · 14 agents · 1m 34s", "ok"),
    ("tool", "Workflow", "pairingbuddy:code-safety-net",
     ["lens: pb1 code-safety-net - lens corpus-misalignment - r1"], "run"),
]
T_NF6_GREEN = [
    ("user", "/pairingbuddy:code " + NF_TASK),
    ("tool", "Skill", "pairingbuddy:coding", "Successfully loaded skill", "ok"),
    ("tool", "pairingbuddy:curate-guidance", "Curate human guidance before task", "Done (25.7s)", "ok"),
    ("tool", "pairingbuddy:classify-task", "Classify the coding task", "Done (8.1s)", "ok"),
    ("tool", "Workflow", "pairingbuddy:code-scenarios", "Done · 2 agents · 8.2s", "ok"),
    ("tool", "Workflow", "pairingbuddy:code-tdd",
     ["implement-code: pb1 code-tdd GREEN implement-code", "order-total-example-sums-lines r1"], "run"),
]
T_E1_NH = [
    ("user", "/pairingbuddy:code " + BUG_TASK),
    ("tool", "Skill", "pairingbuddy:coding", "Successfully loaded skill", "ok"),
    ("tool", "pairingbuddy:curate-guidance", "Curate human guidance from prior session", "Done (7.4s)", "ok"),
    ("tool", "pairingbuddy:classify-task", "Classify discount bug task", "Done (7.1s)", "ok"),
    ("tool", "Workflow", "pairingbuddy:code-scenarios", "Done · 2 agents · 14.3s", "ok"),
    ("tool", "Workflow", "pairingbuddy:code-tdd", "Done · 14 agents · 1m 37s", "ok"),
    ("tool", "Workflow", "pairingbuddy:code-safety-net", "Done · 2 agents · 13.3s", "ok"),
    ("say", "G:task-end is held for you. Two implement-tests returns carry an open ambiguity: "
            "hundred-percent-makes-free and non-round-result. Shall I read them out?"),
]

# invented plan (no recording has one); task 3 is the real t52-nf-6 task
PLAN = [
    "line_total with VAT", "VAT rate read from settings", "order_total sums line totals",
    "Discount on the whole order", "Discount code lookup", "Free shipping over a threshold",
    "Shipping by weight band", "Round totals to cents", "Currency formatting at checkout",
    "Checkout summary endpoint", "Reject an empty cart at checkout", "Receipt line items",
]


# ------------------------------------------------------------------ frame
class P:
    """the pane body: first column x, width w"""

    def __init__(self, x, w):
        self.x, self.w, self.end = x, w, x + w


def screen(entries, pane_w=109, spin=None):
    cols = TW + 2 + pane_w + 1
    s = Screen(cols, ROWS)
    p = P(TW + 2, pane_w)
    for r in range(ROWS):
        s.put(r, TW, "│", "faint")
    s.put(0, p.x, "Pairing Buddy", "b")
    s.rput(0, cols - 1, "✕", "dim")
    s.put(1, p.x, "─" * p.w, "faint")
    transcript(s, 1, TW - 2, entries, top=0)
    if spin:
        spinner(s, ROWS - 6, 1, *spin)
    prompt(s, ROWS - 4, 1, TW - 2)
    return s, p


def button(s, r, c, key, label):
    return s.seq(r, c, [(" " + key, "bg-sel claude b"), (" " + label + " ", "bg-sel fg")])


def status(s, p, glyph, word, where, elapsed, needs=("no", "ok b"), note="", tone="sel", pre=None):
    bg = "bg-" + tone
    s.fill(2, p.x, p.w, " ", bg)
    wst = {"sel": "claude", "warnbg": "warn"}[tone]
    c = s.seq(2, p.x, [(f" {glyph} {word} ", f"{bg} {wst} b"), (" ", bg)])
    if pre:
        c = s.seq(2, c, [(pre, f"{bg} b mu"), (" · ", f"{bg} b")])
    s.put(2, c, where, f"{bg} b")
    s.rseq(2, p.end, [(elapsed, f"{bg} fg b"), (" elapsed ", f"{bg} dim")])
    parts = [("needs you: ", "dim"), needs]
    if note:
        parts.append(("  ·  " + note, "dim"))
    s.seq(3, p.x + 1, parts)


def task_lines(s, p, r, ttype, text):
    s.put(r, p.x + 1, "TASK", "dim b")
    lines = wrap(text, p.w - 9 - len(ttype) - 2)
    for i, ln in enumerate(lines):
        s.put(r + i, p.x + 7 + len(ttype) + 2, ln)
    s.put(r, p.x + 7, ttype, "blue")
    return r + len(lines)


STAGE_G = {"done": ("✓", "ok"), "now": ("▸", "claude"), "todo": ("○", "dim"), "held": ("◆", "warn")}


def stage_row(s, p, r, x, state, name, t="", note="", tcol=None):
    g, st = STAGE_G[state]
    s.put(r, x, g, st)
    nst = {"now": "b", "done": "", "todo": "dim", "held": "warn b"}[state]
    s.put(r, x + 2, name, nst)
    tc = tcol or x + 23
    s.rput(r, tc, t, "dim")
    s.put(r, tc + 2, note, "warn" if state == "held" else ("claude" if state == "now" else "dim"), w=p.end - 2 - tc - 2)


def stages_box(s, p, r, rows, right="single task · no plan"):
    s.box(r, p.x, len(rows) + 2, p.w, "stages", right=right if p.w > 90 else None)
    for i, row in enumerate(rows):
        stage_row(s, p, r + 1 + i, p.x + 2, *row)
    return r + len(rows) + 2


RGR_COL = {"RED": ("err", "bg-errbg"), "GREEN": ("ok", "bg-okbg"), "REFACTOR": ("blue", "bg-bluebg")}


def rgr(s, r, x, w, cells):
    """cells: (phase, state, detail); state in done/now/todo/na. Draws 4 rows."""
    cw = (w - 6) // 3
    for i, (ph, state, detail) in enumerate(cells):
        cx = x + i * (cw + 3)
        col, bg = RGR_COL[ph]
        if state == "now":
            s.box(r, cx, 4, cw, st=col)
            s.fill(r + 1, cx + 1, cw - 2, " ", bg)
            s.put(r + 1, cx + 2, "● " + ph, f"{bg} {col} b")
            if " · " in detail:
                detail, age = detail.rsplit(" · ", 1)
                s.rput(r + 1, cx + cw - 2, age, f"{bg} fg b")
            s.put(r + 2, cx + 2, detail, "fg", w=cw - 4)
        elif state == "done":
            s.box(r, cx, 4, cw, st="border")
            s.put(r + 1, cx + 2, "✓ " + ph, col)
            s.put(r + 2, cx + 2, detail, "dim", w=cw - 4)
        elif state == "todo":
            s.box(r, cx, 4, cw, st="faint")
            s.put(r + 1, cx + 2, "○ " + ph, "dim")
            s.put(r + 2, cx + 2, detail, "faint", w=cw - 4)
        else:  # not part of this task type
            s.box(r, cx, 4, cw, st="faint")
            s.put(r + 1, cx + 2, "– " + ph, "faint")
            s.put(r + 2, cx + 2, detail, "faint", w=cw - 4)
        if i < 2:
            s.put(r + 1, cx + cw + 1, "→", "dim")


def footer(s, p, commit, spend):
    """spend: list of (text, style). Dim, bottom-right. commit: (sha, text) or None."""
    r = ROWS - 2
    s.put(r - 1, p.x, "─" * p.w, "faint")
    n = sum(len(t) for t, _ in spend)
    s.rseq(r, p.end, spend)
    if commit:
        sha, txt = commit
        c = s.put(r, p.x + 1, sha + " ", "faint")
        s.put(r, c, txt, "faint", w=p.end - n - 3 - c)


def spend(agents, t, pct):
    return [(f"{agents} agents · {t} · ", "faint"), (f"≈ {pct}% of plan", "faint mu")]


def focus_test(s, p, r, n_of, done_line, more, tid, desc, selector, cells, next_note, nxt, age):
    """the focus block on the test being built now. Returns next row."""
    x, w = p.x, p.w
    body = []
    dl = wrap(desc, w - 6)
    h = 1 + 2 + 1 + len(dl) + 1 + 1 + 4 + 1 + 1 + (2 if nxt else 0) + 1
    s.box(r, x, h, w, "now building", right=n_of, rst="fg b")
    rr = r + 1
    if done_line:
        c = s.seq(rr, x + 2, done_line)
        if more:
            button(s, rr, c + 2, "+", more)
    else:
        s.put(rr, x + 2, "no test finished yet", "faint")
    rr += 2
    s.put(rr, x + 2, tid, "b")
    s.rput(rr, x + w - 2, age, "fg")
    rr += 1
    for i, ln in enumerate(dl):
        s.put(rr + i, x + 2, ln, "fg mu")
    rr += len(dl)
    s.put(rr, x + 2, selector, "dim", w=w - 4)
    rr += 2
    rgr(s, rr, x + 2, w - 4, cells)
    rr += 4
    s.put(rr, x + 2, next_note, "dim", w=w - 4)
    rr += 1
    if nxt:
        rr += 1
        s.seq(rr, x + 2, [("next  ", "dim"), ("○ ", "dim"), (nxt, "dim")])
        rr += 1
    return r + h


# ===================================================================== frames
def g1_base(pane_w, t="1:55", age="5.1s", note="last event 5s ago: RED implement-tests started"):
    s, p = screen(T_G1_RUN, pane_w, spin=("Running workflow", "1m 55s" if t == "1:55" else "1m 57s"))
    status(s, p, "●", "RUNNING", "code-tdd · RED · implement-tests", t, note=note if p.w > 90 else "")
    r = task_lines(s, p, 5, "bug_fix", BUG_TASK) + 1
    narrow = p.w < 90
    rows = [("done", "code-scenarios", "8.0s", "G:scenarios · auto"),
            ("now", "code-tdd", "1:05", "RED · test 3 of 4" if narrow else "RED · test 3 of 4 · attempt 1"),
            ("todo", "code-safety-net"), ("todo", "G:task-end")]
    r = stages_box(s, p, r, rows) + 1
    done = [("✓ 2 done", "ok"), ("  ·  1 red → green  ·  ", "dim"), ("◌ 1 covered", "cyan")]
    if narrow:
        done = [("✓ 2 done", "ok"), (" · 1 red→green · ", "dim"), ("◌ 1 covered", "cyan")]
    r = focus_test(
        s, p, r, "test 3 of 4", done, "show 2",
        "zero-percent-original-price",
        "A 0% discount leaves the price as it was: apply_discount(100, 0) returns 100.",
        "tests/test_discount.py::test_zero_percent_returns_original_price",
        [("RED", "now", "implement-tests r1 · " + age),
         ("GREEN", "todo", "implement-code"),
         ("REFACTOR", "na", "not part of bug_fix")],
        "next: the runner must fail, or the test is marked covered",
        "hundred-percent-returns-zero", age)
    return s, p, r


def r2_1():
    s, p, r = g1_base(109)
    br = ROWS - 4
    c = button(s, br, p.x + 1, "s", "suggest")
    s.put(br, c + 2, "a note the next agent reads when it starts", "faint")
    s.rput(br, p.end, "ctrl+x tab to focus the pane", "faint")
    footer(s, p, ("3aaba6a", "covered discount-non-round-price"), spend(12, "1:55", "0.4"))
    return s


def r2_7():
    s, p, r = g1_base(79)
    br = ROWS - 4
    c = button(s, br, p.x + 1, "s", "suggest")
    s.put(br, c + 2, "ctrl+x tab to focus", "faint")
    footer(s, p, ("3aaba6a", "covered discount-non-round-price"), spend(12, "1:55", "0.4"))
    return s


def r2_4():
    s, p, r = g1_base(109, t="1:57", age="7.1s", note="suggestion queued for the next agent")
    r += 1
    x, w = p.x, p.w
    s.box(r, x, 9, w, "suggestion", right="queued", rst="claude b", st="claude")
    s.seq(r + 1, x + 2, [("› ", "claude b"),
                         ("Keep apply_discount's signature. Fix the formula; don't add input validation.", "fg mu")])
    s.seq(r + 3, x + 2, [("◷ queued 0:04 ago", "claude"), ("  ·  applies at the next agent spawn: ", "dim"),
                         ("GREEN implement-code", "b")])
    s.put(r + 4, x + 4, "if this test is covered instead, it goes to RED implement-tests for hundred-percent-returns-zero",
          "dim", w=w - 6)
    s.put(r + 5, x + 4, "the agent running now (RED implement-tests, started 7s ago) will not see it", "dim")
    c = button(s, r + 7, x + 2, "e", "edit")
    button(s, r + 7, c + 1, "w", "withdraw")
    s.rput(r + 7, x + w - 2, "appended to .pairingbuddy/human-guidance.json", "faint")
    footer(s, p, ("3aaba6a", "covered discount-non-round-price"), spend(12, "1:57", "0.4"))
    return s


def nf_head(pane_w=109):
    s, p = screen(T_NF6_GREEN, pane_w, spin=("Running workflow", "2m 14s"))
    status(s, p, "●", "RUNNING", "code-tdd · GREEN · implement-code", "2:14", pre="plan task 3 of 12",
           note="last event 6s ago: GREEN implement-code started")
    r = task_lines(s, p, 5, "new_feature", NF_TASK) + 1
    return s, p, r


def plan_box(s, p, r, expanded):
    x, w = p.x, p.w
    tasks = []
    if expanded:
        for i, t in enumerate(PLAN[:2]):
            tasks.append(("done", i + 1, t))
    else:
        tasks.append(("donecount", 2, None))
    tasks.append(("now", 3, PLAN[2]))
    later = PLAN[3:] if expanded else PLAN[3:5]
    for i, t in enumerate(later):
        tasks.append(("todo", 4 + i, t))
    stage_rows = [("done", "code-scenarios", "5.8s", "G:scenarios · auto"),
                  ("now", "code-tdd", "0:47", "GREEN · test 1 of 1"),
                  ("todo", "code-safety-net"), ("todo", "G:task-end")]
    h = len(tasks) + len(stage_rows) + 2 + 1
    s.box(r, x, h, w, "plan", right="cart-pricing.md · task 3 of 12", rst="dim mu")
    rr = r + 1
    for kind, n, title in tasks:
        if kind == "donecount":
            s.put(rr, x + 2, "✓ 2 done", "ok")
        elif kind == "done":
            s.seq(rr, x + 2, [("✓ ", "ok"), (f"task {n:<2}  ", "dim"), (title, "mu")])
        elif kind == "now":
            s.seq(rr, x + 2, [("▸ ", "claude"), (f"task {n:<2}  ", "b"), (title, "b mu")])
            s.rput(rr, x + w - 2, "this run", "claude")
            for j, row in enumerate(stage_rows):
                stage_row(s, p, rr + 1 + j, x + 6, *row, tcol=x + 28)
            rr += len(stage_rows)
        else:
            s.seq(rr, x + 2, [("○ ", "dim"), (f"task {n:<2}  ", "dim"), (title, "dim mu")])
        rr += 1
    rr += 0
    if expanded:
        button(s, rr, x + 2, "−", "collapse")
        s.put(rr, x + 16, "12 tasks · 2 done · 1 running · 9 to go", "faint")
    else:
        button(s, rr, x + 2, "+", "9 more")
        s.put(rr, x + 14, "2 done above · 7 later tasks", "faint")
    return r + h


def nf_focus(s, p, r):
    return focus_test(
        s, p, r, "test 1 of 1", None, None,
        "order-total-example-sums-lines",
        "order_total([(10, 2), (4, 1)]) returns 30.0: line totals 25.0 and 5.0 summed.",
        "tests/test_cart.py::test_order_total_sums_line_totals",
        [("RED", "done", "16.3s · exit 1"), ("GREEN", "now", "implement-code r1 · 5.7s"),
         ("REFACTOR", "todo", "tests, then code")],
        "next: the runner must pass, then REFACTOR reviews tests and code",
        None, "5.7s")


def r2_2():
    s, p, r = nf_head()
    r = plan_box(s, p, r, expanded=False) + 1
    nf_focus(s, p, r)
    br = ROWS - 4
    c = button(s, br, p.x + 1, "s", "suggest")
    s.put(br, c + 2, "a note the next agent reads when it starts", "faint")
    footer(s, p, ("6b4b1f6", "red checkpoint · order-total-example-sums-lines"), spend(8, "2:14", "0.3"))
    return s


def r2_3():
    s, p, r = nf_head()
    r = plan_box(s, p, r, expanded=True) + 1
    x, w = p.x, p.w
    # focus shrinks to one line while the plan is expanded
    s.box(r, x, 3, w, "now building", right="test 1 of 1", rst="fg b")
    s.seq(r + 1, x + 2, [("order-total-example-sums-lines  ", "b"), ("✓ RED", "err"), ("  →  ", "dim"),
                         (" ● GREEN ", "bg-okbg ok b"), (" implement-code 5.7s", "fg"), ("  →  ", "dim"),
                         ("○ REFACTOR", "dim")])
    br = ROWS - 4
    c = button(s, br, p.x + 1, "s", "suggest")
    s.put(br, c + 2, "a note the next agent reads when it starts", "faint")
    footer(s, p, ("6b4b1f6", "red checkpoint · order-total-example-sums-lines"), spend(8, "2:14", "0.3"))
    return s


def r2_5():
    s, p = screen(T_G1_NET, 109, spin=("Running workflow", "3m 02s"))
    status(s, p, "●", "RUNNING", "code-safety-net · lens round", "3:02",
           note="last event 3s ago: refuter finished on code finding 2")
    r = task_lines(s, p, 5, "bug_fix", BUG_TASK) + 1
    rows = [("done", "code-scenarios", "8.0s", "G:scenarios · auto"),
            ("done", "code-tdd", "1:31", "4 tests · 1 red → green · 3 covered"),
            ("now", "code-safety-net", "0:34", "lens round · attempt 1"),
            ("todo", "G:task-end")]
    sr = r
    r = stages_box(s, p, r, rows) + 1
    s.bg(2, p.end - len("3:02 elapsed "), 4, "mu")      # invented times
    s.bg(sr + 3, p.x + 2 + 23 - 4, 4, "mu")
    x, w = p.x, p.w
    s.box(r, x, 13, w, "lens round", right="safety-net · 3 lenses", rst="fg b")
    hx = [x + 4, x + 27, x + 36, x + 46, x + 54, x + 63]
    for c, hd in zip(hx, ["lens", "model", "state", "found", "refuted", "standing"]):
        s.put(r + 1, c, hd, "dim")
    L = [("done", "code", "sonnet", "✓ 41s", "3", "2", "1"),
         ("done", "tests", "sonnet", "✓ 38s", "1", "1", "0"),
         ("now", "corpus misalignment", "sonnet", "▸ 22s", "–", "–", "–")]
    for i, (st, name, model, state, f, rf, sd) in enumerate(L):
        rr = r + 2 + i
        g, gs = STAGE_G[st]
        s.put(rr, x + 2, g, gs)
        s.put(rr, hx[0], name, "b mu" if st == "now" else "mu")
        s.put(rr, hx[1], model, "dim mu")
        s.put(rr, hx[2], state, ("claude b mu" if st == "now" else "ok mu"))
        for c, v in zip(hx[3:6], (f, rf, sd)):
            s.put(rr, c + 2, v, "faint" if v == "–" else ("warn b mu" if c == hx[5] and v != "0" else "mu"))
    s.put(r + 5, x + 2, "─" * (w - 4), "faint")
    s.seq(r + 6, x + 2, [("findings ", "dim"), ("4", "fg mu"), (" · refuted ", "dim"), ("3", "fg mu"),
                         (" · standing ", "dim"), ("1", "warn b mu"), ("   refuters ", "dim"), ("4 of 4 done", "mu")])
    s.seq(r + 8, x + 2, [("standing  ", "dim"), ("code-1  ", "warn mu"),
                         ("apply_discount accepts percent > 100 and returns a negative price", "fg mu")])
    s.put(r + 10, x + 2, "next: corpus misalignment finishes, its findings are refuted, then the fix agent "
                         "takes what stands", "dim", w=w - 4)
    s.put(r + 11, x + 2, "tests: 4 done · 1 red → green · 3 covered", "faint")
    c = button(s, ROWS - 4, p.x + 1, "s", "suggest")
    s.put(ROWS - 4, c + 2, "a note the next agent reads when it starts: the fix agent, if a finding stands", "faint")
    footer(s, p, ("9ff21da", "covered hundred-percent-returns-zero"), spend(19, "3:02", "0.7"))
    s.bg(ROWS - 2, p.end - len("19 agents · 3:02 · ≈ 0.7% of plan"), 16, "mu")
    return s


def r2_6():
    s, p = screen(T_E1_NH, 109)
    x, w = p.x, p.w
    for rr in (2, 3):
        s.fill(rr, x, w, " ", "bg-warnbg")
    s.seq(2, x, [(" ◆ NEEDS YOU ", "bg-warn ink b"), ("  G:task-end is held · the run waits", "bg-warnbg warn b")])
    s.rseq(2, p.end, [("3:14", "bg-warnbg fg b"), (" elapsed ", "bg-warnbg dim")])
    s.seq(3, x + 1, [("needs you: ", "bg-warnbg dim"), ("yes", "bg-warnbg warn b"),
                     ("  ·  waiting since 3:14  ·  nothing is lost while it waits", "bg-warnbg dim")])
    r = task_lines(s, p, 5, "bug_fix", BUG_TASK) + 1
    rows = [("done", "code-scenarios", "11.7s", "G:scenarios · auto"),
            ("done", "code-tdd", "1:34", "4 tests · 1 red → green · 3 covered"),
            ("done", "code-safety-net", "8.4s", "full suite green"),
            ("held", "G:task-end", "", "held · open ambiguity in 2 returns")]
    r = stages_box(s, p, r, rows) + 1
    s.box(r, x, 18, w, "why it stopped", st="warn", tst="warn b")
    s.put(r + 1, x + 2, "Two implement-tests returns carry an open ambiguity, so the policy can't pass this gate:",
          "fg")
    amb = [("hundred-percent-makes-free", "code-tdd.implement-tests.hundred-percent-makes-free.r1.a1.json",
            "should 100% return 0 or 0.0?"),
           ("non-round-result", "code-tdd.implement-tests.non-round-result.r1.a1.json",
            "round the result to cents, or keep the float?")]
    rr = r + 3
    for tid, f, q in amb:
        s.seq(rr, x + 4, [("◆ ", "warn"), (tid, "warn b")])
        s.put(rr, x + 34, q, "fg mu")
        s.put(rr + 1, x + 6, f, "dim")
        rr += 3
    s.put(rr, x + 2, "─" * (w - 4), "faint")
    s.put(rr + 1, x + 2, "WHAT YOU CAN DO", "dim b")
    s.seq(rr + 2, x + 4, [("1  ", "claude b"), ("answer in the chat", "b"),
                          ("  Claude has the gate question open; your answer records the gate", "dim")])
    s.seq(rr + 3, x + 4, [("2  ", "claude b"), ("approve as is", "b"), ("  run it yourself:", "dim")])
    s.put(rr + 4, x + 7, "!node …/cli/pb.mjs human approve G:task-end", "claude")
    s.seq(rr + 5, x + 4, [("3  ", "claude b"), ("read the returns first", "b"),
                          ("  the two files above, under .pairingbuddy/", "dim")])
    s.put(rr + 7, x + 2, "a suggestion still queues, but no agent spawns until you answer",
          "faint")
    footer(s, p, ("e1a2142", "covered hundred-percent-makes-free"), spend(15, "3:14", "0.6"))
    return s


# ===================================================================== render
CAP = "Dotted magenta underline: invented. Everything else comes from the named recording."
IMAGES = [
    ("R2-1-bugfix-red", r2_1,
     "R2-1 · bug_fix running · RED on test 3 of 4",
     "g-open-1 at 1:55, the same moment as A1. Stages, then one focus block on the test being built.",
     ["Invented: the test's description (scenarios.json is not recorded), ≈ % of plan.",
      "Real: stage times, test ids and order, selector, 5.1s step age, 2 done (1 red → green, 1 covered), "
      "12 agents, last commit 3aaba6a."]),
    ("R2-2-plan-green-collapsed", r2_2,
     "R2-2 · new_feature inside a plan run · GREEN · collapsed plan",
     "t52-nf-6 at 2:14, shown as task 3 of an invented 12-task plan. Done tasks fold to one line; current plus next 2; [+ 9 more].",
     ["Invented: the whole plan (file, titles, position 3 of 12), the test description, ≈ % of plan.",
      "Real: stage times, RED 16.3s exit 1, GREEN implement-code started 128.3s, 8 agents, last commit 6b4b1f6."]),
    ("R2-3-plan-expanded", r2_3,
     "R2-3 · the same moment with the plan expanded",
     "All 12 plan tasks, with the workflow stages nested under the current task. The focus block folds to one line.",
     ["Invented: the plan and its titles, ≈ % of plan.",
      "Real: the nested stages and the test row, as in R2-2."]),
    ("R2-4-suggestion-queued", r2_4,
     "R2-4 · a suggestion queued mid-run",
     "g-open-1 at 1:57. The workflow takes no input mid-run: the note waits for the next agent spawn, and the pane says which one.",
     ["Invented: the suggestion text, the queue time, ≈ % of plan. The file is a proposal (see README).",
      "Real: the step running now and its age, the two possible next agents (in the recording the test was covered, "
      "so it went to RED for hundred-percent-returns-zero)."]),
    ("R2-5-safety-net-lenses", r2_5,
     "R2-5 · safety-net lens round in the focus block",
     "g-open-1 after code-tdd. The lens round replaces the test while it runs.",
     ["Invented: everything in the lens round (lenses have not run in any recording), 3:02, 0:34, 19 agents, ≈ % of plan.",
      "Real: lens names from the D8 lens map, Sonnet default, stage times before it, test counts, last commit 9ff21da."]),
    ("R2-6-needs-you", r2_6,
     "R2-6 · needs you · G:task-end held",
     "e-open-1 at 3:14. What stopped, why, and the three things the human can do.",
     ["Invented: the one-line reading of each ambiguity (the returns' text is not recorded), ≈ % of plan.",
      "Real: gate, reason, both return files, stage times, the pb human approve command form (D4), 15 agents."]),
    ("R2-7-bugfix-red-80col", r2_7,
     "R2-7 · R2-1 at an 80-column pane",
     "The same moment in a 79-column pane: notes shorten, the focus block keeps its three steps.",
     ["Invented and real: as R2-1."]),
]


def main(only=None):
    os.makedirs(OUT, exist_ok=True)
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    for name, fn, title, cap, notes in IMAGES:
        if only and not any(o in name for o in only):
            continue
        s = fn()
        doc, W, H = page(s, "dark", title, f"<div>{cap}</div>", [CAP] + notes, caph=118)
        hp = os.path.abspath(os.path.join(OUT, name + ".html"))
        open(hp, "w").write(doc)
        png = os.path.abspath(os.path.join(OUT, name + ".png"))
        subprocess.run([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        f"--window-size={W},{H}", "--force-device-scale-factor=2",
                        f"--screenshot={png}", "file://" + hp], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.remove(hp)
        print(name, W, H)


if __name__ == "__main__":
    main(sys.argv[2:] or None)
