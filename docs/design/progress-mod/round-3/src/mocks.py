"""Round 3: the five questions (where, spent, remaining, circles, deviating), band first, plus planning.

Run: python3 src/mocks.py <outdir> [name-filter ...]
Builds on base.py (round 2's generator, unchanged).
"""
import os
import subprocess
import sys

from lib import Screen, page
from cc import transcript, spinner, prompt, band_mark, wrap
from data import BUG_TASK, BUG_TASK_SHORT
from base import (screen, button, status, task_lines, stages_box, focus_test, ROWS,
                  T_G1_RUN)

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
BAND_COLS, BAND_ROWS = 128, 26

# ------------------------------------------------------------------ transcripts
T_P2_R3 = [
    ("user", "/pairingbuddy:code " + BUG_TASK_SHORT),
    ("tool", "Skill", "pairingbuddy:coding", "Successfully loaded skill", "ok"),
    ("tool", "pairingbuddy:curate-guidance", "Curate guidance before bug fix", "Done (6.0s)", "ok"),
    ("tool", "pairingbuddy:classify-task", "Classify the discount bug task", "Done (5.5s)", "ok"),
    ("tool", "Workflow", "pairingbuddy:code-scenarios", "Done · 2 agents · 10.2s", "ok"),
    ("tool", "Workflow", "pairingbuddy:code-tdd",
     ["implement-tests: pb1 code-tdd RED implement-tests", "zero-percent-keeps-full-price r3"], "run"),
]
PLAN_ASK = ("Rework the coding and planning paths onto deterministic workflow scripts, so stage order, "
            "gates and test evidence don't rest on a model's word")
T_PLAN_Q2 = [
    ("user", "/pairingbuddy:plan " + PLAN_ASK),
    ("tool", "Skill", "pairingbuddy:planning", "Successfully loaded skill", "ok"),
    ("tool", "pairingbuddy:curate-guidance", "Curate guidance before planning", "Done (9.2s)", "ok"),
    ("say", "Q1 is settled: auto mode passes continue gates and always stops on ambiguity or repeated failure."),
    ("say", "Q2. How much adversarial review should each stage get? A full PR-review lens round everywhere "
            "is expensive. The alternative is a lens list that each stage owns, sized to what it can break."),
    ("say", "Options: 1. One full round at every stage · 2. A lens list per stage (recommended) · "
            "3. Lenses only at task end"),
]
T_PLAN_LATE = [
    ("user", "/pairingbuddy:plan " + PLAN_ASK),
    ("tool", "Skill", "pairingbuddy:planning", "Successfully loaded skill", "ok"),
    ("tool", "Workflow", "pairingbuddy:plan-requirements", "Done · 9 agents · 6m 12s", "ok"),
    ("tool", "Workflow", "pairingbuddy:plan-architecture", "Done · 14 agents · 11m 40s", "ok"),
    ("say", "G:architecture passed. The course checker rolled back one fix as wrong-direction, and the retry kept "
            "the run directory per worktree. Moving on to tracer bullets."),
    ("tool", "Workflow", "pairingbuddy:plan-tracers", ["lens: pb1 plan-tracers - lens pr-fit - r1"], "run"),
]


# ------------------------------------------------------------------ band
def band_screen(entries, spin=None):
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
    return s, b


def band(s, b, parts, tone=None):
    bw = BAND_COLS - 4
    n = sum(len(t) for t, _ in parts)
    assert n <= bw - 9, (n, bw)
    if tone:
        s.fill(b, 0, bw, " ", tone)
        parts = [(t, (st + " " + tone).strip()) for t, st in parts]
    s.seq(b, 1, parts)
    s.rseq(b, bw, [(" ▸ pane ", "bg-sel fg b")])
    band_mark(s, b)


SEP = (" │ ", "faint")


# ------------------------------------------------------------------ at a glance
def glance(s, p, r, rows, title="at a glance"):
    """rows: (label, parts, extra_lines, label_style). Returns next row."""
    h = 2 + sum(1 + len(x[2]) for x in rows)
    s.box(r, p.x, h, p.w, title)
    rr = r + 1
    for label, parts, extra, lst in rows:
        s.put(rr, p.x + 2, label, lst)
        s.seq(rr, p.x + 14, parts)
        rr += 1
        for ex in extra:
            s.seq(rr, p.x + 14, ex)
            rr += 1
    return r + h


def footer_commit(s, p, sha, txt):
    r = ROWS - 2
    s.put(r - 1, p.x, "─" * p.w, "faint")
    c = s.put(r, p.x + 1, sha + " ", "faint")
    s.put(r, c, txt, "faint", w=p.end - c - 1)


def footer_text(s, p, txt):
    r = ROWS - 2
    s.put(r - 1, p.x, "─" * p.w, "faint")
    s.put(r, p.x + 1, txt, "faint")


# ===================================================================== TDD
def r3_1():
    s, b = band_screen(T_G1_RUN, spin=("Running workflow", "1m 55s"))
    band(s, b, [("pb ", "claude b"), ("● ", "claude"), ("RED ", "err b"), ("test 3/4", "fg"), SEP,
                ("spent ", "dim"), ("1:55 · 12 agents · ", "fg"), ("≈0.4%", "fg mu"), SEP,
                ("left ", "dim"), ("1 test, 2 stages", "fg"), SEP,
                ("↻ 0", "ok"), ("  ", ""), ("⚠ 0", "dim"), SEP, ("needs you: ", "dim"), ("no", "ok b")])
    return s


def r3_2():
    s, b = band_screen(T_P2_R3, spin=("Running workflow", "2m 10s"))
    band(s, b, [("pb ", "claude b"), ("● ", "claude"), ("RED ", "err b"), ("test 2/2", "fg"), SEP,
                ("spent ", "dim"), ("2:10 · 14 agents · ", "fg"), ("≈0.5%", "fg mu"), SEP,
                ("left ", "dim"), ("2 stages", "fg"), SEP,
                (" ↻ RED ×3 · last try ", "bg-warn ink b"), ("  ", ""), ("⚠ 1", "warn b mu"), SEP,
                ("needs you: ", "dim"), ("soon", "warn b")])
    return s


def tdd_calm_glance(s, p, r):
    return glance(s, p, r, [
        ("WHERE", [("code-tdd", "b"), (" · ", "dim"), ("RED", "err b"), (" · implement-tests · ", "dim"),
                   ("test 3 of 4", "b"), ("  ·  stage 2 of 4", "dim")], [], "dim b"),
        ("SPENT", [("12 agents", "fg"), (" · ", "dim"), ("1:55", "fg"), (" · ", "dim"), ("412k tokens", "fg mu"),
                   (" · ", "dim"), ("≈ 0.4% of plan", "fg mu")], [], "dim b"),
        ("REMAINING", [("1 test", "fg"), (" after this, then ", "dim"), ("2 stages", "fg"),
                       ("  ·  step try ", "dim"), ("1 of 3", "fg"), ("  ·  stage attempt ", "dim"), ("1 of 5", "fg"),
                       ("  ·  rollbacks ", "dim"), ("0", "fg")], [], "dim b"),
        ("CIRCLES", [("↻ 0", "ok b"), ("   ", ""), ("1 ", "dim"), ("R", "err b"), ("●", "err"), ("G", "ok b"), ("●", "ok"),
                     ("   2 ", "dim"), ("◌", "cyan"), ("   3 ", "dim"), ("R", "err b"), ("▸", "claude b"),
                     ("   4 ", "dim"), ("·", "faint"), ("     every step on its first try", "dim")], [], "dim b"),
        ("DEVIATING", [("nothing", "ok b"), ("   files touched: ", "dim"), ("discount.py, test_discount.py", "dim mu"),
                       ("  ·  no test edited after its GREEN", "dim")], [], "dim b"),
    ])


def r3_3():
    s, p = screen(T_G1_RUN, 109, spin=("Running workflow", "1m 55s"))
    status(s, p, "●", "RUNNING", "code-tdd · RED · implement-tests", "1:55",
           note="last event 5s ago: RED implement-tests started")
    r = task_lines(s, p, 5, "bug_fix", BUG_TASK) + 1
    r = tdd_calm_glance(s, p, r) + 1
    rows = [("done", "code-scenarios", "8.0s", "G:scenarios · auto"),
            ("now", "code-tdd", "1:05", "RED · test 3 of 4"),
            ("todo", "code-safety-net"), ("todo", "G:task-end")]
    r = stages_box(s, p, r, rows) + 1
    done = [("✓ 2 done", "ok"), ("  ·  1 red → green  ·  ", "dim"), ("◌ 1 covered", "cyan")]
    focus_test(s, p, r, "test 3 of 4", done, "show 2", "zero-percent-original-price",
               "A 0% discount leaves the price as it was: apply_discount(100, 0) returns 100.",
               "tests/test_discount.py::test_zero_percent_returns_original_price",
               [("RED", "now", "implement-tests r1 · 5.1s"), ("GREEN", "todo", "implement-code"),
                ("REFACTOR", "na", "not part of bug_fix")],
               "next: the runner must fail, or the test is marked covered", "hundred-percent-returns-zero", "5.1s")
    c = button(s, ROWS - 4, p.x + 1, "s", "suggest")
    s.put(ROWS - 4, c + 2, "a note the next agent reads when it starts", "faint")
    s.rput(ROWS - 4, p.end, "− band only", "faint")
    footer_commit(s, p, "3aaba6a", "covered discount-non-round-price")
    return s


def r3_4():
    s, p = screen(T_P2_R3, 109, spin=("Running workflow", "2m 10s"))
    status(s, p, "●", "RUNNING", "code-tdd · RED · implement-tests r3", "2:10",
           needs=("soon", "warn b"), note="if RED r3 also passes, the run stops: step-failed")
    r = task_lines(s, p, 5, "bug_fix", BUG_TASK_SHORT) + 1
    W = "warn b"
    r = glance(s, p, r, [
        ("WHERE", [("code-tdd", "b"), (" · ", "dim"), ("RED", "err b"), (" · implement-tests r3 · ", "dim"),
                   ("test 2 of 2", "b"), ("  ·  stage 2 of 4", "dim")], [], "dim b"),
        ("SPENT", [("14 agents", "fg"), (" · ", "dim"), ("2:10", "fg"), (" · ", "dim"), ("498k tokens", "fg mu"),
                   (" · ", "dim"), ("≈ 0.5% of plan", "fg mu")], [], "dim b"),
        ("REMAINING", [("step try ", "dim"), ("3 of 3", W), (": the last one", "warn"), ("  ·  then 2 stages", "dim"),
                       ("  ·  stage attempt ", "dim"), ("1 of 5", "fg"), ("  ·  rollbacks ", "dim"), ("0", "fg")], [], "dim b"),
        ("CIRCLES", [(" ↻ RED ×3 ", "bg-warn ink b"), ("  on ", "dim"), ("zero-percent-keeps-full-price", W),
                     ("     1 ", "dim"), ("R", "err b"), ("●", "err"), ("G", "ok b"), ("●", "ok"),
                     ("   2 ", "dim"), ("R", "err b"), ("✗✗", "warn b"), ("▸", "claude b")],
         [[("r1 1:37 ", "dim"), ("exit 0 · 1 passed", "warn"), ("   r2 1:52 ", "dim"), ("exit 0 · 1 passed", "warn"),
           ("   r3 ", "dim"), ("running 4.1s", "claude")],
          [("each try wrote a test that already passes, so RED is refused", "dim")]], "warn b"),
        ("DEVIATING", [("⚠ 1", "warn b"), ("  ", ""), ("test_ten_percent_off_hundred_returns_90", "fg mu"),
                       (" was edited in RED r2, after its GREEN", "warn mu")],
         [[("seen by the gate check at task end · the course checker does not run in tdd", "dim")]], "warn b"),
    ]) + 1
    rows = [("done", "code-scenarios", "7.7s", "G:scenarios · auto"),
            ("now", "code-tdd", "1:18", "RED r3 · test 2 of 2"),
            ("todo", "code-safety-net"), ("todo", "G:task-end")]
    r = stages_box(s, p, r, rows) + 1
    done = [("✓ 1 done", "ok"), ("  ·  1 red → green", "dim")]
    focus_test(s, p, r, "test 2 of 2", done, None, "zero-percent-keeps-full-price",
               "A 0% discount keeps the full price: apply_discount(100, 0) returns 100.",
               "tests/test_discount.py::test_zero_percent_keeps_full_price",
               [("RED", "now", "implement-tests r3 · 4.1s"), ("GREEN", "todo", "implement-code"),
                ("REFACTOR", "na", "not part of bug_fix")],
               "next: the runner. If the test passes again the run stops, and a re-run continues from tests{}",
               None, "4.1s")
    c = button(s, ROWS - 4, p.x + 1, "s", "suggest")
    s.put(ROWS - 4, c + 2, "too late for r3: a note reaches the agent after it", "faint")
    footer_commit(s, p, "2ae1fed", "green ten-percent-off-hundred")
    return s


# ===================================================================== planning
PLAN_STAGES = ["brainstorm", "plan-requirements", "plan-architecture", "plan-tracers", "plan-sequence"]


def plan_head(entries, stage_txt, elapsed, needs, note, spin=None):
    s, p = screen(entries, 109, spin=spin)
    status(s, p, "●", "PLANNING", stage_txt, elapsed, needs=needs, note=note)
    s.put(5, p.x + 1, "AIM", "dim b")
    for i, ln in enumerate(wrap(PLAN_ASK, p.w - 9)):
        s.put(5 + i, p.x + 7, ln, "fg bo")
    return s, p, 5 + len(wrap(PLAN_ASK, p.w - 9)) + 1


def list_box(s, p, r, title, items, right=None, rst="dim"):
    """items: list of parts-lists, one row each."""
    s.box(r, p.x, len(items) + 2, p.w, title, right=right, rst=rst)
    for i, parts in enumerate(items):
        s.seq(r + 1 + i, p.x + 2, parts)
    return r + len(items) + 2


def r3_5():
    s, b = band_screen(T_PLAN_Q2)
    band(s, b, [("pb ", "claude b"), ("● ", "claude"), ("brainstorm", "b"), (" · ", "dim"), ("Q2 of 4", "fg mu"), SEP,
                ("spent ", "dim"), ("14:20", "fg mu"), (" · 1 agent · ", "fg"), ("≈0.2%", "fg mu"), SEP,
                ("left ", "dim"), ("4 stages, 3 Qs", "fg"), SEP,
                ("↻ 0", "ok"), ("  ", ""), ("⚠ 0", "dim"), SEP, ("needs you: ", "dim"), ("answer Q2", "warn b")])
    return s


def r3_6():
    s, p, r = plan_head(T_PLAN_Q2, "brainstorm · main context · asking Q2", "14:20",
                        ("yes", "warn b"), "Q2 is open in the chat")
    s.bg(2, p.end - len("14:20 elapsed "), 5, "mu")
    r = glance(s, p, r, [
        ("WHERE", [("brainstorm", "b"), (" · in the main context · ", "dim"), ("question 2 of about 4", "fg mu"),
                   ("  ·  stage 1 of 5", "dim")], [], "dim b"),
        ("SPENT", [("1 agent", "fg"), (" (curate-guidance) · ", "dim"), ("14:20", "fg mu"), (" · ", "dim"),
                   ("≈ 0.2% of plan", "fg mu")], [], "dim b"),
        ("REMAINING", [("4 stages", "fg"), (", 3 gates", "dim"), ("  ·  ", "dim"), ("2 open questions", "fg"),
                       (" after this one", "dim")], [], "dim b"),
        ("CIRCLES", [("↻ 0", "ok b"), ("   no question asked twice, no stage re-run", "dim")], [], "dim b"),
        ("DEVIATING", [("nothing", "ok b"), ("   the aim has not changed since the request", "dim")], [], "dim b"),
    ]) + 1
    r = list_box(s, p, r, "decided", [
        [("✓ ", "ok"), ("Every coding path runs as workflow stages; human checkpoints sit between stages", "bo")],
        [("✓ ", "ok"), ("Q1 · auto mode passes continue gates and stops on ambiguity or repeated failure", "bo")],
    ], right="2 so far") + 1
    s.box(r, p.x, 7, p.w, "open questions", right="1 asked · 2 waiting")
    s.fill(r + 1, p.x + 1, p.w - 2, " ", "bg-sel")
    s.seq(r + 1, p.x + 2, [("▸ Q2 ", "bg-sel claude b"),
                           ("How much adversarial review per stage: one full lens round, or a list each stage owns?",
                            "bg-sel fg b bo")])
    s.put(r + 2, p.x + 7, "asking now · options: full round everywhere · per-stage list · task end only", "dim")
    s.seq(r + 4, p.x + 2, [("○ Q3 ", "dim"), ("Where does per-run state live, and when is it removed?", "fg bo")])
    s.seq(r + 5, p.x + 2, [("○ Q4 ", "dim"), ("Does the progress mod stay view-only, or can it drive the run?", "fg mu")])
    r += 8
    r = list_box(s, p, r, "still to come", [
        [("○ ", "dim"), ("plan-requirements", ""), ("  → G:requirements", "dim")],
        [("○ ", "dim"), ("plan-architecture", ""), ("  → G:architecture", "dim")],
        [("○ ", "dim"), ("plan-tracers", ""), ("       → G:tracers", "dim")],
        [("○ ", "dim"), ("plan-sequence", ""), ("      → writes the plan file", "dim")],
    ], right="nothing drafted yet")
    footer_text(s, p, "answer in the chat · planning makes no commits")
    return s


def r3_7():
    s, p, r = plan_head(T_PLAN_LATE, "plan-tracers · lens round", "52:10", ("no", "ok b"),
                        "last event 4s ago: lens pr-fit started", spin=("Running workflow", "52m 10s"))
    s.bg(2, p.end - len("52:10 elapsed "), 5, "mu")
    r = glance(s, p, r, [
        ("WHERE", [("plan-tracers", "b"), (" · lens round on 14 drafted tracers · ", "dim"), ("stage 4 of 5", "fg")],
         [], "dim b"),
        ("SPENT", [("31 agents", "fg mu"), (" · ", "dim"), ("52:10", "fg mu"), (" · ", "dim"),
                   ("≈ 3.1% of plan", "fg mu")], [], "dim b"),
        ("REMAINING", [("G:tracers", "fg"), (", then ", "dim"), ("plan-sequence", "fg"),
                       ("  ·  stage attempt ", "dim"), ("1 of 5", "fg"), ("  ·  1 open question", "dim")], [], "dim b"),
        ("CIRCLES", [("↻ 1", "warn b"), ("   rollback in plan-architecture: ", "dim"), ("wrong-direction", "warn mu"),
                     ("      req ", "dim"), ("●", "ok"), ("  arch ", "dim"),
                     ("✗●", "warn"), ("  tracers ", "dim"), ("▸", "claude b")], [], "dim b"),
        ("DEVIATING", [("nothing", "ok b"), ("   tracers stay inside the 30 requirements · no new scope since G:requirements",
                                            "dim mu")], [], "dim b"),
    ]) + 1
    r = list_box(s, p, r, "decided", [
        [("✓ 9 earlier", "ok"), ("  ", ""), (" + show 9 ", "bg-sel fg"), ("   latest three:", "dim")],
        [("✓ ", "ok"), ("Sonnet by default for lenses, refuters and fix agents; Opus only where D8 names it", "bo")],
        [("✓ ", "ok"), ("A course checker replaces fixed fix rounds; hard cap of 5 attempts per stage", "bo")],
        [("✓ ", "ok"), ("Integration branch; each PR squash-merges into it, one commit per PR on promotion", "bo")],
    ], right="12 total") + 1
    r = list_box(s, p, r, "open questions", [
        [("✓ 4 answered", "ok"), ("   ", ""), ("○ ", "dim"),
         ("R23 run-history view has no data source: defer it as a follow-up?", "fg bo")],
        [("      ", ""), ("waits for G:tracers, so the lens round is not interrupted", "dim")],
    ], right="1 left") + 1
    r = list_box(s, p, r, "tracers drafted", [
        [("✓ 11 earlier", "ok"), ("  ", ""), (" + show 11 ", "bg-sel fg"),
         ("   T0 Live probes … T7 Plan execution", "dim bo")],
        [("▸ ", "claude"), ("T4d  ", "b"), ("Plan tree and unit view", "bo"), (" " * 17, ""), ("lens pr-fit running", "claude")],
        [("○ ", "dim"), ("T10  ", "b"), ("Solo port", "bo"), (" " * 31, ""), ("lens pr-fit queued", "dim")],
        [("○ ", "dim"), ("T11a ", "b"), ("Partial mod verdict and stage reports", "bo"), (" " * 3, ""),
         ("lens pr-fit queued", "dim")],
    ], right="14 so far") + 1
    list_box(s, p, r, "still to come", [
        [("○ ", "dim"), ("G:tracers", ""), ("   ○ ", "dim"), ("plan-sequence", ""),
         ("  → tasks per tracer, written to docs/plans/…", "dim")],
    ])
    footer_text(s, p, "planning makes no commits · requirements and architecture are kept in the run directory")
    return s


# ===================================================================== render
CAP = ("Dotted magenta underline: invented. Dotted cyan underline: borrowed from the real plan "
       "docs/plans/deterministic-workflows.md. Everything else comes from the named recording.")
IMAGES = [
    ("R3-1-band-tdd-calm", r3_1, BAND_COLS, "R3-1 · band one-liner · TDD calm",
     "g-open-1 at 1:55 in a 128-column terminal with no pane. Where · spent · left · circles · deviating · needs you, then ▸ pane.",
     ["Invented: ≈ % of plan. Real: step, test 3/4, 1:55, 12 agents, what is left, 0 repeats."]),
    ("R3-2-band-tdd-trouble", r3_2, BAND_COLS, "R3-2 · band one-liner · TDD in circles and deviating",
     "probe-2 at 2:10, during RED r3: the third try at the same test. The circles block turns amber and needs you reads soon.",
     ["Invented: ≈ % of plan and the deviation (probe-2 had none). Real: RED ×3 on test 2/2, last try, 2:10, 14 agents."]),
    ("R3-3-pane-tdd-calm", r3_3, None, "R3-3 · expanded pane · TDD calm",
     "g-open-1 at 1:55. The five questions sit on top, with round 2's stages and focus block under them.",
     ["Invented: tokens, ≈ % of plan, the files touched, the test description.",
      "Real: everything in WHERE, agents, time, step tries (the 3-try limit is from probe-2), the per-test strip and stages."]),
    ("R3-4-pane-tdd-circles", r3_4, None, "R3-4 · expanded pane · going in circles and deviating",
     "probe-2 at 2:10. RED on zero-percent-keeps-full-price tried three times; r1 and r2 ran green. The run stopped at 2:20.",
     ["Invented: tokens, ≈ % of plan, the test description, and the whole DEVIATING row (probe-2 edited no other test).",
      "Real: RED r1 to r3, their times and exit codes, last try, 14 agents, stage times, last commit 2ae1fed."]),
    ("R3-5-band-planning", r3_5, BAND_COLS, "R3-5 · band one-liner · planning",
     "/pairingbuddy:plan in brainstorm, with Q2 open in the chat. In planning, needs you is the normal state.",
     ["Invented: the whole planning run (no planning recording exists): time, question count, ≈ % of plan."]),
    ("R3-6-pane-planning-brainstorm", r3_6, None, "R3-6 · expanded pane · planning, brainstorm asking Q2",
     "Aim, the five questions, what is decided, the open questions with the one being asked now lit, and what is still to come.",
     ["Borrowed: the aim, both decisions, Q2 and Q3 (the real plan's R1, R2, R15 and human answers Q2 and Q3).",
      "Invented: time, question counts, Q4, ≈ % of plan. Real: the stage and gate names from T8 of the plan."]),
    ("R3-7-pane-planning-tracers", r3_7, None, "R3-7 · expanded pane · planning later, tracers drafted",
     "52 minutes in: requirements and architecture passed, and the lenses are attacking the drafted tracers. More is decided and less remains.",
     ["Borrowed: decisions, the open question (follow-up R23), tracer ids and names, 30 requirements.",
      "Invented: time, agents, ≈ % of plan, the rollback in plan-architecture, lens progress, counts."]),
]


def main(only=None):
    os.makedirs(OUT, exist_ok=True)
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    for name, fn, _, title, cap, notes in IMAGES:
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
