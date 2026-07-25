#!/usr/bin/env python3
"""Assemble the Uzbekistan Data Atlas pages.

Body fragments live in dashboard/pages/*.html; finding pages are generated from
the notes in "03 Findings/" — the short note becomes the plain-language layer,
the long note becomes the collapsible "the numbers" layer. One shell for all of
them, so the masthead, nav and footer exist in exactly one place.

    python3 dashboard/build_site.py
"""
import html
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FINDINGS_SRC = os.path.join(ROOT, "03 Findings")
PAGES = os.path.join(ROOT, "dashboard", "pages")
SITE = os.path.join(ROOT, "uzbekistan")

SITE_TITLE = "Uzbekistan Data Atlas"

# ─────────────────────────────────── findings ──────────────────────────────
# slug -> display title, plain-language note, technical note (may be None),
# status, section, chart id.
#
# The display title overrides the note's own H1. The notes are written for the
# vault and lean on shorthand ("The reshuffle", "The eaten disinflation") that
# means nothing to a reader arriving cold — so the site says plainly what each
# finding found. Sections must stay contiguous: the index starts a new block
# whenever the section name changes.
FINDINGS = [
    ("the-reshuffle", "Shortages and price rises hit different households",
     "16 The reshuffle — shortage and price hit different households.md",
     "18 The reshuffle — rationing and repricing swapped the losers.md",
     "proven", "The 2024 energy tariff", "reshuffle"),
    ("grid-not-income", "Who paid depended on gas connection, not income",
     "09 Incidence ran on the grid, not on income.md",
     "09 Incidence ran on the grid, not income.md",
     "proven", "The 2024 energy tariff", "gridAccess"),
    ("frozen-bill", "Energy bills rose about 70%, almost all of it in winter",
     "01 The frozen bill — a winter-shaped price shock.md",
     "01 The frozen bill and the first stage.md",
     "proven", "The 2024 energy tariff", "frozenBill"),
    ("winter-burden", "Annual averages hide the winter cost increase",
     "02 The winter burden hidden by annual averages.md",
     "02 The winter burden — energy share of income.md",
     "proven", "The 2024 energy tariff", "winterBurden"),
    ("heating-bite", "Grid households fell behind on winter bills after the reform",
     "03 The winter heating bite (triple-difference).md",
     "03 The heating bite — winter triple-diff.md",
     "proven", "The 2024 energy tariff", "heatingBite"),
    ("reliability", "Electricity supply improved before the tariff, not because of it",
     "04 Reliability recovered before the tariff, not because of it.md",
     "04 Reliability — imports restored it, the tariff repriced it.md",
     "proven", "The 2024 energy tariff", "reliability"),
    ("two-winters", "Payment problems spiked twice, for two different reasons",
     "05 Two winters, two crises (event study).md",
     "05 Two winters, two crises — the event study.md",
     "proven", "The 2024 energy tariff", "eventStudy"),
    ("recomposition", "Farm income gains were measurable, energy losses were not",
     "06 Gains were visible, losses were masked (recomposition).md",
     "06 Gains visible, losses masked — the recomposition.md",
     "proven", "The 2024 energy tariff", "recomposition"),
    ("eaten-disinflation", "Inflation stayed flat in 2024 while every neighbour's fell",
     "07 The eaten disinflation (CPI placebo).md",
     "07 The three masks — CPI placebo and within-survey prices.md",
     "proven", "The 2024 energy tariff", "cpiPeers"),
    ("revenue-not-conservation", "Energy use barely changed after prices rose",
     "08 Revenue, not conservation — demand was inelastic.md",
     "08 Revenue, not conservation.md",
     "proven", "The 2024 energy tariff", "elasticity"),
    ("compensation-16", "Compensation for the tariff reached 16 households",
     "11 The compensation channel reached 16 households.md",
     "11 Targeting failure — compensation reached 16 households.md",
     "proven", "The 2024 energy tariff", "compensation"),

    ("tsarist-railways", "An 1888 railway still predicts local wealth",
     "14 Tsarist railway persistence in today's wealth.md",
     "14 Tsarist railway persistence.md",
     "descriptive", "History and geography", "railway"),
    ("soviet-gas-paradox", "Gas-producing regions have the least gas access",
     "13 The Soviet gas paradox.md", None,
     "descriptive", "History and geography", "gasParadox"),
    ("gas-dividend", "Uzbekistan stopped being a gas exporter",
     "12 The end of the gas dividend.md", None,
     "descriptive", "History and geography", "gasDividend"),

    ("cotton-monopsony", "Cotton prices fell while almost every other crop rose",
     "10 The cotton monopsony and subsidy bunching.md",
     "10 The ag arm — cotton monopsony and subsidy bunching.md",
     "descriptive", "Agriculture", "cotton"),

    ("robustness", "Claims that did not survive further testing",
     "15 Robustness checks and claims we withdrew.md",
     "15 Robustness and withdrawn claims.md",
     "revised", "Method and limitations", "robustness"),
    ("dead-ends", "Approaches that were tried and abandoned",
     "19 Dead ends — natural experiments tried and killed.md", None,
     "null", "Method and limitations", None),

    ("college-reversal", "Vocational enrolment collapsed after the 2017 reform",
     "17 Banked — the compulsory-college reversal cohort cliff.md",
     "16 Banked — the compulsory-college reversal.md",
     "banked", "Waiting on data", "cohortCliff"),

    ("background", "Other findings from the wider data",
     "18 Broad background findings (off-topic).md",
     "17 Background — broad exploration findings.md",
     "descriptive", "Other findings", None),
]

STATUS_BLURB = {
    "proven": "Identified — the estimate holds up under the panel's fixed effects.",
    "descriptive": "Real in the data, but not causally identified.",
    "revised": "The honesty ledger — what did not survive a harder test.",
    "banked": "Real, but the outcome window has not matured.",
    "null": "Tried and killed. Recorded so it is not re-hunted.",
}

# Pages built from dashboard/pages/<name>.html
# `topic` sets data-topic on <html>, which swaps --primary and the sequential
# ramp in atlas.css. Only pages with their own identity hue declare one.
STATIC_PAGES = [
    # (output path,        fragment,   title,               nav key,   module,   depth, topic)
    ("index.html",           "home",        None,                "home",        "home",        0, None),
    ("explore.html",         "explore",     "Explore the data",  "explore",     "explore",     0, None),
    ("about.html",           "about",       "About this atlas",  "about",       None,          0, None),
    ("topics/energy.html",   "energy",      "Electricity & gas", "energy",      "energy",      1, "energy"),
    ("topics/gold.html",     "gold",        "Gold",              "gold",        "gold",        1, None),
    ("topics/agriculture.html", "agriculture", "Agriculture",    "agriculture", "agriculture", 1, "agriculture"),
    ("topics/prices.html",   "prices",      "Prices & money",    "prices",      "prices",      1, None),
    ("topics/people.html",   "people",      "People & work",     "people",      "people",      1, None),
    ("topics/climate.html",  "climate",     "Climate & water",   "climate",     "climate",     1, None),
    ("topics/map.html",      "map",         "The map",           "map",         "map",         1, None),
]

NAV = [
    ("link", "findings", "Findings", "findings/"),
    ("sep", None),
    ("group", "Topics"),
    ("link", "energy", "Energy", "topics/energy.html"),
    ("link", "gold", "Gold", "topics/gold.html"),
    ("link", "agriculture", "Agriculture", "topics/agriculture.html"),
    ("link", "prices", "Prices", "topics/prices.html"),
    ("link", "people", "People", "topics/people.html"),
    ("link", "climate", "Climate", "topics/climate.html"),
    ("link", "map", "Map", "topics/map.html"),
    ("sep", None),
    ("link", "explore", "Explore", "explore.html"),
    ("link", "about", "About", "about.html"),
]


# ──────────────────────────────── markdown ────────────────────────────────
def strip_frontmatter(text):
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            meta = text[3:end]
            return text[end + 4:].lstrip("\n"), meta
    return text, ""


STAR = "\x00STAR\x00"
SIGMARK = "\x00S%d\x00"
PUNCT = set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~—–…×→≈")


def _flanking(s, start, end):
    """CommonMark left/right-flanking for the asterisk run s[start:end].

    Left-flanking runs may open emphasis, right-flanking runs may close it.
    """
    prev = s[start - 1] if start > 0 else ""
    nxt = s[end] if end < len(s) else ""
    prev_ws = prev == "" or prev.isspace()
    next_ws = nxt == "" or nxt.isspace()
    prev_p = prev in PUNCT
    next_p = nxt in PUNCT
    left = not next_ws and (not next_p or prev_ws or prev_p)
    right = not prev_ws and (not prev_p or next_ws or next_p)
    return left, right


def _emphasis(s):
    """Resolve ** runs into bold, and leave the rest as significance stars.

    The notes write things like `**43 rose (median +55%)** 2022–24` alongside
    `wage receipt −2.5pp***; (3) …`. Both put a star run straight after a value,
    so no regex can tell a bold-close from a significance marker — only the
    open/close state and the flanking rules can.
    """
    runs = [(m.start(), m.end()) for m in re.finditer(r"\*+", s)]
    flags = [(a, b, *_flanking(s, a, b)) for a, b in runs]

    out, cursor, in_bold = [], 0, False
    for i, (a, b, left, right) in enumerate(flags):
        out.append(s[cursor:a])
        n = b - a
        if n < 2:
            # single star: italic is handled later; keep it for that pass
            out.append(s[a:b])
        elif in_bold and right:
            out.append("</strong>")
            in_bold = False
            if n > 2:
                out.append(SIGMARK % (n - 2))
        elif not in_bold and left and any(r for *_, r in flags[i + 1:]):
            out.append("<strong>")
            in_bold = True
        elif right:
            out.append(SIGMARK % n)
        # otherwise an orphaned delimiter — drop it
        cursor = b
    out.append(s[cursor:])
    if in_bold:
        out.append("</strong>")
    return "".join(out)


def inline(s):
    """Inline markdown -> HTML. Everything is escaped first."""
    s = html.escape(s, quote=False)
    s = s.replace(r"\*", STAR)                      # \* is a literal star

    code = []
    def _stash(m):
        code.append(m.group(1))
        return "\x00C%d\x00" % (len(code) - 1)
    s = re.sub(r"`([^`]+)`", _stash, s)             # stars in code are literal

    # images/embeds point into the private vault — never published
    s = re.sub(r"!\[\[[^\]]+\]\]", "", s)
    s = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", s)
    s = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", s)
    s = re.sub(r"\[\[([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)",
               r'<a href="\2" rel="noopener">\1</a>', s)
    s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s)

    s = _emphasis(s)
    s = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<em>\1</em>", s)
    s = re.sub(r"(?<![\w_])_([^_\n]+)_(?![\w_])", r"<em>\1</em>", s)
    s = re.sub(r"(?<![\w*])\*(?![\w*])", "", s)     # leftover single stars

    # escaped stars (\*\*) are significance too — restore runs as one mark
    s = re.sub(r"(?:%s)+" % re.escape(STAR),
               lambda m: SIGMARK % (len(m.group(0)) // len(STAR)), s)
    s = re.sub(r"\x00S(\d+)\x00",
               lambda m: '<span class="sig">%s</span>' % ("*" * int(m.group(1))), s)
    s = re.sub(r"\x00C(\d+)\x00", lambda m: "<code>%s</code>" % code[int(m.group(1))], s)
    return s


def md_to_html(text, heading_offset=1):
    """A small, deliberate markdown subset: the notes only use this much."""
    out, lines, i = [], text.split("\n"), 0
    list_stack = []

    def close_lists(to=0):
        while len(list_stack) > to:
            out.append(f"</{list_stack.pop()}>")

    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()

        if line.strip().startswith("```"):
            close_lists()
            lang = line.strip()[3:].strip()
            i += 1
            buf = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            cls = f' class="language-{html.escape(lang)}"' if lang else ""
            out.append(f"<pre><code{cls}>{html.escape(chr(10).join(buf))}</code></pre>")
            continue

        if not line.strip():
            close_lists()
            i += 1
            continue

        if re.match(r"^\s*(---|\*\*\*|___)\s*$", line):
            close_lists()
            out.append("<hr>")
            i += 1
            continue

        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            close_lists()
            lvl = min(6, len(m.group(1)) + heading_offset)
            out.append(f"<h{lvl}>{inline(m.group(2))}</h{lvl}>")
            i += 1
            continue

        # table
        if "|" in line and i + 1 < len(lines) and re.match(r"^\s*\|?[\s:|-]+\|[\s:|-]*$", lines[i + 1]):
            close_lists()
            def cells(r):
                r = r.strip()
                if r.startswith("|"):
                    r = r[1:]
                if r.endswith("|"):
                    r = r[:-1]
                return [c.strip() for c in r.split("|")]
            head = cells(line)
            i += 2
            body = []
            while i < len(lines) and "|" in lines[i] and lines[i].strip():
                body.append(cells(lines[i]))
                i += 1
            th = "".join(f"<th>{inline(c)}</th>" for c in head)
            trs = []
            for row in body:
                row = (row + [""] * len(head))[:len(head)]
                tds = "".join(
                    f'<td class="num">{inline(c)}</td>' if re.match(r"^[−+\-]?[\d.,]+%?\**$", c.strip())
                    else f"<td>{inline(c)}</td>"
                    for c in row)
                trs.append(f"<tr>{tds}</tr>")
            out.append('<div class="tableview"><table class="data"><thead><tr>'
                       + th + "</tr></thead><tbody>" + "".join(trs) + "</tbody></table></div>")
            continue

        if line.lstrip().startswith(">"):
            close_lists()
            buf = []
            while i < len(lines) and lines[i].lstrip().startswith(">"):
                buf.append(lines[i].lstrip()[1:].strip())
                i += 1
            out.append(f"<blockquote><p>{inline(' '.join(buf))}</p></blockquote>")
            continue

        m = re.match(r"^(\s*)([-*+]|\d+\.)\s+(.*)$", line)
        if m:
            indent, marker, body = len(m.group(1)), m.group(2), m.group(3)
            tag = "ol" if marker.endswith(".") else "ul"
            depth = indent // 2 + 1
            while len(list_stack) > depth:
                out.append(f"</{list_stack.pop()}>")
            while len(list_stack) < depth:
                out.append(f"<{tag}>")
                list_stack.append(tag)
            out.append(f"<li>{inline(body)}</li>")
            i += 1
            continue

        close_lists()
        buf = [line.strip()]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(
                r"^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>|```|\|)", lines[i]) and \
                not re.match(r"^\s*(---|\*\*\*|___)\s*$", lines[i]):
            buf.append(lines[i].strip())
            i += 1
        out.append(f"<p>{inline(' '.join(buf))}</p>")

    close_lists()
    return "\n".join(out)


def strip_tags(s):
    """Plain text for JSON payloads — the gallery inserts with textContent."""
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def read_note(fn):
    path = os.path.join(FINDINGS_SRC, fn)
    with open(path, encoding="utf-8") as f:
        return strip_frontmatter(f.read())[0]


def split_note(text):
    """Pull the H1, the 'In one line' hook, the caveats, and the rest."""
    lines = text.split("\n")
    title = ""
    body = []
    oneline = ""
    for ln in lines:
        m = re.match(r"^#\s+(.*)$", ln)
        if m and not title:
            title = m.group(1).strip()
            continue
        m = re.match(r"^\*\*In one line:\*\*\s*(.*)$", ln)
        if m and not oneline:
            oneline = m.group(1).strip()
            continue
        body.append(ln)

    joined = "\n".join(body)

    # Sections that only make sense inside the private vault.
    for head in ("Links", "Exhibits"):
        m = re.search(rf"^##\s+{head}\s*$", joined, re.M)
        if m:
            rest = joined[m.end():]
            nxt = re.search(r"^##\s", rest, re.M)
            joined = joined[:m.start()] + (rest[nxt.start():] if nxt else "")

    # Caveat headings vary: "**Caveats**", "## Caveats", "**Caveats (why …)**".
    caveats = ""
    m = (re.search(r"^\*\*Caveats?\b[^\n]*\*\*\s*$", joined, re.M)
         or re.search(r"^##\s+Caveats?\b[^\n]*$", joined, re.M))
    if m:
        rest = joined[m.end():]
        nxt = re.search(r"^(##\s|\*\*[A-Z])", rest, re.M)
        caveats = rest[:nxt.start()] if nxt else rest
        joined = joined[:m.start()] + (rest[nxt.start():] if nxt else "")

    joined = joined.strip()
    if not oneline:
        # Some notes have no "In one line" hook — fall back to the first real
        # sentence of the body so a card is never left blank.
        for para in re.split(r"\n\s*\n", joined):
            para = para.strip()
            if not para or re.match(r"^\s*(#|\||>|```|[-*+]\s|\d+\.\s)", para):
                continue
            flat = re.sub(r"\s+", " ", para)
            m = re.match(r"(.+?[.!?])(\s|$)", flat)
            oneline = (m.group(1) if m else flat)[:240]
            break
    if oneline:
        oneline = oneline[0].upper() + oneline[1:]
    return title, oneline, joined, caveats.strip()


# ────────────────────────────────── shell ─────────────────────────────────
def rel(depth, path):
    return ("../" * depth) + path if depth else path


def mod_rel(depth, path):
    """Module specifier: bare paths are illegal in ESM, so depth 0 needs './'."""
    return rel(depth, path) if depth else "./" + path


def nav_html(active, depth):
    out = []
    for item in NAV:
        if item[0] == "group":
            out.append(f'<span class="nav-group">{html.escape(item[1])}</span>')
        elif item[0] == "sep":
            out.append('<span class="nav-sep" aria-hidden="true"></span>')
        else:
            _, key, label, href = item
            cur = ' aria-current="page"' if key == active else ""
            out.append(f'<a href="{rel(depth, href)}"{cur}>{html.escape(label)}</a>')
    return "\n      ".join(out)


def shell(*, title, body, depth, active, module=None, description="",
          body_attrs="", head_extra="", topic=None):
    base = ("../" * depth).rstrip("/") or "."
    full_title = title if title == SITE_TITLE else f"{title} · {SITE_TITLE}"
    desc = description or (
        "An interactive atlas of Uzbek economic, energy and household data, and "
        "the research findings drawn from it.")
    mod = (f'\n<script type="module" src="{mod_rel(depth, "assets/pages/" + module + ".js")}"></script>'
           if module else
           f'\n<script type="module">import {{ boot }} from "{mod_rel(depth, "assets/atlas.js")}"; boot();</script>')
    return f"""<!doctype html>
<html lang="en" data-base="{base}"{(' data-topic="' + topic + '"') if topic else ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(full_title)}</title>
<meta name="description" content="{html.escape(desc)}">
<meta name="color-scheme" content="light dark">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..700&family=IBM+Plex+Mono:wght@400;500&family=Newsreader:opsz,wght@6..72,300..600&display=swap">
<link rel="stylesheet" href="{rel(depth, 'assets/atlas.css')}">{head_extra}
</head>
<body{body_attrs}>
<a class="skip" href="#main">Skip to content</a>

<header class="masthead">
  <div class="masthead-in">
    <a class="wordmark" href="{rel(depth, 'index.html')}">Uzbekistan <span class="thin">Data Atlas</span></a>
    <div class="counts"></div>
  </div>
</header>

<div class="spine" aria-hidden="true" title="Every Meta wealth cell in Uzbekistan, ordered by distance from the 1888 Trans-Caspian railway. Blue is wealthier, red is poorer.">
  <canvas></canvas>
  <div class="spine-key">
    <span>On the 1888 railway</span>
    <span>400 km away</span>
  </div>
</div>

<nav class="nav" aria-label="Sections">
  <div class="nav-in">
      {nav_html(active, depth)}
    <button class="theme-toggle" type="button">Dark</button>
  </div>
</nav>

{body}

<footer class="site">
  <div class="in">
    <div>
      <h4>The atlas</h4>
      <ul>
        <li><a href="{rel(depth, 'index.html')}">Overview</a></li>
        <li><a href="{rel(depth, 'findings/')}">Findings</a></li>
        <li><a href="{rel(depth, 'explore.html')}">Explore the data</a></li>
        <li><a href="{rel(depth, 'about.html')}">About &amp; sources</a></li>
      </ul>
    </div>
    <div>
      <h4>Topics</h4>
      <ul>
        <li><a href="{rel(depth, 'topics/energy.html')}">Electricity &amp; gas</a></li>
        <li><a href="{rel(depth, 'topics/gold.html')}">Gold</a></li>
        <li><a href="{rel(depth, 'topics/agriculture.html')}">Agriculture</a></li>
        <li><a href="{rel(depth, 'topics/prices.html')}">Prices &amp; money</a></li>
        <li><a href="{rel(depth, 'topics/people.html')}">People &amp; work</a></li>
        <li><a href="{rel(depth, 'topics/climate.html')}">Climate &amp; water</a></li>
        <li><a href="{rel(depth, 'topics/map.html')}">The map</a></li>
      </ul>
    </div>
    <div>
      <h4>Sources</h4>
      <ul>
        <li>Listening to the Citizens of Uzbekistan (L2CU) panel</li>
        <li>stat.uz · Statistics Agency of Uzbekistan</li>
        <li>World Bank WDI · FAO · UN Comtrade</li>
        <li>WFP seasonal explorer · Meta Data for Good</li>
      </ul>
    </div>
    <div>
      <h4>Reading the numbers</h4>
      <p style="margin:0;max-width:34ch">Every chart has a table view. Findings are
      labelled by how much they can carry: identified, descriptive, revised, banked,
      or killed.</p>
    </div>
  </div>
</footer>
{mod}
</body>
</html>
"""


# ─────────────────────────────── finding pages ────────────────────────────
def build_findings():
    entries = []
    for slug, short, plain_fn, tech_fn, status, group, chart in FINDINGS:
        plain = read_note(plain_fn)
        _, oneline, body, caveats = split_note(plain)
        tech_html = ""
        if tech_fn:
            _, _, t_body, t_caveats = split_note(read_note(tech_fn))
            merged = t_body + (("\n\n## Caveats\n\n" + t_caveats) if t_caveats else "")
            tech_html = md_to_html(merged, heading_offset=1)
        # `short` is the site's plain title; the note's own H1 is kept as a
        # subtitle only where it says something the title does not.
        entries.append(dict(slug=slug, short=short, title=short,
                            oneline=oneline, body=body,
                            caveats=caveats, status=status, group=group,
                            chart=chart, tech=tech_html))

    os.makedirs(os.path.join(SITE, "findings"), exist_ok=True)

    for idx, e in enumerate(entries):
        prev_e = entries[idx - 1] if idx else None
        next_e = entries[idx + 1] if idx + 1 < len(entries) else None

        chart_block = ""
        if e["chart"]:
            chart_block = (
                '\n  <figure class="card" style="margin:26px 0 0">\n'
                f'    <div id="finding-chart"></div>\n'
                "  </figure>\n")

        caveat_block = ""
        if e["caveats"]:
            caveat_block = (
                '\n  <aside class="caveats">\n    <h3>What this cannot carry</h3>\n    '
                + md_to_html(e["caveats"], heading_offset=2)
                + "\n  </aside>\n")

        tech_block = ""
        if e["tech"]:
            tech_block = (
                '\n  <details class="technical">\n'
                "    <summary>The numbers — specification, coefficients and caveats</summary>\n"
                '    <div class="technical-body">\n'
                f'      <div class="prose">{e["tech"]}</div>\n'
                "    </div>\n  </details>\n")

        pager = ['<div class="pager">']
        if prev_e:
            pager.append(f'<a href="{prev_e["slug"]}.html"><span class="lbl">Previous</span>'
                         f'{html.escape(prev_e["short"])}</a>')
        else:
            pager.append("<span></span>")
        if next_e:
            pager.append(f'<a href="{next_e["slug"]}.html" style="text-align:right">'
                         f'<span class="lbl">Next</span>{html.escape(next_e["short"])}</a>')
        else:
            pager.append("<span></span>")
        pager.append("</div>")

        body = f"""<main id="main" class="reading">
  <p class="eyebrow"><a href="./" style="text-decoration:none;color:inherit">Findings</a> · {html.escape(e["group"])}</p>
  <div class="finding-head">
    <h1>{html.escape(e["title"])}</h1>
    {f'<p class="oneline">{inline(e["oneline"])}</p>' if e["oneline"] else ""}
    <p style="margin:14px 0 0"><span class="status" data-status="{e['status']}">{e['status']}</span>
      <span style="font-size:13px;color:var(--ink-muted);margin-left:8px">{html.escape(STATUS_BLURB[e['status']])}</span></p>
  </div>
{chart_block}
  <div class="prose" style="margin-top:26px">{md_to_html(e["body"], heading_offset=1)}</div>
{caveat_block}{tech_block}
  {''.join(pager)}
</main>"""

        out = shell(title=e["title"], body=body, depth=1, active="findings",
                    module="finding",
                    description=e["oneline"] or e["title"],
                    body_attrs=f' data-finding="{e["chart"]}"' if e["chart"] else "")
        with open(os.path.join(SITE, "findings", e["slug"] + ".html"), "w",
                  encoding="utf-8") as f:
            f.write(out)

    # index
    groups = []
    for e in entries:
        if not groups or groups[-1][0] != e["group"]:
            groups.append((e["group"], []))
        groups[-1][1].append(e)

    sections = []
    for gname, items in groups:
        cards = []
        for e in items:
            cards.append(
                f'<a class="finding-card" href="{e["slug"]}.html">'
                f'<span class="status" data-status="{e["status"]}">{e["status"]}</span>'
                f'<h3>{html.escape(e["title"])}</h3>'
                f'<p>{inline(e["oneline"]) if e["oneline"] else ""}</p></a>')
        sections.append(
            f'<section class="section"><div class="section-head"><h2>{html.escape(gname)}</h2></div>'
            f'<div class="finding-list">{"".join(cards)}</div></section>')

    index_body = f"""<main id="main">
  <p class="eyebrow">Findings</p>
  <h1>Nineteen findings from the Uzbek data</h1>
  <p class="lede">Each is a standalone result with its own page: the claim in plain
  language and a chart first, the specification and the coefficients behind a fold.
  Nothing is arranged into an argument — they are labelled by how much weight each one
  can carry, and several are here because they failed.</p>

  <div class="stats" style="margin:0 0 40px">
    <div class="stat"><span class="v">{sum(1 for e in entries if e["status"] == "proven")}</span><span class="k">identified — hold up under household fixed effects</span></div>
    <div class="stat"><span class="v">{sum(1 for e in entries if e["status"] == "descriptive")}</span><span class="k">descriptive — real, not causally identified</span></div>
    <div class="stat"><span class="v">{sum(1 for e in entries if e["status"] in ("revised", "null"))}</span><span class="k">revised or killed — the honesty ledger</span></div>
    <div class="stat"><span class="v">{sum(1 for e in entries if e["status"] == "banked")}</span><span class="k">banked — waiting on data that has not arrived</span></div>
  </div>

  {"".join(sections)}
</main>"""
    with open(os.path.join(SITE, "findings", "index.html"), "w", encoding="utf-8") as f:
        f.write(shell(title="Findings", body=index_body, depth=1, active="findings",
                      description="Standalone research findings from Uzbek household, "
                                  "energy and historical data — each with its claim, its "
                                  "chart and its caveats."))

    # The home page's rotating gallery reads this rather than re-parsing notes.
    import json
    # inline() first, then strip: the gallery inserts with textContent, so raw
    # markdown emphasis would otherwise show up as literal asterisks.
    index = [{"slug": e["slug"], "title": e["title"],
              "oneline": strip_tags(inline(e["oneline"])),
              "status": e["status"], "group": e["group"], "hasChart": bool(e["chart"])}
             for e in entries]
    data_dir = os.path.join(SITE, "data")
    os.makedirs(data_dir, exist_ok=True)
    with open(os.path.join(data_dir, "findings-index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, separators=(",", ":"), ensure_ascii=False)
    print(f"  data/findings-index.json ({len(index)} entries)")
    return entries


# ─────────────────────────────── static pages ─────────────────────────────
def build_static():
    for out_path, frag, title, active, module, depth, topic in STATIC_PAGES:
        src = os.path.join(PAGES, frag + ".html")
        if not os.path.exists(src):
            print(f"  ! missing fragment {frag}.html — skipped")
            continue
        with open(src, encoding="utf-8") as f:
            raw = f.read()
        desc = ""
        m = re.match(r"\s*<!--\s*description:\s*(.*?)\s*-->\s*", raw, re.S)
        if m:
            desc = m.group(1)
            raw = raw[m.end():]
        page = shell(title=title or SITE_TITLE, body=raw, depth=depth,
                     active=active, module=module, description=desc, topic=topic)
        dest = os.path.join(SITE, out_path)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w", encoding="utf-8") as f:
            f.write(page)
        print(f"  {out_path}")


def main():
    if not os.path.isdir(FINDINGS_SRC):
        sys.exit(f"findings source not found: {FINDINGS_SRC}")
    print("Static pages ...")
    build_static()
    print("Finding pages ...")
    entries = build_findings()
    print(f"  {len(entries)} findings + index")
    print("Done.")


if __name__ == "__main__":
    main()
