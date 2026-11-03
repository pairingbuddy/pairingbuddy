"""Character-grid terminal mockup renderer: build a grid of cells, emit HTML."""
import html

CW = 9      # px per column at 15px JetBrains Mono (0.6em)
LH = 20     # px per row
PAD = 14    # terminal inner padding

THEMES = {
    "dark": dict(bg="#1d1e22", fg="#e4e4e4", dim="#8b8b8b", faint="#55575e", border="#5a5c63",
                 claude="#d97757", ok="#4eba65", err="#ff6b80", warn="#ffc107", blue="#b1b9f9",
                 cyan="#5fd7d7", sel="#2c2e35", errbg="#5a1d29", warnbg="#4d3b05", okbg="#163a22",
                 bluebg="#2d3052", chrome="#2a2b30", chromefg="#9a9a9a", page="#0f1012",
                 cap="#c9c9c9", capdim="#808080", mu="#ff5fd2", ink="#1d1e22"),
    "light": dict(bg="#ffffff", fg="#1f1f1f", dim="#6b6b6b", faint="#b5b5b5", border="#a8a8a8",
                  claude="#c2603f", ok="#2c7a39", err="#ab2b3f", warn="#8a6100", blue="#5769f7",
                  cyan="#167c80", sel="#eef0f4", errbg="#fbe3e7", warnbg="#fff1c7", okbg="#e1f3e4",
                  bluebg="#e6e9fe", chrome="#e8e8ea", chromefg="#555", page="#d9dadd",
                  cap="#2a2a2a", capdim="#666", mu="#d6249f", ink="#ffffff"),
}


class Screen:
    def __init__(self, cols, rows):
        self.cols, self.rows = cols, rows
        self.g = [[(" ", "") for _ in range(cols)] for _ in range(rows)]

    def put(self, r, c, text, st="", w=None):
        if w is not None and len(text) > w:
            text = text[: max(0, w - 1)] + "…"
        for i, ch in enumerate(text):
            if 0 <= r < self.rows and 0 <= c + i < self.cols:
                self.g[r][c + i] = (ch, st)
        return c + len(text)

    def seq(self, r, c, parts):
        """parts: list of (text, style)."""
        for t, st in parts:
            c = self.put(r, c, t, st)
        return c

    def rput(self, r, c_end, text, st=""):
        """right-align text ending at column c_end (exclusive)."""
        return self.put(r, c_end - len(text), text, st)

    def rseq(self, r, c_end, parts):
        n = sum(len(t) for t, _ in parts)
        return self.seq(r, c_end - n, parts)

    def fill(self, r, c, w, ch=" ", st=""):
        self.put(r, c, ch * w, st)

    def bg(self, r, c, w, st):
        for i in range(w):
            ch, old = self.g[r][c + i]
            self.g[r][c + i] = (ch, (old + " " + st).strip())

    def box(self, r, c, h, w, title=None, st="border", tst="dim b", style="round", right=None, rst="dim"):
        tl, tr, bl, br, hz, vt = {"round": "╭╮╰╯─│", "single": "┌┐└┘─│", "bold": "┏┓┗┛━┃",
                                  "double": "╔╗╚╝═║"}[style]
        self.put(r, c, tl + hz * (w - 2) + tr, st)
        for i in range(1, h - 1):
            self.put(r + i, c, vt, st)
            self.put(r + i, c + w - 1, vt, st)
        self.put(r + h - 1, c, bl + hz * (w - 2) + br, st)
        if title:
            self.put(r, c + 2, " " + title + " ", tst)
        if right:
            self.put(r, c + w - 3 - len(right), " " + right + " ", rst)


def _cls(st):
    out = []
    for tok in st.split():
        if tok == "b":
            out.append("B")
        elif tok == "i":
            out.append("I")
        elif tok == "mu":
            out.append("MU")
        elif tok == "u":
            out.append("U")
        elif tok.startswith("bg-"):
            out.append("k-" + tok[3:])
        else:
            out.append("f-" + tok)
    return " ".join(out)


def grid_html(s):
    rows = []
    for row in s.g:
        parts, cur, buf = [], None, []

        def flush():
            if buf:
                inner = "".join(buf)
                parts.append(f'<span class="{_cls(cur)}">{inner}</span>' if cur else f"<span>{inner}</span>")

        for ch, st in row:
            if st != cur:
                flush()
                cur, buf = st, []
            if ord(ch) < 128:
                buf.append(html.escape(ch))
            else:
                buf.append(f'<i class="w">{html.escape(ch)}</i>')
        flush()
        rows.append('<div class="row">' + "".join(parts) + "</div>")
    return "\n".join(rows)


def page(s, theme, title, caption, notes, wintitle="~/src/shop — claude", caph=130):
    t = THEMES[theme]
    cssvars = ";".join(f"--{k}:{v}" for k, v in t.items())
    colors = "".join(f".f-{k}{{color:var(--{k})}}.k-{k}{{background:var(--{k})}}" for k in t)
    W = s.cols * CW + 2 * PAD
    H = s.rows * LH + 2 * PAD
    notes_html = "".join(f"<li>{n}</li>" for n in notes)
    doc = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:JBM;src:url(file:///Users/alberto/Library/Fonts/JetBrainsMonoNerdFontMono-Regular.ttf)}}
@font-face{{font-family:JBM;font-weight:700;src:url(file:///Users/alberto/Library/Fonts/JetBrainsMonoNerdFontMono-Bold.ttf)}}
@font-face{{font-family:JBM;font-style:italic;src:url(file:///Users/alberto/Library/Fonts/JetBrainsMonoNerdFontMono-Italic.ttf)}}
:root{{{cssvars}}}
html,body{{margin:0;background:var(--page)}}
.wrap{{padding:28px 32px 22px;display:inline-block}}
.win{{border-radius:10px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.35);border:1px solid var(--faint)}}
.bar{{height:30px;background:var(--chrome);display:flex;align-items:center;position:relative;font:12px -apple-system,Helvetica,sans-serif;color:var(--chromefg)}}
.dots{{display:flex;gap:8px;margin-left:12px}}.dots i{{width:12px;height:12px;border-radius:6px;display:block}}
.bar .t{{position:absolute;left:0;right:0;text-align:center}}
.term{{background:var(--bg);color:var(--fg);padding:{PAD}px;width:{s.cols*CW}px;height:{s.rows*LH}px;font-family:JBM;font-size:15px}}
.row{{height:{LH}px;white-space:pre;line-height:{LH}px}}
.row span{{display:inline-block;height:{LH}px;vertical-align:top}}
i.w{{font-style:normal;display:inline-block;width:{CW}px;text-align:center;overflow:visible}}
.B{{font-weight:700}}.I{{font-style:italic}}.U{{text-decoration:underline}}
.MU{{text-decoration:underline dotted var(--mu) 2px;text-underline-offset:4px}}
{colors}
.cap{{font:13px/1.45 -apple-system,Helvetica,sans-serif;color:var(--cap);margin-top:14px;width:{W}px;height:{caph}px;overflow:hidden}}
.cap h1{{font-size:15px;margin:0 0 4px;font-weight:650}}
.cap ul{{margin:4px 0 0 0;padding-left:18px;color:var(--capdim)}}
.cap .mk{{text-decoration:underline dotted var(--mu) 2px;text-underline-offset:3px;color:var(--cap)}}
</style></head><body><div class="wrap">
<div class="win"><div class="bar"><div class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div><div class="t">{html.escape(wintitle)} — {s.cols}×{s.rows}</div></div>
<div class="term">{grid_html(s)}</div></div>
<div class="cap"><h1>{html.escape(title)}</h1>{caption}<ul>{notes_html}</ul></div>
</div></body></html>"""
    return doc, W + 64 + 2, 28 + 30 + H + 2 + 14 + caph + 22
