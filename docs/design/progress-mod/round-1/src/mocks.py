import os
import subprocess
import sys

from lib import Screen, page
from cc import (WIDE_COLS, WIDE_ROWS, TW, PX, PW, NARROW_COLS, NARROW_ROWS,
                transcript, spinner, prompt, pane_frame, band_mark, wrap)
from data import *

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
END = PX + PW  # exclusive end column of pane body

# ------------------------------------------------------------------ transcripts
T_NF6_HEAD = [
    ("user", "/pairingbuddy:code " + NF_TASK),
    ("tool", "Skill", "pairingbuddy:coding", "Successfully loaded skill", "ok"),
    ("tool", "pairingbuddy:curate-guidance", "Curate human guidance before task", "Done (25.7s)", "ok"),
    ("tool", "pairingbuddy:classify-task", "Classify the coding task", "Done (8.1s)", "ok"),
    ("tool", "Workflow", "pairingbuddy:code-scenarios", "Done · 2 agents · 8.2s", "ok"),
]
T_NF6_RUN = T_NF6_HEAD + [
    ("tool", "Workflow", "pairingbuddy:code-tdd",
     ["refactor-tests: pb1 code-tdd REFACTOR refactor-tests", "order-total-example-sums-lines r1"], "run"),
]
T_NF6_DONE = T_NF6_HEAD + [
    ("tool", "Workflow", "pairingbuddy:code-tdd", "Done · 15 agents · 1m 50s", "ok"),
    ("tool", "Workflow", "pairingbuddy:code-safety-net", "Done · 2 agents · 12.9s", "ok"),
    ("tool", "Bash", "node …/cli/pb.mjs task end", '{"ok":true,"removed":"…/.pairingbuddy/run/task","plan":null}', "ok"),
    ("say", "order_total is in cart.py with its one test. Five commits on 6890fbb: placeholders, red, "
            "feat, test and refactor. The full suite passes."),
]
T_G1_RUN = [
    ("user", "/pairingbuddy:code " + BUG_TASK),
    ("tool", "Skill", "pairingbuddy:coding", "Successfully loaded skill", "ok"),
    ("tool", "pairingbuddy:curate-guidance", "Curate human guidance", "Done (6.0s)", "ok"),
    ("tool", "pairingbuddy:classify-task", "Classify the task", "Done (5.4s)", "ok"),
    ("tool", "Workflow", "pairingbuddy:code-scenarios", "Done · 2 agents · 10.5s", "ok"),
    ("tool", "Workflow", "pairingbuddy:code-tdd",
     ["implement-tests: pb1 code-tdd RED implement-tests", "zero-percent-original-price r1"], "run"),
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
T_P2_STOP = [
    ("user", "/pairingbuddy:code " + BUG_TASK_SHORT),
    ("tool", "Skill", "pairingbuddy:coding", "Successfully loaded skill", "ok"),
    ("tool", "pairingbuddy:curate-guidance", "Curate guidance before bug fix", "Done (6.0s)", "ok"),
    ("tool", "pairingbuddy:classify-task", "Classify the discount bug task", "Done (5.5s)", "ok"),
    ("tool", "Workflow", "pairingbuddy:code-scenarios", "Done · 2 agents · 10.2s", "ok"),
    ("tool", "Workflow", "pairingbuddy:code-tdd",
     ["Stopped: step-failed: a step of the stage failed past", "its retries, and a re-run continues from tests{}"], "err"),
    ("say", "The run stopped in code-tdd. zero-percent-keeps-full-price passed on all three RED attempts, "
            "so RED was refused each time."),
]
T_C1_NH = [
    ("user", "/pairingbuddy:code " + BUG_TASK),
    ("tool", "Skill", "pairingbuddy:coding", "Successfully loaded skill", "ok"),
    ("tool", "pairingbuddy:curate-guidance", "Curate human guidance before task", "Done (7.3s)", "ok"),
    ("tool", "pairingbuddy:classify-task", "Classify the coding task", "Done (6.7s)", "ok"),
    ("tool", "Workflow", "pairingbuddy:code-scenarios", "Done · 2 agents · 15.4s", "ok"),
    ("say", "G:scenarios is held: the scenarios return carries an open ambiguity. "
            "I need you to settle it before any test is written."),
]


def wide(entries, spin=None, prompt_text=""):
    s = Screen(WIDE_COLS, WIDE_ROWS)
    pane_frame(s)
    transcript(s, 1, TW - 2, entries, top=0)
    if spin:
        spinner(s, WIDE_ROWS - 6, 1, *spin)
    prompt(s, WIDE_ROWS - 4, 1, TW - 2, prompt_text)
    return s


def narrow(entries, band_rows, spin=None, prompt_text=""):
    s = Screen(NARROW_COLS, NARROW_ROWS)
    top_band = NARROW_ROWS - 4 - band_rows
    # draw transcript then keep only what fits above the spinner/band
    tmp = Screen(NARROW_COLS, 200)
    end = transcript(tmp, 1, NARROW_COLS - 2, entries, top=0)
    avail = top_band - (2 if spin else 1)
    start = max(0, end - avail)
    for r in range(avail):
        s.g[r] = tmp.g[start + r][:]
    if spin:
        spinner(s, top_band - 2, 1, *spin)
    prompt(s, NARROW_ROWS - 4, 1, NARROW_COLS - 2, prompt_text)
    return s, top_band


def section(s, r, title, right=None, x=PX, w=PW):
    s.put(r, x, title.upper(), "dim b")
    s.put(r, x + len(title) + 1, "─" * (w - len(title) - 1 - (len(right) + 2 if right else 0)), "faint")
    if right:
        s.rput(r, x + w, right, "dim")


# ===================================================================== A: instrument panel
def commit_row(s, r, x, w, sha, step, tid):
    g, st = {"red": ("■", "err"), "green": ("■", "ok"), "covered": ("◌", "cyan"),
             "placeholders": ("·", "dim")}[step]
    c = s.seq(r, x, [(sha, "claude"), (" ", ""), (g, st), (" ", "")])
    s.put(r, c, tid or "placeholders", "" if tid else "dim", w=x + w - c)


def recent(s, r, ev):
    section(s, r, "recent", right="newest first")
    for i, (t, g, st, txt, det) in enumerate(ev):
        s.seq(r + 1 + i, PX + 1, [(f"{mmss(t):>5}  ", "dim"), (g + " ", st), (txt, "" if i else "b")])
        s.put(r + 1 + i, PX + 66, det, "dim")


def a_running():
    s = wide(T_G1_RUN, spin=("Running workflow", "1m 55s"))
    r = 2
    s.fill(r, PX, PW, " ", "bg-sel")
    s.seq(r, PX, [(" ● RUNNING ", "bg-sel claude b"), (" code-tdd · RED · implement-tests", "bg-sel b")])
    s.rseq(r, END, [("1:55", "bg-sel fg b"), (" elapsed · ", "bg-sel dim"), ("12", "bg-sel fg b"),
                    (" agents · ", "bg-sel dim"), ("4", "bg-sel fg b"), (" commits ", "bg-sel dim")])
    s.seq(r + 1, PX + 1, [("needs you: ", "dim"), ("no", "ok b"), ("  ·  last event 5s ago: RED implement-tests started", "dim")])
    r = 5
    s.put(r, PX + 1, "TASK", "dim b")
    for i, ln in enumerate(wrap(BUG_TASK, PW - 18)):
        s.put(r + i, PX + 7, ("bug_fix  " if i == 0 else "         ") + ln, "" if i else "")
    s.put(r, PX + 7, "bug_fix", "blue")
    s.put(r + 2, PX + 1, "PLAN", "dim b")
    s.put(r + 2, PX + 7, "no plan: a single task, no tracer tree", "dim")

    # stages and now
    r = 9
    lw = 50
    s.box(r, PX, 7, lw, "stages")
    rows = [("✓", "ok", "code-scenarios", "8.0s", "G:scenarios · auto"),
            ("▸", "claude", "code-tdd", "1:05", "attempt 1"),
            ("○", "dim", "code-safety-net", "", ""),
            ("○", "dim", "G:task-end", "", "")]
    for i, (g, st, name, t, note) in enumerate(rows):
        rr = r + 1 + i
        s.put(rr, PX + 2, g, st)
        s.put(rr, PX + 4, name, "b" if st == "claude" else ("" if st == "ok" else "dim"))
        s.rput(rr, PX + 25, t, "dim")
        s.put(rr, PX + 27, note, "dim")
    s.put(r + 5, PX + 2, "policy auto · from permission_mode", "faint")

    nx, nw = PX + lw + 1, PW - lw - 1
    s.box(r, nx, 7, nw, "now")
    s.seq(r + 1, nx + 2, [(" RED ", "bg-errbg err b"), ("  implement-tests  ", "b"), ("r1", "dim")])
    s.rput(r + 1, nx + nw - 2, "5.1s", "fg")
    s.put(r + 2, nx + 2, "zero-percent-original-price", "")
    s.put(r + 3, nx + 2, "tests/test_discount.py::test_zero_percent_returns_original_price", "dim", w=nw - 4)
    s.seq(r + 5, nx + 2, [("next ", "dim"), ("runner: must fail, or the test is marked covered", "dim")])

    # tests strip
    r = 17
    s.box(r, PX, 8, PW, "tests", right="RED → GREEN → REFACTOR")
    hx = [PX + 2, PX + 36, PX + 56, PX + 76, PX + 92]
    for x, h in zip(hx, ["test id", "RED", "GREEN", "REFACTOR", ""]):
        s.put(r + 1, x, h, "dim")
    T = [
        ("ten-percent-off-100-returns-90", [("✓ 7.9s exit 1", "err"), ("✓ 8.1s exit 0", "ok"), ("–", "faint")], ""),
        ("discount-non-round-price", None, "covered: already passed after ten-percent-off-100-returns-90"),
        ("zero-percent-original-price", [("▸ 5.1s", "claude b"), ("", ""), ("", "")], ""),
        ("hundred-percent-returns-zero", [("·", "faint"), ("·", "faint"), ("·", "faint")], ""),
    ]
    for i, (tid, cells, note) in enumerate(T):
        rr = r + 2 + i
        s.put(rr, hx[0], tid, "b" if cells and cells[0][0].startswith("▸") else "")
        if cells is None:
            s.put(rr, hx[1], "◌ " + note, "cyan")
        else:
            for x, (txt, st) in zip(hx[1:4], cells):
                if txt.startswith("✓"):
                    s.put(rr, x, "██", st)
                    s.put(rr, x + 3, txt, st)
                elif txt.startswith("▸"):
                    s.put(rr, x, "▓▓", "claude")
                    s.put(rr, x + 3, txt[2:], "claude b")
                else:
                    s.put(rr, x, txt, st)
    s.put(r + 6, PX + 2, "bug_fix runs show no REFACTOR step · 2 of 4 tests settled · 1 covered", "faint")

    # bottom row
    r = 26
    w1, w2 = 36, 24
    w3 = PW - w1 - w2 - 2
    s.box(r, PX, 9, w1, "lenses · findings")
    s.put(r + 1, PX + 2, "tdd: one reviewer, no lens round", "dim")
    s.put(r + 2, PX + 2, "safety-net next:", "dim")
    s.put(r + 3, PX + 4, "code · tests · corpus", "mu")
    s.seq(r + 5, PX + 2, [("survivors ", "dim"), ("–", "faint"), ("  refuted ", "dim"), ("–", "faint")])
    s.seq(r + 6, PX + 2, [("unrefuted ", "dim"), ("–", "faint"), ("  rollbacks ", "dim"), ("0", "")])

    x2 = PX + w1 + 1
    s.box(r, x2, 9, w2, "spend")
    for i, (k, v, st) in enumerate([("agents", "12", "b"), ("time", "1:55", "b"),
                                    ("tokens", "412k", "mu"), ("cost", "≈ $1.10", "mu"),
                                    ("attempt", "1 of stage", "")]):
        s.put(r + 1 + i, x2 + 2, k, "dim")
        s.put(r + 1 + i, x2 + 10, v, st)

    x3 = x2 + w2 + 1
    s.box(r, x3, 9, w3, "commits", right="base 0a62140")
    C = [("3aaba6a", "covered", "discount-non-round-price"),
         ("96ae092", "green", "ten-percent-off-100-returns-90"),
         ("0c68372", "red", "ten-percent-off-100-returns-90"),
         ("52cead9", "placeholders", "")]
    for i, (sha, step, tid) in enumerate(C):
        commit_row(s, r + 1 + i, x3 + 2, w3 - 4, sha, step, tid)
    s.seq(r + 6, x3 + 2, [("unit ", "dim"), ("local · no PR · waits for G:publish", "mu")])
    s.seq(r + 7, x3 + 2, [("■", "err"), (" red ", "dim"), ("■", "ok"), (" green ", "dim"), ("◌", "cyan"), (" covered", "dim")])

    recent(s, 36, [(109.9, "▸", "err", "RED implement-tests zero-percent-original-price r1", "spawned"),
          (107.3, "◆", "cyan", "3aaba6a covered discount-non-round-price", "runner exit 0: it already passes"),
          (94.7, "▸", "err", "RED implement-tests discount-non-round-price r1", "spawned"),
          (92.3, "◆", "ok", "96ae092 green ten-percent-off-100-returns-90", "runner exit 0"),
          (78.2, "◆", "err", "0c68372 red ten-percent-off-100-returns-90", "runner exit 1, fails as it should")])
    s.put(43, PX + 1, "redraws only on agent.spawn, StructuredOutput and ledger.json changes · no motion without an event", "faint")
    return s


def a_done():
    s = wide(T_NF6_DONE)
    r = 2
    s.fill(r, PX, PW, " ", "bg-okbg")
    s.seq(r, PX, [(" ✓ DONE ", "bg-okbg ok b"), ("  order_total · new_feature · 3 stages passed", "bg-okbg b")])
    s.rseq(r, END, [("3:46", "bg-okbg fg b"), (" · ", "bg-okbg dim"), ("16", "bg-okbg fg b"), (" agents · ", "bg-okbg dim"),
                    ("5", "bg-okbg fg b"), (" commits ", "bg-okbg dim")])
    s.seq(r + 1, PX + 1, [("needs you: ", "dim"), ("no", "ok b"), ("  ·  pb task end ok · run state removed", "dim")])

    # plan tree (made up)
    r = 5
    lw = 50
    s.box(r, PX, 9, lw, "plan", right="cart-pricing.md")
    P = [("✓", "ok", "T1  Line totals", ""),
         ("✓", "ok", "  Task 1  line_total with VAT", ""),
         ("▸", "claude", "T2  Order total", ""),
         ("✓", "ok", "  Task 2  order_total", "this run"),
         ("○", "dim", "  Task 3  discount on whole order", ""),
         ("○", "dim", "T3  Checkout", ""),
         ]
    for i, (g, st, txt, note) in enumerate(P):
        s.put(r + 1 + i, PX + 2, g, st)
        s.put(r + 1 + i, PX + 4, txt, "mu" if not note else "mu b")
        if note:
            s.rput(r + 1 + i, PX + lw - 2, note, "claude")
    s.put(r + 7, PX + 2, "2 of 3 tasks · tracer T2 open", "mu")

    nx, nw = PX + lw + 1, PW - lw - 1
    s.box(r, nx, 9, nw, "stages")
    rows = [("✓", "code-scenarios", "5.8s", "G:scenarios · auto"),
            ("✓", "code-tdd", "1:47", "1 test · 5 commits"),
            ("✓", "code-safety-net", "8.6s", "full suite green · 340 ms"),
            ("✓", "G:task-end", "", "passed · auto"),
            ]
    for i, (g, name, t, note) in enumerate(rows):
        s.put(r + 1 + i, nx + 2, g, "ok")
        s.put(r + 1 + i, nx + 4, name)
        s.rput(r + 1 + i, nx + 25, t, "dim")
        s.put(r + 1 + i, nx + 27, note, "dim")
    s.put(r + 6, nx + 2, "docs: update-documentation made no change", "dim")
    s.put(r + 7, nx + 2, "policy auto · from permission_mode", "faint")

    r = 15
    s.box(r, PX, 6, PW, "tests", right="RED → GREEN → REFACTOR")
    hx = [PX + 2, PX + 36, PX + 56, PX + 76]
    for x, h in zip(hx, ["test id", "RED", "GREEN", "REFACTOR"]):
        s.put(r + 1, x, h, "dim")
    s.put(r + 2, hx[0], "order-total-example-sums-lines")
    s.seq(r + 2, hx[1], [("██ ", "err"), ("✓ 16.3s exit 1", "err")])
    s.seq(r + 2, hx[2], [("██ ", "ok"), ("✓ 8.0s exit 0", "ok")])
    s.seq(r + 2, hx[3], [("██ ", "blue"), ("✓ tests 9.2s · code 9.8s", "blue")])
    s.put(r + 3, hx[0], "tests/test_cart.py::test_order_total_sums_line_totals", "dim")
    s.put(r + 3, hx[3], "pytest 333 ms green", "dim")

    r = 22
    w1, w2 = 36, 24
    w3 = PW - w1 - w2 - 2
    s.box(r, PX, 9, w1, "lenses · findings")
    s.put(r + 1, PX + 2, "safety-net: code · tests ·", "mu")
    s.put(r + 2, PX + 2, "corpus misalignment", "mu")
    s.seq(r + 4, PX + 2, [("survivors ", "dim"), ("1", "mu"), ("  refuted ", "dim"), ("2", "mu")])
    s.seq(r + 7, PX + 2, [("unrefuted ", "dim"), ("0", "mu")])
    s.seq(r + 5, PX + 2, [("course checker ", "dim"), ("better ×1", "mu")])
    s.seq(r + 6, PX + 2, [("rollbacks ", "dim"), ("0", "mu"), ("  attempts ", "dim"), ("2 of 5", "mu")])

    x2 = PX + w1 + 1
    s.box(r, x2, 9, w2, "spend")
    for i, (k, v, st) in enumerate([("agents", "16", "b"), ("time", "3:46", "b"),
                                    ("tokens", "806k", "mu"), ("cost", "≈ $2.15", "mu"),
                                    ("attempt", "1 per stage", "")]):
        s.put(r + 1 + i, x2 + 2, k, "dim")
        s.put(r + 1 + i, x2 + 10, v, st)

    x3 = x2 + w2 + 1
    s.box(r, x3, 9, w3, "commits", right="base " + NF6_BASE)
    for i, (_, sha, step, msg) in enumerate(reversed(NF6_COMMITS)):
        if msg:
            typ, rest = msg.split(": ", 1)
            st = {"feat": "ok", "test": "blue", "refactor": "blue"}[typ]
            s.seq(r + 1 + i, x3 + 2, [(sha, "claude"), ("  ", ""), (f"{typ:<9}", st)])
            s.put(r + 1 + i, x3 + 21, rest, "", w=w3 - 22)
        else:
            s.seq(r + 1 + i, x3 + 2, [(sha, "claude"), ("  ", ""), (f"{step} checkpoint", "err" if step == "red" else "dim")])
    s.seq(r + 7, x3 + 2, [("unit ", "dim"), ("local · no PR yet · G:publish next", "mu")])
    recent(s, 32, [(221.9, "✓", "ok", "pb task end", "ok · run state removed"),
                   (219.2, "✓", "ok", "G:task-end passed", "auto"),
                   (210.8, "✓", "ok", "code-safety-net done", "pytest tests -q green · 340 ms"),
                   (183.8, "◆", "blue", "1e94ffb refactor: Refactor line_total to name VAT …", "refactor-code checkpoint"),
                   (161.8, "◆", "blue", "a30ee1d test: Tidy order_total example test imports …", "refactor-tests checkpoint")])
    return s


def a_needs_wide(theme_note=False):
    s = wide(T_E1_NH)
    r = 2
    for rr in (2, 3, 4):
        s.fill(rr, PX, PW, " ", "bg-warnbg")
    s.seq(r, PX, [(" ◆ NEEDS YOU ", "bg-warn ink b"), ("  G:task-end is held", "bg-warnbg warn b")])
    s.rseq(r, END, [("3:14", "bg-warnbg fg b"), (" · ", "bg-warnbg dim"), ("15", "bg-warnbg fg b"),
                    (" agents · ", "bg-warnbg dim"), ("6", "bg-warnbg fg b"), (" commits ", "bg-warnbg dim")])
    s.put(r + 1, PX + 2, "these returns carry an open ambiguity:", "bg-warnbg fg")
    s.seq(r + 2, PX + 2, [("hundred-percent-makes-free", "bg-warnbg b"), ("  and  ", "bg-warnbg dim"),
                          ("non-round-result", "bg-warnbg b"), ("   (implement-tests r1)", "bg-warnbg dim")])
    s.seq(r + 4, PX + 1, [("answer in the chat · ", "dim"), ("the run waits; nothing is lost", "dim")])

    r = 8
    s.put(r, PX + 1, "TASK", "dim b")
    for i, ln in enumerate(wrap(BUG_TASK, PW - 18)):
        s.put(r + i, PX + 7, ("bug_fix  " if i == 0 else "         ") + ln)
    s.put(r, PX + 7, "bug_fix", "blue")

    r = 11
    lw = 50
    s.box(r, PX, 7, lw, "stages")
    rows = [("✓", "ok", "code-scenarios", "11.7s", "G:scenarios · auto"),
            ("✓", "ok", "code-tdd", "1:34", "4 tests · 6 commits"),
            ("✓", "ok", "code-safety-net", "8.4s", "full suite green"),
            ("◆", "warn", "G:task-end", "", "held · open ambiguity")]
    for i, (g, st, name, t, note) in enumerate(rows):
        s.put(r + 1 + i, PX + 2, g, st)
        s.put(r + 1 + i, PX + 4, name, "warn b" if st == "warn" else "")
        s.rput(r + 1 + i, PX + 25, t, "dim")
        s.put(r + 1 + i, PX + 27, note, "warn" if st == "warn" else "dim")
    s.put(r + 5, PX + 2, "policy auto · ambiguity overrides it", "faint")

    nx, nw = PX + lw + 1, PW - lw - 1
    s.box(r, nx, 7, nw, "gate")
    s.seq(r + 1, nx + 2, [("gate    ", "dim"), ("G:task-end", "warn b")])
    s.seq(r + 2, nx + 2, [("source  ", "dim"), ("returns with an open ambiguity", "")])
    s.seq(r + 3, nx + 2, [("files   ", "dim"), ("code-tdd.implement-tests.", "dim")])
    s.put(r + 4, nx + 10, "hundred-percent-makes-free.r1.a1.json", "dim")
    s.put(r + 5, nx + 10, "non-round-result.r1.a1.json", "dim")

    r = 19
    s.box(r, PX, 8, PW, "tests", right="RED → GREEN → REFACTOR")
    hx = [PX + 2, PX + 36, PX + 56, PX + 76]
    for x, h in zip(hx, ["test id", "RED", "GREEN", "REFACTOR"]):
        s.put(r + 1, x, h, "dim")
    s.put(r + 2, hx[0], "ten-percent-off-hundred")
    s.seq(r + 2, hx[1], [("██ ", "err"), ("✓ 9.3s exit 1", "err")])
    s.seq(r + 2, hx[2], [("██ ", "ok"), ("✓ 6.6s exit 0", "ok")])
    s.put(r + 2, hx[3], "–", "faint")
    for i, (tid, amb) in enumerate([("non-round-result", True), ("zero-percent-keeps-price", False),
                                    ("hundred-percent-makes-free", True)]):
        rr = r + 3 + i
        s.put(rr, hx[0], tid, "warn b" if amb else "")
        s.put(rr, hx[1], "◌ covered after ten-percent-off-hundred", "cyan")
        if amb:
            s.put(rr, hx[3] + 4, "◆ open ambiguity", "warn")
    s.put(r + 6, PX + 2, "4 tests settled · 3 covered · bug_fix runs show no REFACTOR step", "faint")

    r = 28
    w1, w2 = 36, 24
    w3 = PW - w1 - w2 - 2
    s.box(r, PX, 9, w1, "lenses · findings")
    s.put(r + 1, PX + 2, "safety-net: code · tests ·", "mu")
    s.put(r + 2, PX + 2, "corpus misalignment", "mu")
    s.seq(r + 4, PX + 2, [("survivors ", "dim"), ("0", "mu"), ("  refuted ", "dim"), ("1", "mu")])
    s.seq(r + 7, PX + 2, [("unrefuted ", "dim"), ("1", "mu")])
    s.seq(r + 5, PX + 2, [("course checker ", "dim"), ("–", "faint")])
    s.seq(r + 6, PX + 2, [("rollbacks ", "dim"), ("0", "mu"), ("  attempts ", "dim"), ("1 of 5", "mu")])
    x2 = PX + w1 + 1
    s.box(r, x2, 9, w2, "spend")
    for i, (k, v, st) in enumerate([("agents", "15", "b"), ("time", "3:14", "b"),
                                    ("tokens", "655k", "mu"), ("cost", "≈ $1.75", "mu"),
                                    ("waiting", "since 3:14", "")]):
        s.put(r + 1 + i, x2 + 2, k, "dim")
        s.put(r + 1 + i, x2 + 10, v, st)
    x3 = x2 + w2 + 1
    s.box(r, x3, 9, w3, "commits", right="base 459c607")
    C = [("e1a2142", "covered", "hundred-percent-makes-free"), ("4c75e16", "covered", "zero-percent-keeps-price"),
         ("be23e1b", "covered", "non-round-result"), ("1e730b0", "green", "ten-percent-off-hundred"),
         ("094df80", "red", "ten-percent-off-hundred"), ("cc3e021", "placeholders", "")]
    for i, (sha, step, tid) in enumerate(C):
        commit_row(s, r + 1 + i, x3 + 2, w3 - 4, sha, step, tid)
    s.seq(r + 7, x3 + 2, [("unit ", "dim"), ("local only · no PR", "mu")])
    recent(s, 38, [(194.1, "◆", "warn", "G:task-end held", "two returns carry an open ambiguity"),
                   (184.8, "✓", "ok", "code-safety-net done", "pytest tests -q green · 338 ms"),
                   (166.7, "✓", "ok", "code-tdd done", "4 tests · 6 commits"),
                   (162.7, "◆", "cyan", "e1a2142 covered hundred-percent-makes-free", "runner exit 0: it already passes"),
                   (147.6, "◆", "cyan", "4c75e16 covered zero-percent-keeps-price", "runner exit 0: it already passes")])
    return s


def a_band_needs():
    s, b = narrow(T_E1_NH, band_rows=4)
    # band body: rows b..b+3, width NARROW_COLS-4 (the [-] sits outside)
    bw = NARROW_COLS - 4
    for rr in range(b, b + 2):
        s.fill(rr, 0, bw, " ", "bg-warnbg")
    s.seq(b, 0, [(" ◆ NEEDS YOU ", "bg-warn ink b"), (" G:task-end held · open ambiguity in 2 returns", "bg-warnbg warn b")])
    s.rseq(b, bw, [("3:14 · 15 agents · 6 commits ", "bg-warnbg dim")])
    s.seq(b + 1, 1, [("hundred-percent-makes-free", "bg-warnbg b"), (", ", "bg-warnbg dim"),
                     ("non-round-result", "bg-warnbg b"), ("  · answer in the chat", "bg-warnbg dim")])
    s.seq(b + 2, 1, [("✓ scenarios ", "ok"), ("✓ tdd ", "ok"), ("✓ safety-net ", "ok"), ("◆ task-end", "warn b"),
                     ("   tests ", "dim"), ("██", "err"), ("██", "ok"), (" 1 red→green  ", "dim"),
                     ("◌◌◌", "cyan"), (" 3 covered", "dim")])
    s.seq(b + 3, 1, [("pb  ", "claude b"), ("bug_fix · discount.py · base 459c607 · ", "dim"),
                     ("≈ $1.75", "mu"), (" · local only", "mu")])
    band_mark(s, b)
    return s


# ===================================================================== B: flight recorder
def lane_chart(s, r0, spawns, t0, t1, x, w, now=None, commits=(), stop_t=None, lanes=None):
    """time axis + one lane per phase. Returns next row."""
    scale = w / (t1 - t0)

    def col(t):
        return x + int(round((t - t0) * scale))

    # axis
    s.put(r0, x - 11, "t", "dim")
    tick = 10
    t = (int(t0) // tick + 1) * tick
    marks = [m for m in (now, stop_t) if m is not None]
    while t < t1:
        c = col(t)
        if all(abs(c - col(m)) > 6 for m in marks):
            s.put(r0, c, mmss(t), "dim")
        t += tick
    lanes = lanes or ["scenarios", "setup", "RED", "GREEN", "REFACTOR", "verify", "safety-net"]
    lane_st = {"scenarios": "dim", "setup": "dim", "RED": "err", "GREEN": "ok", "REFACTOR": "blue",
               "verify": "dim", "safety-net": "claude"}
    for i, lane in enumerate(lanes):
        rr = r0 + 1 + i
        s.put(rr, x - 11, lane, lane_st[lane] + (" b" if lane in ("RED", "GREEN", "REFACTOR") else ""))
        s.put(rr, x, "┈" * w, "faint")
    for (st_t, dur, phase, role, tail) in spawns:
        if now is not None and st_t > now:
            continue
        end_t = st_t + dur if (now is None or st_t + dur <= now) else now
        rr = r0 + 1 + lanes.index(phase)
        c0, c1 = col(st_t), max(col(st_t) + 1, col(end_t))
        ch = "▒" if role == "runner" else "█"
        running = now is not None and st_t + dur > now
        for c in range(c0, min(c1, x + w)):
            s.put(rr, c, ch, lane_st[phase] if phase not in ("setup", "verify", "scenarios") else "fg")
        if running:
            s.put(rr, min(c1, x + w - 1), "▶", "claude b")
    # commit row
    cr = r0 + 1 + len(lanes)
    s.put(cr, x - 11, "commits", "dim")
    s.put(cr, x, "┈" * w, "faint")
    for (ct, sha, step, msg) in commits:
        s.put(cr, col(ct), "◆", "claude")
    if now is not None:
        c = col(now)
        for rr in range(r0 + 1, cr + 1):
            if s.g[rr][c][0] in "┈ ":
                s.put(rr, c, "│", "claude")
        s.put(r0, c - 1, "now", "claude b")
    if stop_t is not None:
        c = col(stop_t)
        for rr in range(r0 + 1, cr + 1):
            s.put(rr, c, "┃", "err b")
        s.put(r0, c - 2, "STOP", "err b")
    return cr + 1


def tape(s, r, events, x=PX, w=PW, max_rows=12):
    """events newest first: (t, glyph, glyph_st, text, detail)"""
    for i, (t, g, gst, text, detail) in enumerate(events[:max_rows]):
        rr = r + i
        ti = int(t)
        s.put(rr, x + 1, f"{ti // 60}:{ti % 60:02d}.{int(round((t - ti) * 10)) % 10}".rjust(7), "dim" if i else "fg")
        s.put(rr, x + 10, g, gst)
        c = s.put(rr, x + 12, text, "b" if i == 0 else "", w=56)
        s.put(rr, x + 70, detail, "dim", w=w - 70)
    return r + min(len(events), max_rows)


def b_running():
    now = 155.0
    s = wide(T_NF6_RUN, spin=("Running workflow", "2m 35s"))
    r = 2
    s.seq(r, PX, [("● ", "claude"), ("REFACTOR", "blue b"), (" · refactor-tests · order-total-example-sums-lines · 4.7s", "b")])
    s.rseq(r, END, [("2:35", "fg b"), ("  ·  ", "dim"), ("11 agents", "fg b"), ("  ·  ", "dim"), ("3 commits", "fg b")])
    s.seq(r + 1, PX, [("code-tdd 1:08 · attempt 1 · ", "dim"), ("needs you: no", "ok"),
                      (" · new_feature · order_total in cart.py", "dim")])
    section(s, 4, "flight", right="1:10 → now · 1 col ≈ 1s · █ agent  ▒ runner  ◆ commit")
    nxt = lane_chart(s, 5, NF6_SPAWNS, 70, 160, PX + 12, PW - 14, now=now,
                     commits=[c for c in NF6_COMMITS if c[0] <= now])
    r = nxt + 1
    section(s, r, "tape", right="newest first · every line is a recorded event")
    ev = [
        (150.3, "▸", "blue", "REFACTOR refactor-tests                 r1", "spawned"),
        (149.4, "✓", "blue", "REFACTOR identify-test-issues           r1", "6.6s"),
        (142.8, "▸", "blue", "REFACTOR identify-test-issues           r1", "spawned"),
        (141.9, "✓", "ok", "GREEN runner                            r2", "3.7s · exit 0"),
        (140.3, "◆", "claude", "commit e5e43a1 feat: Add order_total to sum line totals", "green checkpoint"),
        (136.3, "✓", "ok", "GREEN implement-code                    r1", "8.0s"),
        (126.2, "✓", "err", "RED runner                              r1", "3.2s · exit 1, fails as it should"),
        (124.6, "◆", "claude", "commit 6b4b1f6 red checkpoint", ""),
        (122.2, "✓", "err", "RED implement-tests                     r1", "16.3s"),
        (103.3, "◆", "claude", "commit 7badf99 placeholders checkpoint", ""),
        (101.1, "✓", "dim", "create-test-placeholders                r1", "9.8s"),
        (87.3, "▸", "dim", "stage code-tdd started", ""),
        (83.9, "✓", "ok", "G:scenarios passed", "auto · from permission_mode"),
        (77.5, "✓", "dim", "stage code-scenarios done", "5.8s"),
        (71.6, "▸", "dim", "stage code-scenarios started", ""),
        (62.5, "▸", "dim", "run opened · new_feature", "ledger seq 1"),
    ]
    r = tape(s, r + 1, ev, max_rows=16)
    r += 1
    section(s, r, "ledger", right="ledger.json seq 13")
    s.seq(r + 1, PX + 1, [("tests ", "dim"), ("order-total-example-sums-lines ", ""), ("R", "err b"), ("✓ ", "err"),
                          ("G", "ok b"), ("✓ ", "ok"), ("F", "blue b"), ("▸", "claude")])
    s.seq(r + 1, PX + 58, [("spend ", "dim"), ("11 agents", ""), (" · ", "dim"), ("tokens not recorded", "dim")])
    s.seq(r + 2, PX + 1, [("lenses ", "dim"), ("none in tdd (D8 lens map)", "dim")])
    s.seq(r + 2, PX + 58, [("base ", "dim"), (NF6_BASE, "claude"), (" · unit ", "dim"), ("local, unpublished", "mu")])
    return s


def b_stop():
    s = wide(T_P2_STOP)
    r = 2
    for rr in (2, 3):
        s.fill(rr, PX, PW, " ", "bg-errbg")
    s.seq(r, PX, [(" ■ STOPPED ", "bg-err ink b"), ("  code-tdd · step-failed past its retries", "bg-errbg err b")])
    s.rseq(r, END, [("2:20", "bg-errbg fg b"), ("  ·  16 agents  ·  3 commits ", "bg-errbg dim")])
    s.put(r + 1, PX + 1, "a re-run continues from tests{} · ten-percent-off-hundred is kept", "bg-errbg fg")
    s.seq(r + 2, PX + 1, [("zero-percent-keeps-full-price passed on RED r1, r2 and r3, so RED was refused 3 times", "warn")])
    section(s, 6, "flight", right="0:30 → stop · 1 col ≈ 1.2s · █ agent  ▒ runner  ◆ commit")
    commits = [(69.0, "9e70359", "placeholders", None), (81.8, "5643302", "red", None), (94.6, "2ae1fed", "green", None)]
    nxt = lane_chart(s, 7, P2_SPAWNS, 30, 145, PX + 12, PW - 14, commits=commits, stop_t=P2_STOP_T,
                     lanes=["scenarios", "setup", "RED", "GREEN"])
    # attempt labels on RED lane
    r = nxt + 1
    section(s, r, "the same step, three times")
    att = [("r1", 97.1, 10.470, 108.4, 3.167), ("r2", 112.3, 8.702, 121.8, 2.673), ("r3", 125.9, 8.608, 135.2, 2.607)]
    for i, (rn, a, ad, b, bd) in enumerate(att):
        rr = r + 1 + i
        s.seq(rr, PX + 1, [(f"{mmss(a)}  ", "dim"), ("RED ", "err b"), (f"{rn}  ", "b"),
                           ("implement-tests ", ""), (f"{ad:>5.1f}s", "dim"), ("   runner ", ""), (f"{bd:.1f}s", "dim"),
                           ("   exit 0 · 1 passed", "warn"), ("   ✗ not red", "err b")])
    s.put(r + 4, PX + 1, "every attempt wrote a test that already passes: the bug may already be fixed for 0%", "dim")
    r += 6
    section(s, r, "tape", right="newest first")
    ev = [
        (139.7, "■", "err", "stop: step-failed", "ledger seq 16"),
        (138.6, "▸", "dim", "runner                                  r3", "2.6s"),
        (137.8, "✗", "err", "RED runner zero-percent-keeps-full-price r3", "exit 0 · 1 passed"),
        (125.9, "▸", "err", "RED implement-tests zero-percent-…      r3", "spawned"),
        (124.5, "✗", "err", "RED runner zero-percent-keeps-full-price r2", "exit 0 · 1 passed"),
        (112.3, "▸", "err", "RED implement-tests zero-percent-…      r2", "spawned"),
        (111.6, "✗", "err", "RED runner zero-percent-keeps-full-price r1", "exit 0 · 1 passed"),
        (94.6, "◆", "claude", "commit 2ae1fed green ten-percent-off-hundred", ""),
    ]
    r = tape(s, r + 1, ev, max_rows=8)
    r += 1
    section(s, r, "ledger", right="ledger.json seq 16")
    s.seq(r + 1, PX + 1, [("stop ", "dim"), (P2_STOP, "err")])
    s.seq(r + 2, PX + 1, [("tests ", "dim"), ("ten-percent-off-hundred ", ""), ("R✓ G✓", "ok"),
                          ("   zero-percent-keeps-full-price ", ""), ("R✗ ×3", "err b"),
                          ("   retries{} empty", "dim")])
    s.seq(r + 3, PX + 1, [("stages ", "dim"), ("✓ code-scenarios 7.7s  ", "ok"), ("■ code-tdd stopped at 1:28  ", "err b"),
                          ("○ code-safety-net  ○ G:task-end", "faint")])
    s.seq(r + 4, PX + 1, [("spend ", "dim"), ("16 agents spawned · tokens not recorded", "")])
    return s


def b_band_stop():
    s, b = narrow(T_P2_STOP, band_rows=3)
    bw = NARROW_COLS - 4
    s.fill(b, 0, bw, " ", "bg-errbg")
    s.seq(b, 0, [(" ■ STOPPED ", "bg-err ink b"), (" code-tdd · step-failed past its retries", "bg-errbg err b")])
    s.rput(b, bw, "2:20 · 16 agents · 3 commits ", "bg-errbg dim")
    # mini flight strip: 0:30..2:20 over 70 cols
    x, w, t0, t1 = 12, 70, 30, 142
    s.put(b + 1, 1, "flight", "dim")
    for c in range(w):
        s.put(b + 1, x + c, "┈", "faint")
    st = {"scenarios": "fg", "setup": "dim", "RED": "err", "GREEN": "ok"}
    for (a, d, ph, role, tail) in P2_SPAWNS:
        c0 = x + int((a - t0) / (t1 - t0) * w)
        c1 = max(c0 + 1, x + int((a + d - t0) / (t1 - t0) * w))
        for c in range(c0, min(c1, x + w)):
            s.put(b + 1, c, "▒" if role == "runner" else "█", st[ph])
    s.put(b + 1, x + int((P2_STOP_T - t0) / (t1 - t0) * w), "┃", "err b")
    s.seq(b + 1, x + w + 2, [("R", "err b"), ("✗", "err"), ("R", "err b"), ("✗", "err"), ("R", "err b"), ("✗", "err"), (" ■", "err b")])
    s.seq(b + 2, 1, [("zero-percent-keeps-full-price ", "b"), ("passed on RED r1 r2 r3 (exit 0)", "warn"),
                     (" · re-run continues from tests{}", "dim")])
    band_mark(s, b)
    return s


# ===================================================================== C: glance
FONT = {
    "A": [".##.", "#..#", "####", "#..#", "#..#"], "C": [".###", "#...", "#...", "#...", ".###"],
    "D": ["###.", "#..#", "#..#", "#..#", "###."], "E": ["####", "#...", "###.", "#...", "####"],
    "F": ["####", "#...", "###.", "#...", "#..."], "N": ["#..#", "##.#", "#.##", "#..#", "#..#"],
    "O": [".##.", "#..#", "#..#", "#..#", ".##."], "R": ["###.", "#..#", "###.", "#.#.", "#..#"],
    "S": [".###", "#...", ".##.", "...#", "###."], "T": ["#####", "..#..", "..#..", "..#..", "..#.."],
    "U": ["#..#", "#..#", "#..#", "#..#", ".##."], "Y": ["#...#", ".#.#.", "..#..", "..#..", "..#.."],
    "G": [".###", "#...", "#.##", "#..#", ".###"], "M": ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
    " ": ["..", "..", "..", "..", ".."],
}


def bigtext(s, r, c, text, st):
    bm = ["", "", "", "", "", ""]
    for ch in text:
        g = FONT[ch]
        for i in range(5):
            bm[i] += g[i] + "."
    bm[5] = "." * len(bm[0])
    for row in range(3):
        top, bot = bm[row * 2], bm[row * 2 + 1]
        line = ""
        for a, b2 in zip(top, bot):
            line += {("#", "#"): "█", ("#", "."): "▀", (".", "#"): "▄", (".", "."): " "}[(a, b2)]
        s.put(r + row, c, line, st)
    return c + len(bm[0])


def c_band_running():
    s, b = narrow(T_NF6_RUN, band_rows=1, spin=("Running workflow", "2m 35s"))
    bw = NARROW_COLS - 4
    s.seq(b, 1, [("pb ", "claude b"), ("● ", "claude"), ("REFACTOR ", "blue b"), ("refactor-tests 4.7s", ""),
                 ("  ", ""), ("R", "err b"), ("✓", "err"), (" G", "ok b"), ("✓", "ok"), (" F", "blue b"), ("▸", "claude"),
                 ("   ", ""), ("2:35", "b"), (" · 11 agents · 3 commits", "dim")])
    s.rput(b, bw, "not needed ", "ok")
    band_mark(s, b)
    return s


def c_band_done():
    s, b = narrow(T_NF6_DONE, band_rows=1)
    bw = NARROW_COLS - 4
    s.seq(b, 1, [("pb ", "claude b"), ("✓ ", "ok b"), ("done ", "ok b"), ("order_total", ""),
                 ("  ", ""), ("R", "err b"), ("✓", "err"), (" G", "ok b"), ("✓", "ok"), (" F", "blue b"), ("✓", "blue"),
                 ("   ", ""), ("3:46", "b"), (" · 16 agents · ", "dim"), ("≈ $2.15", "mu"),
                 (" · 5 commits · suite green", "dim")])
    s.rput(b, bw, "local ", "mu")
    band_mark(s, b)
    return s


def c_wide_needs():
    s = wide(T_C1_NH)
    x = PX + 4
    r = 5
    bigtext(s, r - 1, x + 3, "NEEDS YOU", "warn")
    s.put(r + 4, x + 3, "G:scenarios is held: the scenarios return carries an open ambiguity.", "b")
    s.put(r + 5, x + 3, "Answer in the chat. Nothing is written or committed until you do.", "dim")

    r = 14
    s.put(r, x + 3, "─" * 60, "faint")
    facts = [("waiting since", "0:52", "b"), ("spent", "2 agents · 0:52", ""),
             ("cost", "≈ $0.21", "mu"), ("commits", "none yet", "dim"), ("policy", "auto · from permission_mode", "dim")]
    for i, (k, v, st) in enumerate(facts):
        s.put(r + 1 + i, x + 3, k, "dim")
        s.put(r + 1 + i, x + 19, v, st)

    r = 22
    s.put(r, x + 3, "─" * 60, "faint")
    s.put(r + 1, x + 3, "where it is", "dim")
    stages = [("✓", "ok", "code-scenarios"), ("◆", "warn b", "G:scenarios"), ("○", "faint", "code-tdd"),
              ("○", "faint", "code-safety-net"), ("○", "faint", "G:task-end")]
    c = x + 3
    for i, (g, st, name) in enumerate(stages):
        c = s.put(r + 2, c, g + " ", st)
        c = s.put(r + 2, c, name, "warn b" if "warn" in st else ("" if st == "ok" else "faint"))
        if i < len(stages) - 1:
            c = s.put(r + 2, c, "  ─  ", "faint")
    s.put(r + 4, x + 3, "file  code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1.json", "dim")

    s.put(WIDE_ROWS - 2, x + 3, "quiet until something changes · press d for the full dashboard", "faint")
    return s


def c_band_needs_unused():
    pass


# ===================================================================== render
IMAGES = [
    ("A1-panel-wide-running", a_running, "dark",
     "A1 · Instrument panel · wide pane · running TDD cycle",
     "g-open-1 at 1:55: second-to-last RED in flight, one test red→green, one covered.",
     ["Made up (dotted underline): tokens, cost, the safety-net lens names as active lenses, unit/publish line.",
      "Real: test ids, exit codes, step durations, commits and base, stage times, policy source, agent count (counted from spawns; the ledger's spend only moves at stage end).",
      "Transcript tool rows use real names and durations; their exact formatting is illustrative."], 120),
    ("A2-panel-wide-done", a_done, "dark",
     "A2 · Instrument panel · wide pane · finished task",
     "t52-nf-6 after pb task end: new_feature with the full RED → GREEN → REFACTOR cycle.",
     ["Made up: the whole plan tree (recorded runs had no plan), lens findings, course checker, attempts, tokens, cost, publish line.",
      "Real: stage times, test id and selector, step durations, all five commits with messages, base 6890fbb, 340 ms suite, docs no-op.",
      "The closing chat paragraph is illustrative."], 110),
    ("A3-panel-band-needs-you", a_band_needs, "dark",
     "A3 · Instrument panel · narrow AbovePrompt band · needs-human gate",
     "e-open-1 at 3:14: G:task-end held because two returns carry an open ambiguity.",
     ["Made up: cost, the 'local only' unit state.",
      "Real: gate, reason, test ids, 15 agents, 6 commits, base 459c607, 1 red→green and 3 covered tests."], 90),
    ("B1-recorder-wide-running", b_running, "dark",
     "B1 · Flight recorder · wide pane · running TDD cycle",
     "t52-nf-6 at 2:35: every bar is a real spawn placed on its real start time and length.",
     ["Made up: the unit/publish note only. Tokens shown as not recorded, which is what the ledger says today.",
      "Real: all bar positions and lengths, tape times, commits, ledger seq."], 90),
    ("B2-recorder-wide-stop", b_stop, "dark",
     "B2 · Flight recorder · wide pane · stop",
     "probe-2 at 2:20: code-tdd stops after RED r1–r3 each wrote a test that already passed.",
     ["Made up: nothing in the pane. The one-line reading of why ('the bug may already be fixed for 0%') is an interpretation.",
      "Real: stop reason text, attempt times, exit 0 / 1 passed, commits, 16 spawned agents."], 90),
    ("B3-recorder-band-stop", b_band_stop, "dark",
     "B3 · Flight recorder · narrow AbovePrompt band · stop",
     "probe-2: the same stop as B2 squeezed to three rows, with the flight compressed to one strip.",
     ["Real: every block on the strip, the stop point, the counts."], 70),
    ("C1-glance-band-running", c_band_running, "dark",
     "C1 · Glance · narrow AbovePrompt band · running TDD cycle",
     "t52-nf-6 at 2:35: one row: what, is it moving (4.7s on this step), does it need me, what has it spent.",
     ["Real: phase, step, step age, strip, time, agents, commits. The 'not needed' wording is a design choice."], 92),
    ("C2-glance-wide-needs-you", c_wide_needs, "dark",
     "C2 · Glance · wide pane · needs-human gate",
     "covered-open-1 at 0:52: G:scenarios held before any test is written. The pane says one thing, loudly.",
     ["Made up: cost, the 'press d' key.",
      "Real: gate, reason, file name, stage order, 0:52, 2 spawned agents (the ledger counts 1), no commits."], 90),
    ("C3-glance-band-done", c_band_done, "dark",
     "C3 · Glance · narrow AbovePrompt band · finished task",
     "t52-nf-6 done: the band shrinks to one calm row once nothing is happening.",
     ["Made up: cost and 'local' publish state.", "Real: strip, 3:46, 16 agents, 5 commits, green suite."], 92),
    ("L1-panel-wide-needs-you-light", a_needs_wide, "light",
     "L1 · Instrument panel · wide pane · needs-human gate · light theme",
     "e-open-1 at 3:14, the strongest direction in the light theme: the hold is the loudest thing on screen.",
     ["Made up: tokens, cost, lens names and finding counts, attempts, unit line.",
      "Real: gate, both ambiguous returns, test ids, exit codes and durations, covered tests, commits, base 459c607, stage times."], 100),
]


def main(only=None):
    os.makedirs(OUT, exist_ok=True)
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    for name, fn, theme, title, cap, notes, caph in IMAGES:
        if only and not any(o in name for o in only):
            continue
        s = fn()
        doc, W, H = page(s, theme, title, f"<div>{cap}</div>", notes, caph=caph)
        hp = os.path.abspath(os.path.join(OUT, name + ".html"))
        open(hp, "w").write(doc)
        png = os.path.abspath(os.path.join(OUT, name + ".png"))
        subprocess.run([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        f"--window-size={W},{H}", "--force-device-scale-factor=2",
                        f"--screenshot={png}", "file://" + hp], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(name, W, H)


if __name__ == "__main__":
    main(sys.argv[2:] or None)
