"""Round 4: plain words, a one-line cycle, and switching between band and pane.

Run: python3 src/mocks.py <outdir> [name-filter ...]
Builds on base.py (round 2) and r3.py (round 3), both unchanged.
"""
import os
import subprocess
import sys

from lib import Screen, page
from cc import transcript, spinner, prompt, band_mark, wrap
from data import BUG_TASK, BUG_TASK_SHORT
from base import screen, button, status, task_lines, STAGE_G, ROWS, T_G1_RUN
from r3 import glance, list_box, footer_commit, footer_text, PLAN_ASK, T_P2_R3, T_PLAN_Q2

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
BAND_COLS, BAND_ROWS = 139, 26

T_PLAN_SLICES = [
    ("user", "/pairingbuddy:plan " + PLAN_ASK),
    ("tool", "Skill", "pairingbuddy:planning", "Successfully loaded skill", "ok"),
    ("tool", "Workflow", "pairingbuddy:plan-requirements", "Done · 9 agents · 6m 12s", "ok"),
    ("tool", "Workflow", "pairingbuddy:plan-architecture", "Done · 14 agents · 11m 40s", "ok"),
    ("say", "You OK'd the architecture. One fix went the wrong way and was undone; the retry kept the run "
            "directory per worktree. Now cutting the plan into slices."),
    ("tool", "Workflow", "pairingbuddy:plan-tracers", ["lens: pb1 plan-tracers - lens pr-fit - r1"], "run"),
]


# ------------------------------------------------------------------ band
def band_screen(entries, spin=None, hint=None):
    s = Screen(BAND_COLS, BAND_ROWS)
    b = BAND_ROWS - 5
    tmp = Screen(BAND_COLS, 200)
    end = transcript(tmp, 1, BAND_COLS - 2, entries, top=0)
    avail = b - (2 if spin else 1)
    start = max(0, end - avail)
    for r in range(avail):
        s.g[r] = tmp.g[start + r][:]
    if spin:
        spinner(s, b - 2, 1, *spin)
    prompt(s, BAND_ROWS - 4, 1, BAND_COLS - 2)
    if hint:
        s.rput(BAND_ROWS - 1, BAND_COLS - 2, hint, "faint")
    return s, b


SEP = (" │ ", "faint")


def band(s, b, parts, focused=False, label="▸ details"):
    bw = BAND_COLS - 4
    n = sum(len(t) for t, _ in parts)
    assert n <= bw - len(label) - 4, (n, bw)
    s.seq(b, 1, parts)
    st = "bg-fg ink b" if focused else "bg-sel fg b"
    s.rseq(b, bw, [(f" {label} ", st)])
    band_mark(s, b)


def calm_band_parts():
    return [("pb ", "claude b"), ("● ", "claude"), ("RED", "err b"), (" · test 3 of 4", "fg"), SEP,
            ("1:55 · 12 agents · ", "fg"), ("≈0.4%", "fg mu"), SEP,
            ("left: ", "dim"), ("1 test + review", "fg"), SEP,
            ("looping: ", "dim"), ("no", "ok b"), SEP, ("off track: ", "dim"), ("no", "ok b"), SEP,
            ("needs you: ", "dim"), ("no", "ok b")]


# ------------------------------------------------------------------ pane pieces
def steps_box(s, p, r, rows, title="the task, step by step"):
    """rows: (state, name, time, note)."""
    s.box(r, p.x, len(rows) + 2, p.w, title)
    for i, row in enumerate(rows):
        state, name = row[0], row[1]
        t = row[2] if len(row) > 2 else ""
        note = row[3] if len(row) > 3 else ""
        g, gs = STAGE_G[state]
        rr = r + 1 + i
        s.put(rr, p.x + 2, g, gs)
        s.put(rr, p.x + 4, name, {"now": "b", "done": "", "todo": "dim", "held": "warn b"}[state])
        s.rput(rr, p.x + 36, t, "dim")
        s.put(rr, p.x + 38, note, {"now": "claude", "held": "warn"}.get(state, "dim"), w=p.w - 40)
    return r + len(rows) + 2


CYCLE = [("RED", "err", "bg-errbg", "write a failing test"),
         ("GREEN", "ok", "bg-okbg", "make it pass"),
         ("REFACTOR", "blue", "bg-bluebg", "clean up")]


def cycle_line(s, r, x, now, bugfix):
    c = x
    for i, (ph, col, bg, what) in enumerate(CYCLE):
        if ph == now:
            c = s.seq(r, c, [(f" ● {ph}  {what} ", f"{bg} {col} b")])
        elif ph == "REFACTOR" and bugfix:
            c = s.seq(r, c, [(f"{ph}  {what} (not in a bug fix)", "faint")])
        else:
            done = [p[0] for p in CYCLE].index(ph) < [p[0] for p in CYCLE].index(now)
            c = s.seq(r, c, [("✓ " if done else "", col), (ph, col + " b" if done else "dim b"),
                             (f"  {what}", "fg" if done else "dim")])
        if i < 2:
            c = s.put(r, c, "  →  ", "faint")
    return c


def now_building(s, p, r, n_of, tests, tid, desc, selector, now, bugfix, age, next_note, legend):
    """tests: list of (glyph, style, short name, name style)."""
    x, w = p.x, p.w
    dl = wrap(desc, w - 6)
    h = 2 + 2 + 2 + len(dl) + 1 + 2 + 1 + 1 + 1
    s.box(r, x, h, w, "now building", right=n_of, rst="fg b")
    rr = r + 1
    c = x + 2
    for g, gs, name, ns in tests:
        c = s.seq(rr, c, [(g + " ", gs), (name, ns), ("   ", "")])
    s.put(rr + 1, x + 4, legend, "faint", w=w - 6)
    rr += 3
    s.put(rr, x + 2, tid, "b")
    s.rput(rr, x + w - 2, age, "fg")
    rr += 1
    for i, ln in enumerate(dl):
        s.put(rr + i, x + 2, ln, "fg mu")
    rr += len(dl)
    s.put(rr, x + 2, selector, "dim", w=w - 4)
    rr += 2
    cycle_line(s, rr, x + 2, now, bugfix)
    rr += 2
    s.put(rr, x + 2, next_note, "dim", w=w - 4)
    return r + h


LEGEND = "✓ made to pass   ◌ already passed, nothing to fix   ▸ now   · to do"


# ===================================================================== TDD
def r4_1():
    s, b = band_screen(T_G1_RUN, spin=("Running workflow", "1m 55s"))
    band(s, b, calm_band_parts())
    return s


def r4_6():
    s, b = band_screen(T_G1_RUN, spin=("Running workflow", "1m 55s"),
                       hint="ctrl+x tab: focus Pairing Buddy · enter: open details · esc: back to the prompt")
    band(s, b, calm_band_parts(), focused=True)
    return s


def r4_2():
    s, p = screen(T_G1_RUN, 109, spin=("Running workflow", "1m 55s"))
    status(s, p, "●", "RUNNING", "build test by test · RED · writing a failing test", "1:55",
           note="last event 5s ago: started writing the failing test")
    r = task_lines(s, p, 5, "bug fix", BUG_TASK) + 1
    r = glance(s, p, r, [
        ("NOW", [("writing a failing test for ", "fg"), ("the 0% discount", "fg mu"), (" · test 3 of 4", "fg")],
         [], "dim b"),
        ("SPENT", [("12 agents · 1:55 · ", "fg"), ("≈0.4% of plan", "fg mu")], [], "dim b"),
        ("LEFT", [("1 more test, then the safety-net review and your sign-off", "fg")], [], "dim b"),
        ("LOOPING", [("no", "ok b"), ("  ·  every step worked on its first try  ·  this step: try 1 of 3", "dim")],
         [], "dim b"),
        ("OFF TRACK", [("no", "ok b"), ("  ·  only ", "dim"), ("discount.py and its tests", "dim mu"),
                       (" changed", "dim")], [], "dim b"),
    ]) + 1
    r = steps_box(s, p, r, [("done", "write scenarios", "8.0s", "OK'd (auto)"),
                            ("now", "build test by test", "1:05", "test 3 of 4"),
                            ("todo", "safety-net review"),
                            ("todo", "your sign-off at the end")]) + 1
    now_building(
        s, p, r, "test 3 of 4",
        [("✓", "ok", "10% off 100 is 90", "mu"), ("◌", "cyan", "non-round price", "mu"),
         ("▸", "claude b", "0% keeps the price", "b mu"), ("·", "faint", "100% off is free", "dim mu")],
        "zero-percent-original-price",
        "A 0% discount leaves the price as it was: apply_discount(100, 0) returns 100.",
        "tests/test_discount.py::test_zero_percent_returns_original_price",
        "RED", True, "5.1s",
        "next: the test must fail when it runs. If it passes already, it is marked as already passing.", LEGEND)
    c = button(s, ROWS - 4, p.x + 1, "s", "suggest")
    s.put(ROWS - 4, c + 2, "a note the next agent reads when it starts", "faint")
    s.rput(ROWS - 4, p.end, "esc or × closes · the band stays", "faint")
    footer_commit(s, p, "3aaba6a", "saved: discount-non-round-price already passes")
    return s


def r4_3():
    s, p = screen(T_P2_R3, 109, spin=("Running workflow", "2m 10s"))
    status(s, p, "●", "RUNNING", "build test by test · RED · writing a failing test, 3rd try", "2:10",
           needs=("soon", "warn b"), note="if this try fails too, the run stops and waits for you")
    r = task_lines(s, p, 5, "bug fix", BUG_TASK_SHORT) + 1
    W = "warn b"
    r = glance(s, p, r, [
        ("NOW", [("writing a failing test for ", "fg"), ("a 0% discount keeping the full price", "fg mu"),
                 (" · test 2 of 2", "fg")], [], "dim b"),
        ("SPENT", [("14 agents · 2:10 · ", "fg"), ("≈0.5% of plan", "fg mu")], [], "dim b"),
        ("LEFT", [("this test, then the safety-net review and your sign-off", "fg")], [], "dim b"),
        ("LOOPING", [("yes", W), (": 3 tries at the same failing test", "warn"), ("  ·  this step: try 3 of 3", W)],
         [[("each try wrote a test that passes straight away, so it can't fail first", "fg")],
          [("try 1 at 1:37 ", "dim"), ("passed", "warn"), ("  ·  try 2 at 1:52 ", "dim"), ("passed", "warn"),
           ("  ·  try 3 ", "dim"), ("running 4.1s", "claude")]], W),
        ("OFF TRACK", [("yes", W), (": ", "warn"), ("an earlier test (10% off 100) was changed on try 2, after it passed",
                                                    "warn mu")], [], W),
    ]) + 1
    r = steps_box(s, p, r, [("done", "write scenarios", "7.7s", "OK'd (auto)"),
                            ("now", "build test by test", "1:18", "test 2 of 2 · 3rd try"),
                            ("todo", "safety-net review"),
                            ("todo", "your sign-off at the end")]) + 1
    now_building(
        s, p, r, "test 2 of 2",
        [("✓", "ok", "10% off 100 is 90", "mu"), ("✗✗▸", "warn b", "0% keeps the full price", "b mu")],
        "zero-percent-keeps-full-price",
        "A 0% discount keeps the full price: apply_discount(100, 0) returns 100.",
        "tests/test_discount.py::test_zero_percent_keeps_full_price",
        "RED", True, "4.1s",
        "next: the test runs. If it passes again, the run stops; a re-run keeps the finished test.",
        "✓ made to pass   ▸ now   ✗ a try that was refused because the new test already passed")
    c = button(s, ROWS - 4, p.x + 1, "s", "suggest")
    s.put(ROWS - 4, c + 2, "too late for this try: a note reaches the agent after it", "faint")
    footer_commit(s, p, "2ae1fed", "made to pass: ten-percent-off-hundred")
    return s


# ===================================================================== planning
def plan_head(entries, stage_txt, elapsed, needs, note, spin=None):
    s, p = screen(entries, 109, spin=spin)
    status(s, p, "●", "PLANNING", stage_txt, elapsed, needs=needs, note=note)
    s.bg(2, p.end - len(elapsed + " elapsed "), len(elapsed), "mu")
    s.put(5, p.x + 1, "AIM", "dim b")
    lines = wrap(PLAN_ASK, p.w - 9)
    for i, ln in enumerate(lines):
        s.put(5 + i, p.x + 7, ln, "fg bo")
    return s, p, 5 + len(lines) + 1


def r4_4():
    s, p, r = plan_head(T_PLAN_Q2, "brainstorm · asking you question 2", "14:20", ("yes", "warn b"),
                        "your answer goes in the chat")
    r = glance(s, p, r, [
        ("NOW", [("asking you question 2 of about 4", "fg mu"), (": how much review each step gets", "fg bo")],
         [], "dim b"),
        ("SPENT", [("1 agent · ", "fg"), ("14:20", "fg mu"), (" · ", "fg"), ("≈0.2% of plan", "fg mu")], [], "dim b"),
        ("LEFT", [("2 more questions, then requirements, architecture, slices and the task list,", "fg")],
         [[("each one followed by your OK", "fg")]], "dim b"),
        ("LOOPING", [("no", "ok b"), ("  ·  no question asked twice", "dim")], [], "dim b"),
        ("OFF TRACK", [("no", "ok b"), ("  ·  the aim hasn't changed since you asked", "dim")], [], "dim b"),
    ]) + 1
    r = list_box(s, p, r, "decided", [
        [("✓ ", "ok"), ("Every coding path runs as separate steps, with your checkpoints between them", "bo")],
        [("✓ ", "ok"), ("In auto mode the routine checkpoints pass by themselves; it stops when unsure or stuck", "bo")],
    ], right="2 so far") + 1
    s.box(r, p.x, 7, p.w, "open questions", right="1 asked · 2 waiting")
    s.fill(r + 1, p.x + 1, p.w - 2, " ", "bg-sel")
    s.seq(r + 1, p.x + 2, [("▸ Q2 ", "bg-sel claude b"),
                           ("How much review per step: one full round everywhere, or a list each step owns?",
                            "bg-sel fg b bo")])
    s.put(r + 2, p.x + 7, "asking now · options: full round everywhere · a list per step · only at the end", "dim")
    s.seq(r + 4, p.x + 2, [("○ Q3 ", "dim"), ("Where does the state of a run live, and when is it removed?", "fg bo")])
    s.seq(r + 5, p.x + 2, [("○ Q4 ", "dim"), ("Does the progress view only watch, or can it steer the run?", "fg mu")])
    r += 8
    list_box(s, p, r, "still to come", [
        [("○ ", "dim"), ("requirements", ""), ("   then your OK", "dim")],
        [("○ ", "dim"), ("architecture", ""), ("   then your OK", "dim")],
        [("○ ", "dim"), ("slices", ""), ("         thin end-to-end pieces of the plan, then your OK", "dim")],
        [("○ ", "dim"), ("task list", ""), ("      written to the plan file", "dim")],
    ], right="nothing drafted yet")
    footer_text(s, p, "answer in the chat · planning makes no commits")
    return s


def r4_5():
    s, p, r = plan_head(T_PLAN_SLICES, "slices · checking each slice", "52:10", ("no", "ok b"),
                        "last event 4s ago: started checking whether 'Plan tree and unit view' fits one PR",
                        spin=("Running workflow", "52m 10s"))
    r = glance(s, p, r, [
        ("NOW", [("checking the 14 slices drafted so far", "fg mu"), (" (slices: thin end-to-end pieces of the plan)",
                                                                     "dim")], [], "dim b"),
        ("SPENT", [("31 agents · 52:10 · ≈3.1% of plan", "fg mu")], [], "dim b"),
        ("LEFT", [("your OK on the slices, then the task list", "fg"), ("  ·  1 open question", "dim")], [], "dim b"),
        ("LOOPING", [("a little", "warn b"), (": one architecture fix went the wrong way and was redone", "warn mu")],
         [], "warn b"),
        ("OFF TRACK", [("no", "ok b"), ("  ·  ", "dim"), ("every slice maps to the 30 requirements", "dim mu")], [], "dim b"),
    ]) + 1
    r = list_box(s, p, r, "decided", [
        [("✓ 9 earlier", "ok"), ("  ", ""), (" + show 9 ", "bg-sel fg"), ("   latest three:", "dim")],
        [("✓ ", "ok"), ("Reviews run on Sonnet by default; Opus only where the plan names it", "bo")],
        [("✓ ", "ok"), ("A checker judges each fix and can undo it; at most 5 attempts per step", "bo")],
        [("✓ ", "ok"), ("Work lands on an integration branch, one squashed commit per PR", "bo")],
    ], right="12 total") + 1
    r = list_box(s, p, r, "open questions", [
        [("✓ 4 answered", "ok"), ("   ", ""), ("○ ", "dim"),
         ("A run-history view has nothing to read from: leave it for later?", "fg bo")],
        [("      ", ""), ("asked at your OK on the slices, so the checks are not interrupted", "dim")],
    ], right="1 left") + 1
    slices = [("▸ ", "claude", "T4d", "Plan tree and unit view", "being checked: does it fit one PR?", "claude"),
              ("○ ", "dim", "T10", "Solo port", "waiting to be checked", "dim"),
              ("○ ", "dim", "T11a", "Partial mod verdict and stage reports", "waiting to be checked", "dim")]
    items = [[("✓ 11 checked", "ok"), ("  ", ""), (" + show 11 ", "bg-sel fg"),
              ("   ", ""), ("from 'Live probes' to 'Plan execution'", "dim bo")]]
    for g, gs, sid, name, state, sst in slices:
        items.append([(g, gs), (name, "b bo"), (" " * (44 - len(name)), ""), (state, sst)])
    r = list_box(s, p, r, "slices · thin end-to-end pieces of the plan", items, right="14 so far") + 1
    list_box(s, p, r, "still to come", [
        [("○ ", "dim"), ("your OK on the slices", ""), ("   ○ ", "dim"), ("task list", ""),
         ("  written to docs/plans/…", "dim")],
    ])
    footer_text(s, p, "planning makes no commits")
    return s


# ===================================================================== storyboard
def mini_panel(s, r, c, w, h, title):
    s.box(r, c, h, w, title, st="border", tst="fg b")


def r4_7():
    W, H = 190, 40
    s = Screen(W, H)
    pw, gap = 54, 13
    xs = [1, 1 + pw + gap, 1 + 2 * (pw + gap)]
    top, ph = 3, 26
    titles = ["1 · the band, always on", "2 · details open beside the chat", "3 · it opens by itself"]
    for x, t in zip(xs, titles):
        mini_panel(s, top, x, pw, ph, t)

    # --- panel 1: chat + band
    x = xs[0] + 2
    lines = [("> /pairingbuddy:code Fix this bug in discount.py…", "dim"), ("", ""),
             ("⏺ Workflow(pairingbuddy:code-scenarios)", "fg"), ("  ⎿  Done · 2 agents · 10.5s", "dim"), ("", ""),
             ("⏺ Workflow(pairingbuddy:code-tdd)", "fg"), ("  ⎿  implement-tests … r1", "dim")]
    for i, (t, st) in enumerate(lines):
        s.put(top + 2 + i, x, t, st, w=pw - 4)
    br = top + ph - 6
    s.seq(br, x, [("pb ", "claude b"), ("● ", "claude"), ("RED", "err b"), (" 3/4 │ ", "fg"),
                  ("looping ", "dim"), ("no", "ok b"), (" │ ", "faint"), ("you: ", "dim"), ("no", "ok b")])
    s.put(br, xs[0] + pw - 12, " ▸ details ", "bg-fg ink b")
    s.put(br + 1, x, "─" * (pw - 4), "faint")
    s.put(br + 2, x, "> ", "fg")
    s.put(br + 3, x, "─" * (pw - 4), "faint")
    s.put(top + ph - 1 + 1, xs[0], "the band sits above the prompt and never hides", "dim")

    # --- panel 2: chat | pane
    x2 = xs[1] + 2
    split = x2 + 17
    for rr in range(top + 1, top + ph - 1):
        s.put(rr, split, "│", "faint")
    for i, t in enumerate(["> /pairingbuddy:", "  code Fix this…", "", "⏺ Workflow(code-", "  tdd)", "  ⎿ r1 …"]):
        s.put(top + 2 + i, x2, t, "dim")
    px, pwid = split + 2, pw - 22
    s.put(top + 1, px, "Pairing Buddy", "b")
    s.put(top + 1, xs[1] + pw - 3, "×", "fg b")
    s.fill(top + 2, px, pwid, " ", "bg-sel")
    s.seq(top + 2, px, [(" ● RUNNING ", "bg-sel claude b"), ("RED · 3/4", "bg-sel b")])
    rows = [("NOW", "failing test, 0% · 3/4"), ("SPENT", "12 agents · 1:55"), ("LEFT", "1 test + review"),
            ("LOOPING", "no"), ("OFF TRACK", "no")]
    for i, (k, v) in enumerate(rows):
        s.put(top + 4 + i, px, k, "dim b")
        s.put(top + 4 + i, px + 10, v, "ok b" if v == "no" else "fg", w=pwid - 10)
    s.put(top + 10, px, "now building · test 3 of 4", "dim b")
    s.seq(top + 11, px, [("✓ ", "ok"), ("◌ ", "cyan"), ("▸ ", "claude b"), ("·", "faint")])
    s.put(top + 12, px, "A 0% discount leaves the", "fg")
    s.put(top + 13, px, "price as it was.", "fg")
    s.seq(top + 15, px, [(" ● RED ", "bg-errbg err b"), (" → GREEN → …", "dim")])
    s.put(top + ph - 3, px, "esc or × closes", "faint")
    br2 = top + ph - 6
    s.seq(br2, x2, [("pb ● RED 3/4 …", "dim")])
    s.put(top + ph - 1 + 1, xs[1], "the pane docks beside the chat; the band stays", "dim")

    # --- panel 3: needs you
    x3 = xs[2] + 2
    split3 = x3 + 17
    for rr in range(top + 1, top + ph - 1):
        s.put(rr, split3, "│", "faint")
    for i, t in enumerate(["⏺ Workflow(code-", "  safety-net)", "  ⎿ Done", "", "⏺ Waiting for", "  your sign-off"]):
        s.put(top + 2 + i, x3, t, "dim")
    px3 = split3 + 2
    s.put(top + 1, px3, "Pairing Buddy", "b")
    s.put(top + 1, xs[2] + pw - 3, "×", "fg b")
    s.fill(top + 2, px3, pwid, " ", "bg-warnbg")
    s.seq(top + 2, px3, [(" ◆ NEEDS YOU ", "bg-warn ink b"), (" sign-off", "bg-warnbg warn b")])
    s.put(top + 4, px3, "Two tests leave a question", "fg")
    s.put(top + 5, px3, "open. Answer in the chat,", "fg")
    s.put(top + 6, px3, "or approve as it is.", "fg")
    s.put(top + 8, px3, "◆ 100% off is free", "warn")
    s.put(top + 9, px3, "◆ non-round result", "warn")
    br3 = top + ph - 6
    s.fill(br3, x3, 15, " ", "bg-warnbg")
    s.put(br3, x3, " needs you · ", "bg-warnbg warn b")
    s.put(br3 + 1, x3, " opened details", "warn")
    s.put(top + ph - 1 + 1, xs[2], "a stop or a question opens the pane for you", "dim")

    # --- arrows
    g1 = xs[0] + pw + 1
    s.put(top + 9, g1, "enter", "claude b")
    s.put(top + 10, g1, "──────────▶", "claude b")
    s.put(top + 11, g1, "or /pb", "claude")
    s.put(top + 15, g1, "◀──────────", "fg b")
    s.put(top + 16, g1 + 3, "esc, ×", "fg")
    g2 = xs[1] + pw + 1
    s.put(top + 9, g2, "the run", "warn b")
    s.put(top + 10, g2, "──────────▶", "warn b")
    s.put(top + 11, g2, "needs you", "warn b")
    s.put(top + 15, g2, "◀──────────", "fg b")
    s.put(top + 16, g2, "you answer", "fg")

    s.put(0, 1, "SWITCHING BETWEEN THE BAND AND THE PANE", "dim b")
    notes = [
        ("1 → 2", "Press ▸ details in the band (click it, or ctrl+x tab then enter), or type /pb. The pane opens."),
        ("2 → 1", "Esc or × closes the pane. The band was there all along, so nothing is lost."),
        ("→ 3", "When the run stops or needs you, the pane opens without being asked, and the band says so."),
        ("3 → 1", "Once you answer, the run goes on. The pane stays until you close it."),
    ]
    for i, (k, v) in enumerate(notes):
        s.put(top + ph + 3 + i * 2, 2, k, "claude b")
        s.put(top + ph + 3 + i * 2, 10, v, "fg")
    return s


# ===================================================================== render
CAP = ("Dotted magenta underline: invented. Dotted cyan underline: borrowed from the real plan "
       "docs/plans/deterministic-workflows.md. Everything else comes from the named recording.")
IMAGES = [
    ("R4-1-band-tdd-calm", r4_1, "R4-1 · band · TDD calm",
     "g-open-1 at 1:55, a 139-column terminal. Plain labels: left, looping, off track, needs you. ▸ details opens the pane.",
     ["Invented: ≈ % of plan. Real: RED, test 3 of 4, 1:55, 12 agents, what is left."]),
    ("R4-2-pane-tdd-calm", r4_2, "R4-2 · pane · TDD calm",
     "g-open-1 at 1:55. Five plain rows, steps with plain names, and the cycle on one line. "
     "The space saved goes to the test description and per-test progress.",
     ["Invented: ≈ % of plan, the test description and the short test names, the files changed.",
      "Real: test ids, order and outcomes (✓ ◌ ▸ ·), step times, OK'd (auto), try 1 of 3, last commit."]),
    ("R4-3-pane-tdd-looping", r4_3, "R4-3 · pane · TDD looping",
     "probe-2 at 2:10, on the third try at the same failing test. LOOPING and OFF TRACK say yes and say what.",
     ["Invented: ≈ % of plan, the test description, and the OFF TRACK row (probe-2 changed no other test).",
      "Real: three tries, their times, each try's test passing straight away, 14 agents, the stop rule."]),
    ("R4-4-pane-planning-brainstorm", r4_4, "R4-4 · pane · planning, asking question 2",
     "Brainstorm with question 2 open in the chat. The steps ahead use plain names, and 'slices' is explained where it first appears.",
     ["Borrowed: the aim, the decisions, Q2 and Q3. Invented: time, question count, Q4, ≈ % of plan."]),
    ("R4-5-pane-planning-slices", r4_5, "R4-5 · pane · planning, checking the slices",
     "52 minutes in: 14 slices drafted and being checked one by one. More is decided and less remains.",
     ["Borrowed: decisions, the open question, slice names, 30 requirements.",
      "Invented: time, agents, ≈ % of plan, the undone architecture fix, check progress."]),
    ("R4-6-band-focused", r4_6, "R4-6 · band · details button focused",
     "After ctrl+x tab the band has the keyboard and ▸ details is focused, so enter opens the pane and esc goes back to the prompt.",
     ["The key hint line is illustrative. Focus, enter and esc follow the mod API."]),
    ("R4-7-switching-storyboard", r4_7, "R4-7 · switching between band and pane",
     "Band → pane (▸ details or /pb) → back (esc or ×). A stop or a question opens the pane by itself.",
     ["Mini panels, not to scale. API facts: a band Button calls $.ui.open, a pane opened with closeOnEscape "
      "closes on esc or ×, and a slash command can open it too."]),
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
