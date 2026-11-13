"""Claude Code chrome: transcript, prompt, status line, docked pane frame, band frame."""
import textwrap

WIDE_COLS, WIDE_ROWS = 190, 50
TW = 78                 # transcript columns in the wide layout
PX = TW + 2             # pane body first column
PW = WIDE_COLS - PX - 1  # pane body width (109)

NARROW_COLS, NARROW_ROWS = 100, 26


def wrap(text, w):
    return textwrap.wrap(text, w) or [""]


def transcript(s, x, w, entries, top=0):
    """entries: list of tuples. Returns next free row."""
    r = top
    for e in entries:
        kind = e[0]
        if kind == "user":
            lines = wrap(e[1], w - 4)
            for i, ln in enumerate(lines):
                s.put(r, x, ("> " if i == 0 else "  ") + ln, "dim")
                r += 1
            r += 1
        elif kind == "tool":
            _, name, args, result, state = e
            dot = {"ok": "ok", "run": "dim", "err": "err", "warn": "warn"}[state]
            s.put(r, x, "⏺", dot)
            c = s.put(r, x + 2, name, "b")
            s.put(r, c, "(" + args + ")", "", w=w - (c - x))
            r += 1
            for i, ln in enumerate(result if isinstance(result, list) else [result]):
                s.put(r, x + 2, ("⎿  " if i == 0 else "   ") + ln, "dim", w=w - 2)
                r += 1
            r += 1
        elif kind == "say":
            lines = wrap(e[1], w - 2)
            for i, ln in enumerate(lines):
                if i == 0:
                    s.put(r, x, "⏺", "fg")
                s.put(r, x + 2, ln)
                r += 1
            r += 1
        elif kind == "blank":
            r += 1
    return r


def spinner(s, r, x, verb, elapsed, st="claude"):
    s.put(r, x, "✻", st)
    s.seq(r, x + 2, [(verb + "… ", st), (f"({elapsed} · esc to interrupt)", "dim")])


def prompt(s, r, x, w, text="", mode="⏵⏵ auto mode on", hint="(shift+tab to cycle)"):
    """rule, input, rule, status: rows r..r+3"""
    s.put(r, x, "─" * w, "faint")
    s.seq(r + 1, x, [("> ", "fg"), (text, "dim")])
    s.put(r + 2, x, "─" * w, "faint")
    s.seq(r + 3, x + 2, [(mode, "blue"), (" " + hint, "dim")])


def pane_frame(s, title="Pairing Buddy"):
    for r in range(s.rows):
        s.put(r, TW, "│", "faint")
    s.put(0, PX, title, "b")
    s.rput(0, s.cols - 1, "✕", "dim")
    s.put(1, PX, "─" * PW, "faint")


def band_mark(s, r):
    """the engine's [-] sits outside the band body, top-right."""
    s.rput(r, s.cols, "[-]", "dim")
