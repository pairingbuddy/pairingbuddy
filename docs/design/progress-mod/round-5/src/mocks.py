"""Round 5: compact cycle marker, HTML reports, report button.

Run: python3 src/mocks.py <outdir> [name-filter ...]
Builds on base.py (round 2), r3.py (round 3) and r4.py (round 4), all unchanged.
"""
import html
import os
import subprocess
import sys

from lib import page, THEMES
from cc import wrap
from data import BUG_TASK, BUG_TASK_SHORT
from base import screen, button, status, task_lines, ROWS, T_G1_RUN
from r3 import glance, footer_commit, T_P2_R3, PLAN_ASK
from r4 import steps_box

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

PH = {"RED": "err", "GREEN": "ok", "REFACTOR": "blue"}


# ------------------------------------------------------------------ compact cycle marker
def marker_parts(now, bugfix, age):
    phases = ["RED", "GREEN"] + ([] if bugfix else ["REFACTOR"])
    parts = []
    for i, ph in enumerate(phases):
        if i:
            parts.append((" ", ""))
        if ph == now:
            parts.append(("●" + ph, PH[ph] + " b"))
        else:
            parts.append(("›" + ph, "faint"))
    parts.append(("  " + age, "fg"))
    return parts


def now_building(s, p, r, n_of, tests, legend, short, desc, tid, selector, now, bugfix, age):
    x, w = p.x, p.w
    dl = wrap(desc, w - 6)
    h = 2 + 2 + 1 + 1 + len(dl) + 1
    s.box(r, x, h, w, "now building", right=n_of, rst="fg b")
    rr = r + 1
    c = x + 2
    for g, gs, name, ns in tests:
        c = s.seq(rr, c, [(g + " ", gs), (name, ns), ("   ", "")])
    s.put(rr + 1, x + 4, legend, "faint", w=w - 6)
    rr += 3
    s.put(rr, x + 2, short, "b mu")
    s.rseq(rr, x + w - 2, marker_parts(now, bugfix, age))
    rr += 1
    for i, ln in enumerate(dl):
        s.put(rr + i, x + 2, ln, "fg mu")
    rr += len(dl)
    s.seq(rr, x + 2, [(tid, "dim"), ("  ·  ", "faint"), (selector, "faint")])
    return r + h


LEGEND = "✓ made to pass   ◌ already passed, nothing to fix   ▸ now   · to do"


def buttons(s, p, focus_report=False):
    r = ROWS - 4
    c = button(s, r, p.x + 1, "s", "suggest")
    if focus_report:
        c = s.seq(r, c + 1, [(" r", "bg-fg claude b"), (" open report ", "bg-fg ink b")])
    else:
        c = button(s, r, c + 1, "r", "open report")
    return r


# ===================================================================== panes
def r5_1():
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
        LEGEND, "0% keeps the price",
        "A 0% discount leaves the price as it was: apply_discount(100, 0) returns 100.",
        "zero-percent-original-price", "tests/test_discount.py::test_zero_percent_returns_original_price",
        "RED", True, "5.1s")
    buttons(s, p)
    s.rput(ROWS - 4, p.end, "esc or × closes · the band stays", "faint")
    footer_commit(s, p, "3aaba6a", "saved: discount-non-round-price already passes")
    return s


def p2_pane(focus_report=False):
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
        ("OFF TRACK", [("yes", W), (": ", "warn"),
                       ("an earlier test (10% off 100) was changed on try 2, after it passed", "warn mu")], [], W),
    ]) + 1
    r = steps_box(s, p, r, [("done", "write scenarios", "7.7s", "OK'd (auto)"),
                            ("now", "build test by test", "1:18", "test 2 of 2 · 3rd try"),
                            ("todo", "safety-net review"),
                            ("todo", "your sign-off at the end")]) + 1
    now_building(
        s, p, r, "test 2 of 2",
        [("✓", "ok", "10% off 100 is 90", "mu"), ("✗✗▸", "warn b", "0% keeps the full price", "b mu")],
        "✓ made to pass   ▸ now   ✗ a try that was refused because the new test already passed",
        "0% keeps the full price",
        "A 0% discount keeps the full price: apply_discount(100, 0) returns 100.",
        "zero-percent-keeps-full-price", "tests/test_discount.py::test_zero_percent_keeps_full_price",
        "RED", True, "4.1s")
    br = buttons(s, p, focus_report)
    if focus_report:
        s.put(br + 0, p.x + 33, "", "")
        s.rput(br, p.end, "wrote report.html · opened in your browser", "ok")
    footer_commit(s, p, "2ae1fed", "made to pass: ten-percent-off-hundred")
    return s


def r5_2():
    return p2_pane()


def r5_5():
    return p2_pane(focus_report=True)


# ===================================================================== HTML reports
def report_doc(url, tab, body, height):
    t = THEMES["dark"]
    css_vars = ";".join(f"--{k}:{v}" for k, v in t.items())
    doc = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:JBM;src:url(file:///Users/alberto/Library/Fonts/JetBrainsMonoNerdFontMono-Regular.ttf)}}
@font-face{{font-family:JBM;font-weight:700;src:url(file:///Users/alberto/Library/Fonts/JetBrainsMonoNerdFontMono-Bold.ttf)}}
:root{{{css_vars}}}
html,body{{margin:0;background:var(--page)}}
.wrap{{padding:28px 32px}}
.win{{border-radius:10px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.35);border:1px solid var(--faint);width:1360px}}
.tabs{{height:38px;background:#141518;display:flex;align-items:flex-end;padding-left:84px;position:relative}}
.dots{{position:absolute;left:14px;top:13px;display:flex;gap:8px}}.dots i{{width:12px;height:12px;border-radius:6px;display:block}}
.tab{{background:var(--chrome);color:var(--fg);font:12px -apple-system,Helvetica,sans-serif;padding:9px 16px;border-radius:8px 8px 0 0;width:240px}}
.addr{{background:var(--chrome);padding:7px 12px;display:flex;gap:10px;align-items:center;color:var(--chromefg);font:13px -apple-system,Helvetica,sans-serif}}
.addr .u{{flex:1;background:#18191c;border-radius:14px;padding:6px 14px;color:#c9c9c9}}
.page{{background:var(--bg);color:var(--fg);font:14px/1.55 JBM,monospace;padding:30px 44px 40px;height:{height}px;overflow:hidden}}
h1{{font:600 22px/1.3 -apple-system,Helvetica,sans-serif;margin:4px 0 6px}}
h2{{font:600 13px JBM;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin:28px 0 10px;border-bottom:1px solid var(--faint);padding-bottom:6px}}
.kick{{color:var(--claude);font-weight:700;letter-spacing:.06em}}
.meta{{color:var(--dim)}}
.pill{{display:inline-block;padding:1px 10px;border-radius:4px;font-weight:700}}
.stop{{background:var(--err);color:var(--ink)}}.run{{background:var(--sel);color:var(--claude)}}
table{{border-collapse:collapse;width:100%}}
td,th{{padding:5px 12px 5px 0;vertical-align:top;text-align:left}}
th{{color:var(--dim);font-weight:400}}
.lab{{color:var(--dim);font-weight:700;width:240px}}
.ok{{color:var(--ok)}}.err{{color:var(--err)}}.warn{{color:var(--warn)}}.dim{{color:var(--dim)}}.faint{{color:var(--faint)}}
.cyan{{color:var(--cyan)}}.claude{{color:var(--claude)}}.blue{{color:var(--blue)}}.b{{font-weight:700}}
.card{{border:1px solid var(--border);border-radius:8px;padding:14px 18px;margin:12px 0}}
.card.trouble{{border-color:var(--warn)}}
.why{{background:var(--warnbg);border-radius:6px;padding:10px 14px;margin-top:10px}}
.MU{{text-decoration:underline dotted var(--mu) 2px;text-underline-offset:4px}}
.BO{{text-decoration:underline dotted var(--cyan) 2px;text-underline-offset:4px}}
.cols{{display:grid;grid-template-columns:1fr 1fr;gap:28px}}
.foot{{color:var(--faint);margin-top:30px}}
</style></head><body><div class="wrap"><div class="win">
<div class="tabs"><div class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div><div class="tab">{html.escape(tab)}</div></div>
<div class="addr"><span>‹ ›</span><span class="u"><span class="MU">{html.escape(url)}</span></span></div>
<div class="page">{body}</div></div></div></body></html>"""
    return doc, 1360 + 64 + 2, 38 + 36 + height + 30 + 40 + 56 + 4


def glance_rows(rows):
    return "<table>" + "".join(f'<tr><td class="lab">{k}</td><td>{v}</td></tr>' for k, v in rows) + "</table>"


def report_tdd():
    mu = lambda t: f'<span class="MU">{t}</span>'
    at = glance_rows([
        ("WHERE IT STOPPED", "building test by test · test 2 of 2 · writing a failing test, 3rd try"),
        ("SPENT", f"16 agents · 2:20 · {mu('≈0.5% of plan')} · <span class='dim'>tokens not recorded</span>"),
        ("LEFT", "test 2, then the safety-net review and your sign-off. A re-run keeps test 1."),
        ("LOOPING", "<span class='warn b'>yes:</span> <span class='warn'>3 tries at the same failing test. "
                    "Each new test passed straight away.</span>"),
        ("OFF TRACK", "<span class='ok b'>no</span> <span class='dim'>· nothing changed outside the task</span>"),
    ])

    def tries(rows):
        out = ("<table><tr><th>step</th><th>try</th><th>at</th><th>writing</th><th>running</th>"
               "<th>result</th><th>commit</th></tr>")
        for ph, n, a, wr, rn, res, cm in rows:
            out += (f'<tr><td class="{PH[ph]} b">{ph}</td><td>{n}</td><td class="dim">{a}</td><td>{wr}</td>'
                    f'<td>{rn}</td><td>{res}</td><td class="claude">{cm}</td></tr>')
        return out + "</table>"

    t1 = tries([("RED", 1, "1:11", "wrote the test · 7.9s", "3.1s", "<span class='ok'>failed, as it should</span> "
                 "<span class='dim'>(exit 1)</span>", "5643302"),
                ("GREEN", 1, "1:24", "fixed the code · 7.9s", "3.3s", "<span class='ok'>passed</span> "
                 "<span class='dim'>(exit 0)</span>", "2ae1fed")])
    refused = "<span class='warn'>passed straight away · refused</span> <span class='dim'>(exit 0, 1 passed)</span>"
    t2 = tries([("RED", 1, "1:37", "wrote the test · 10.5s", "3.2s", refused, "–"),
                ("RED", 2, "1:52", "wrote the test · 8.7s", "2.7s", refused, "–"),
                ("RED", 3, "2:06", "wrote the test · 8.6s", "2.6s", refused, "–")])
    steps = glance_rows([
        ("curate guidance", "6.0s"), ("classify the task", "5.5s · bug fix"),
        ("write scenarios", "0:34 → 0:42 · 7.7s · 2 tests"),
        ("your OK on the scenarios", "<span class='ok'>OK'd (auto)</span> at 0:48"),
        ("build test by test", "0:52 → <span class='err'>stopped at 2:20</span> · 1:28 · 14 agents"),
        ("safety-net review", "<span class='faint'>not reached</span>"),
        ("your sign-off at the end", "<span class='faint'>not reached</span>"),
    ])
    body = f"""
<div class="kick">PAIRING BUDDY · RUN REPORT</div>
<h1>Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90</h1>
<div class="meta"><span class="pill stop">STOPPED</span> &nbsp;bug fix · 2:20 · {mu('3 Nov 2026, 07:41')} · {mu('~/src/shop')} · recording probe-2</div>
<h2>At a glance</h2>{at}
<h2>What you can do</h2>
<div>1. Re-run <span class="claude">/pairingbuddy:code</span>. It continues from test 2 and keeps test 1 and its commits.</div>
<div>2. Or {mu('check whether a 0% discount already works, and drop that test')}.</div>
<h2>Tests</h2>
<div class="card"><div><span class="ok b">✓ test 1 of 2</span> &nbsp;<span class="b">ten-percent-off-hundred</span>
 &nbsp;<span class="dim">tests/test_discount.py::test_ten_percent_off_hundred_returns_90</span></div>
<div class="dim" style="margin:4px 0 8px">{mu('10% off 100 is 90')} · result: <span class="ok">made to pass</span></div>{t1}</div>
<div class="card trouble"><div><span class="warn b">✗ test 2 of 2</span> &nbsp;<span class="b">zero-percent-keeps-full-price</span>
 &nbsp;<span class="dim">tests/test_discount.py::test_zero_percent_keeps_full_price</span></div>
<div class="dim" style="margin:4px 0 8px">{mu('a 0% discount keeps the full price')} · result: <span class="warn">stopped after 3 tries</span></div>{t2}
<div class="why"><span class="warn b">Why it looped.</span> RED must start from a test that fails, to prove the bug.
All three tests passed on their first run, so none of them could. {mu('Most likely 0% was never broken.')}
After the third refused try the run stopped: a step failed past its retries.</div></div>
<h2>Steps</h2>{steps}
<h2>Commits</h2>
<div><span class="claude">9e70359</span> placeholders for both tests · <span class="claude">5643302</span> test 1 fails, as it should
 · <span class="claude">2ae1fed</span> test 1 made to pass</div>
<div class="foot">Written by Pairing Buddy from the run's ledger and agent labels. One self-contained file, nothing loaded from the network.</div>
"""
    return report_doc("file:///Users/alberto/src/shop/.pairingbuddy/reports/2026-11-03-0741-discount-fix.html",
                      "Run report · discount fix", body, 1330)


DECISIONS = [
    ("Every coding path runs as separate steps, with your checkpoints between them",
     "3:10", "The model starts each workflow itself, so order has to be enforced between steps.", "your request"),
    ("In auto mode the routine checkpoints pass by themselves; it stops when unsure or stuck",
     "5:40", "No extra flag: the permission mode you already chose decides.", "Q1"),
    ("Test results come from a separate runner, never from the agent that wrote the code",
     "8:05", "A checkpoint must not rest on the producer's word.", "architecture"),
    ("Each step owns its own review list; no full PR-style review by default",
     "15:10", "A full round everywhere costs too much for what it finds.", "Q2"),
    ("Only files you own are kept; a run's state is removed when the task ends",
     "16:30", "Nothing stale is left for the next run to trip over.", "Q3"),
    ("The progress view only watches; it never steers the run",
     "18:00", "A broken view must not be able to break a run.", "Q4"),
    ("Reviews run on Sonnet by default; Opus only where the plan names it",
     "31:20", "The spend spike showed Opus everywhere is not affordable.", "architecture"),
    ("A checker judges each fix and can undo it; at most 5 attempts per step",
     "33:00", "Replaces fixed fix rounds and full re-reviews.", "architecture"),
    ("Work lands on an integration branch, one squashed commit per PR",
     "38:45", "'Nothing merges to main' clashed with one commit per PR.", "architecture"),
    ("The view's design comes from real run data, off the critical path",
     "41:00", "Designing it before any run exists would be guesswork.", "your OK on the architecture"),
    ("Publishing stays refused until the review step exists",
     "44:30", "Nothing reaches a PR without a review record.", "your OK on the architecture"),
    ("Every trial run of a new build uses a separate worktree",
     "47:15", "A broken build must not damage the working copy.", "your OK on the architecture"),
]
SLICES = [
    ("Live probes", "Every untested platform assumption has a recorded result"),
    ("config_change skeleton", "config_change runs end to end on the new path"),
    ("Label-contract review", "The label contract is enough before test labels freeze"),
    ("bug_fix and new_feature", "Both types run on the new path at parity"),
    ("Mod design pass, first pane, alerts", "A mod direction you chose ships, with alerts"),
    ("Live TDD view", "The pane shows the test cycle live"),
    ("Publish a one-task unit", "A one-task unit publishes to a configured base"),
    ("lensAttack", "The review primitive runs with caps and read-only agents"),
    ("Lens view", "The pane shows review progress and spend"),
    ("refactoring and spike", "Both types run on the new path"),
    ("Plan execution", "Plans run across units and sessions"),
    ("Plan tree and unit view", "The pane shows the plan and its units"),
    ("Solo port", "Solo drives the new workflows"),
    ("Partial mod verdict and stage reports", "You judge the code path"),
]
REQS = [
    ("R1", "must", "Move every coding path, planning and design-ux to workflow scripts"),
    ("R2", "must", "Enforce step order between steps; checkpoints after scenarios, at task end, before a PR"),
    ("R3", "must", "Test results come from a runner and a small CLI, never from the producer"),
    ("R4", "must", "Move all human review out of agents"),
    ("R5", "must", "Persist only files you own; run state is removed at task end"),
    ("R6", "must", "Ship an interactive progress view"),
    ("R7", "must", "Labels follow a tested contract, so the view never parses free text"),
    ("R8", "must", "A configurable review primitive, not one fixed round"),
    ("R10", "must", "Findings cite a rule; a checker judges fixes; at most 5 attempts per step"),
    ("R13", "must", "Review cost follows each step's own list; spend is reported per run"),
]


def report_plan():
    bo = lambda t: f'<span class="BO">{t}</span>'
    mu = lambda t: f'<span class="MU">{t}</span>'
    at = glance_rows([
        ("NOW", f"checking the {mu('14')} slices drafted so far "
                "<span class='dim'>(slices: thin end-to-end pieces of the plan)</span>"),
        ("SPENT", mu("31 agents · 52:10 · ≈3.1% of plan")),
        ("LEFT", "your OK on the slices, then the task list · 1 open question"),
        ("LOOPING", f"<span class='warn b'>a little:</span> {mu('one architecture fix went the wrong way and was redone')}"),
        ("OFF TRACK", f"<span class='ok b'>no</span> <span class='dim'>· {mu('every slice maps to the 28 requirements')}</span>"),
    ])
    dec = "<table><tr><th>#</th><th>decided</th><th>when</th><th>why</th><th>from</th></tr>"
    for i, (d, w, why, src) in enumerate(DECISIONS, 1):
        dec += (f'<tr><td class="dim">{i}</td><td>{bo(d)}</td><td class="dim">{mu(w)}</td>'
                f'<td>{bo(why)}</td><td class="dim">{src}</td></tr>')
    dec += "</table>"
    qs = ("<table>"
          f"<tr><td class='warn'>○ open</td><td>{bo('A run-history view has nothing to read from: leave it for later?')}</td>"
          "<td class='dim'>asked at your OK on the slices</td></tr>"
          f"<tr><td class='ok'>✓ Q1</td><td>{bo('When may a checkpoint pass without you?')}</td><td class='dim'>→ decision 2</td></tr>"
          f"<tr><td class='ok'>✓ Q2</td><td>{bo('How much review per step?')}</td><td class='dim'>→ decision 4</td></tr>"
          f"<tr><td class='ok'>✓ Q3</td><td>{bo('Where does the state of a run live, and when is it removed?')}</td><td class='dim'>→ decision 5</td></tr>"
          f"<tr><td class='ok'>✓ Q4</td><td>{mu('Does the progress view only watch, or can it steer the run?')}</td><td class='dim'>→ decision 6</td></tr>"
          "</table>")
    sl = "<table>"
    for i, (n, g) in enumerate(SLICES):
        st = ("<span class='ok'>✓ checked</span>" if i < 11 else
              ("<span class='claude'>▸ being checked</span>" if i == 11 else "<span class='dim'>○ waiting</span>"))
        sl += f"<tr><td class='dim'>{i + 1}</td><td class='b'>{bo(n)}</td><td>{bo(g)}</td><td>{mu(st)}</td></tr>"
    sl += "</table>"
    rq = "<table>"
    for rid, lvl, t in REQS:
        rq += f"<tr><td class='dim'>{rid}</td><td class='dim'>{lvl}</td><td>{bo(t)}</td></tr>"
    rq += "<tr><td></td><td></td><td class='dim'>+ 18 more · 21 must, 5 should, 2 could</td></tr></table>"
    body = f"""
<div class="kick">PAIRING BUDDY · PLAN REPORT</div>
<h1>{bo(html.escape(PLAN_ASK))}</h1>
<div class="meta"><span class="pill run">● PLANNING</span> &nbsp;checking the slices · {mu('52:10')} · plan file docs/plans/deterministic-workflows.md</div>
<h2>At a glance</h2>{at}
<h2>Decisions · 12</h2>{dec}
<h2>Questions · 1 open, 4 answered</h2>{qs}
<div class="cols"><div><h2>Slices · 14 so far</h2>{sl}</div><div><h2>Requirements · 28</h2>{rq}</div></div>
<div class="foot">Written by Pairing Buddy from the plan run's records. One self-contained file, nothing loaded from the network.</div>
"""
    return report_doc("file:///Users/alberto/src/pairingbuddy/.pairingbuddy/reports/plan-deterministic-workflows.html",
                      "Plan report · deterministic workflows", body, 2090)


# ===================================================================== render
CAP = ("Dotted magenta underline: invented. Dotted cyan underline: borrowed from the real plan "
       "docs/plans/deterministic-workflows.md. Everything else comes from the named recording.")
PANES = [
    ("R5-1-pane-tdd-calm", r5_1, "R5-1 · pane · TDD calm, compact cycle",
     "g-open-1 at 1:55. The cycle is now a marker on the test's own line (●RED ›GREEN, no REFACTOR in a bug fix).",
     ["Invented: ≈ % of plan, the test description and short names, the files changed. Real: as R4-2."]),
    ("R5-2-pane-tdd-looping", r5_2, "R5-2 · pane · TDD looping, compact cycle",
     "probe-2 at 2:10, third try. Same change; the looping detail stays in LOOPING.",
     ["Invented: ≈ % of plan, the test description, the OFF TRACK row. Real: as R4-3."]),
    ("R5-5-pane-report-button", r5_5, "R5-5 · pane · open report",
     "The r open report button, focused and pressed: the mod wrote the page and opened it in the browser.",
     ["The confirmation text is illustrative. API: $.fs.write, then $.process.run(['open', path])."]),
]
REPORTS = [
    ("R5-3-report-tdd", report_tdd),
    ("R5-4-report-plan", report_plan),
]


def render(name, doc, W, H):
    hp = os.path.abspath(os.path.join(OUT, name + ".html"))
    open(hp, "w").write(doc)
    png = os.path.abspath(os.path.join(OUT, name + ".png"))
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--window-size={W},{H}",
                    "--force-device-scale-factor=2", f"--screenshot={png}", "file://" + hp], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.remove(hp)
    print(name, W, H)


def main(only=None):
    os.makedirs(OUT, exist_ok=True)
    for name, fn, title, cap, notes in PANES:
        if only and not any(o in name for o in only):
            continue
        doc, W, H = page(fn(), "dark", title, f"<div>{cap}</div>", [CAP] + notes, caph=118)
        render(name, doc, W, H)
    for name, fn in REPORTS:
        if only and not any(o in name for o in only):
            continue
        doc, W, H = fn()
        render(name, doc, W, H)


if __name__ == "__main__":
    main(sys.argv[2:] or None)
