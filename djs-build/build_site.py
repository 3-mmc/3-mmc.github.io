#!/usr/bin/env python3
"""Build the public club archive site (Nothing design system, dark mode).

Reads ../djs-build/data.json and writes:
  ../djs/index.html   - the published page, self-contained, fonts served from
                        ../djs/fonts/ so nothing is fetched from a third party
  build/artifact.html - body-only fragment with the fonts inlined as data URIs,
                        for redeploying the claude.ai artifact (its CSP blocks
                        font CDNs). Not published; build/ is not in git.

    python3 djs-build/build_site.py
"""
import json, re, base64, html as H
from pathlib import Path

BASE = Path(__file__).resolve().parent
SITE = BASE.parent / 'djs'
FONTS = SITE / 'fonts'
D = json.loads((BASE / 'data.json').read_text(encoding='utf-8'))

e = lambda s: H.escape(str(s), quote=True)

venues = sorted(D['venues'], key=lambda v: (-v['count'], v['venue']))
artists = D['artists']
sessions = D['longest_sessions']

def nkey(s):
    return re.sub(r'[^a-z0-9]+', '', s.lower())

by_name = {nkey(a['name']): a['id'] for a in artists}


def find(name):
    """Resolve a billed name to an index row: exact, then without a trailing
    qualifier such as '(NL)' or '(DJ SET)', which the index stores stripped."""
    return (by_name.get(nkey(name))
            or by_name.get(nkey(re.sub(r'\s*\([^)]*\)\s*$', '', name))))
n_nights = sum(len(v['nights']) for v in venues)
n_recs = sum(len(n['recordings']) for v in venues for n in v['nights'])
cities = sorted({v['city'] for v in venues if v['city']})
years = sorted({n['date'][:4] for v in venues for n in v['nights']})

# ---------------------------------------------------------------- CSS
CSS = """
:root{
 --black:#000;--surface:#111;--raised:#1A1A1A;--border:#222;--bvis:#333;
 --t-dis:#666;--t-sec:#999;--t-pri:#E8E8E8;--t-dsp:#FFF;--accent:#D71921;
 --s-xs:4px;--s-sm:8px;--s-md:16px;--s-lg:24px;--s-xl:32px;--s-2xl:48px;--s-3xl:64px;--s-4xl:96px;
 --ease:cubic-bezier(.25,.1,.25,1);
 color-scheme:dark;
}
*{box-sizing:border-box}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
html{scroll-behavior:smooth;scroll-padding-top:70px}
body{margin:0;background:var(--black);color:var(--t-pri);
 font-family:"Space Grotesk","DM Sans",system-ui,sans-serif;font-size:16px;line-height:1.5;
 -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.mono{font-family:"Space Mono","JetBrains Mono",ui-monospace,monospace}
.lbl{font-family:"Space Mono",ui-monospace,monospace;font-size:11px;line-height:1.2;
 letter-spacing:.08em;text-transform:uppercase;color:var(--t-sec)}
.wrap{max-width:1100px;margin:0 auto;padding:0 var(--s-lg)}
a{color:inherit}

/* ---- nav ---- */
nav.top{position:sticky;top:0;z-index:50;background:rgba(0,0,0,.92);
 border-bottom:1px solid var(--border);backdrop-filter:blur(8px)}
nav.top .wrap{display:flex;align-items:center;gap:var(--s-lg);height:56px;overflow-x:auto;
 scrollbar-width:none}
nav.top .wrap::-webkit-scrollbar{display:none}
nav.top a{font-family:"Space Mono",monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;
 color:var(--t-dis);text-decoration:none;white-space:nowrap;transition:color .2s var(--ease)}
nav.top a:hover,nav.top a:focus-visible{color:var(--t-dsp)}
nav.top a.brand{color:var(--t-dsp);margin-right:auto}

/* ---- hero ---- */
header.hero{padding:var(--s-4xl) 0 var(--s-3xl);border-bottom:1px solid var(--border);position:relative}
header.hero::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;
 background-image:radial-gradient(circle,var(--border) 1px,transparent 1px);background-size:16px 16px;
 -webkit-mask-image:linear-gradient(180deg,#000,transparent 70%);
 mask-image:linear-gradient(180deg,#000,transparent 70%)}
header.hero .wrap{position:relative}
.doto{font-family:"Doto","Space Mono",monospace;font-weight:900;color:var(--t-dsp);text-wrap:balance;
 letter-spacing:-.02em;line-height:.95;font-size:clamp(44px,11vw,104px);margin:var(--s-md) 0 0}
.tagline{color:var(--t-sec);max-width:56ch;margin:var(--s-lg) 0 0;font-size:15px}
.herofig{display:flex;align-items:flex-end;gap:var(--s-md);margin-top:var(--s-3xl)}
.heroval{font-family:"Space Mono",monospace;font-weight:700;font-size:clamp(56px,13vw,112px);
 line-height:.85;letter-spacing:-.04em;color:var(--t-dsp)}
.herounit{padding-bottom:10px}
.facts{display:flex;flex-wrap:wrap;gap:var(--s-xl);margin-top:var(--s-2xl);
 padding-top:var(--s-lg);border-top:1px solid var(--border)}
.fact b{display:block;font-family:"Space Mono",monospace;font-weight:700;font-size:22px;
 color:var(--t-pri);letter-spacing:-.02em}
.fact span{display:block;margin-top:var(--s-xs)}

/* ---- sections ---- */
section.blk{padding:var(--s-4xl) 0 0}
.shead{display:flex;align-items:baseline;gap:var(--s-md);flex-wrap:wrap;margin-bottom:var(--s-sm)}
.shead h2{font-size:24px;font-weight:500;letter-spacing:-.01em;margin:0;color:var(--t-dsp);
 text-wrap:balance}
.snote{color:var(--t-dis);max-width:64ch;font-size:14px;margin:0 0 var(--s-xl)}

/* ---- longest sessions ---- */
.ses{border-top:1px solid var(--border)}
.ses .row{display:grid;grid-template-columns:28px 1fr auto;gap:var(--s-md) var(--s-lg);
 align-items:baseline;padding:var(--s-lg) 0;border-bottom:1px solid var(--border)}
.rk{font-family:"Space Mono",monospace;font-size:11px;color:var(--t-dis)}
.row.one .rk{color:var(--accent)}
.svenue{font-size:19px;font-weight:500;color:var(--t-dsp);letter-spacing:-.01em}
.smeta{margin-top:var(--s-xs)}
.sdur{font-family:"Space Mono",monospace;font-weight:700;font-size:40px;line-height:1;
 letter-spacing:-.03em;color:var(--t-dsp);text-align:right;white-space:nowrap}
.blocks{display:flex;gap:2px;flex-wrap:wrap}
.blocks i{width:9px;height:10px;background:var(--bvis);flex:none}
.blocks i.on{background:var(--t-dsp)}
.segbar{grid-column:2/-1;margin-top:var(--s-sm)}
.row.one .blocks i.on{background:var(--accent)}
.fly{grid-column:2/-1;color:var(--t-dis);font-size:13px;margin-top:var(--s-sm);max-width:62ch}
.fly::before{content:"\\2708  ";color:var(--t-dis)}

/* ---- clubs ---- */
.clubs{border-top:1px solid var(--border)}
.club{display:grid;
 grid-template-columns:minmax(0,1.6fr) minmax(0,.8fr) minmax(60px,2fr) 36px;
 gap:var(--s-md);align-items:center;padding:11px 0;border-bottom:1px solid var(--border)}
.club>*{min-width:0}
.club .cv{overflow-wrap:break-word}
.club .cv{font-size:15px;color:var(--t-pri)}
.club a.cv{text-decoration:none;border-bottom:1px solid transparent;transition:.2s var(--ease)}
.club a.cv:hover{color:var(--t-dsp);border-bottom-color:var(--bvis)}
.cn{font-family:"Space Mono",monospace;font-size:14px;color:var(--t-dsp);text-align:right}

/* ---- filters ---- */
.tools{display:flex;flex-wrap:wrap;gap:var(--s-sm);align-items:center;margin-bottom:var(--s-lg)}
.chip{font-family:"Space Mono",monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;
 padding:6px 13px;border:1px solid var(--bvis);border-radius:999px;background:none;color:var(--t-sec);
 cursor:pointer;transition:.2s var(--ease)}
.chip:hover{color:var(--t-pri)}
.chip[aria-pressed="true"]{background:var(--t-dsp);border-color:var(--t-dsp);color:var(--black)}
.chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
input.srch{font-family:"Space Mono",monospace;font-size:13px;background:none;border:none;
 border-bottom:1px solid var(--bvis);color:var(--t-pri);padding:8px 2px;min-width:210px;flex:1;
 max-width:340px;transition:.2s var(--ease)}
input.srch::placeholder{color:var(--t-dis);text-transform:uppercase;letter-spacing:.06em;font-size:11px}
input.srch:focus{outline:none;border-bottom-color:var(--t-dsp)}
.count{margin-left:auto}

/* ---- night log ---- */
.vblk{margin-bottom:var(--s-2xl)}
.vhd{display:flex;align-items:baseline;gap:var(--s-md);flex-wrap:wrap;
 padding-bottom:var(--s-sm);border-bottom:1px solid var(--bvis)}
.vhd h3{margin:0;font-size:17px;font-weight:500;color:var(--t-dsp);letter-spacing:-.01em}
.vhd .n{margin-left:auto;font-family:"Space Mono",monospace;font-size:12px;color:var(--t-sec)}
.night{display:grid;grid-template-columns:118px minmax(0,1fr);gap:var(--s-lg);
 padding:var(--s-md) 0;border-bottom:1px solid var(--border)}
.night>*{min-width:0}
.ndate{font-family:"Space Mono",monospace;font-size:12px;color:var(--t-sec);white-space:nowrap}
.ndate span{display:block;color:var(--t-dis);font-size:11px;margin-top:3px;letter-spacing:.06em}
.nev{font-size:15px;font-weight:500;color:var(--t-dsp);letter-spacing:-.005em}
.nlu{margin-top:var(--s-xs);font-size:14px;color:var(--t-pri);line-height:1.55;
 overflow-wrap:break-word}
.nlu a{text-decoration:none;border-bottom:1px solid transparent;transition:.2s var(--ease)}
.nlu a:hover{color:var(--t-dsp);border-bottom-color:var(--bvis)}
.nlu .sep{color:var(--t-dis)}
.nnone{margin-top:var(--s-xs);font-size:13px;color:var(--t-dis)}
.recs{margin-top:10px;display:flex;flex-direction:column;gap:5px}
.rec{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;font-size:13px}
.rec a{color:var(--accent);text-decoration:none;border-bottom:1px solid transparent;
 transition:.2s var(--ease)}
.rec a:hover{border-bottom-color:var(--accent)}
.rec a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rec .pl{font-family:"Space Mono",monospace;font-size:11px;color:var(--accent)}
.rec .who{color:var(--t-pri)}
.rec .min{font-family:"Space Mono",monospace;font-size:11px;color:var(--t-dis)}

/* ---- artist table ---- */
.tblwrap{overflow-x:auto;border-top:1px solid var(--bvis)}
table{border-collapse:collapse;width:100%;min-width:640px}
th{font-family:"Space Mono",monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;
 color:var(--t-sec);font-weight:400;text-align:left;padding:12px 16px 12px 0;
 border-bottom:1px solid var(--bvis);white-space:nowrap}
th.srt{cursor:pointer;user-select:none}
th.srt:hover{color:var(--t-dsp)}
th.srt:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
th.srt::after{content:"\\2195";opacity:.3;margin-left:6px;font-size:9px}
th[aria-sort="ascending"]::after{content:"\\2191";opacity:1;color:var(--t-dsp)}
th[aria-sort="descending"]::after{content:"\\2193";opacity:1;color:var(--t-dsp)}
th.num,td.num{text-align:right}
td{padding:11px 16px 11px 0;border-bottom:1px solid var(--border);font-size:14px;vertical-align:top}
td.nm{color:var(--t-dsp);font-weight:500;white-space:nowrap}
td.num,td.dt{font-family:"Space Mono",monospace;font-size:12.5px;color:var(--t-sec)}
td.num{color:var(--t-pri)}
td.wh{color:var(--t-sec);font-size:13px}
td.pl a{color:var(--accent);text-decoration:none;font-size:13px}
td.pl a:hover{color:var(--t-dsp)}
tbody tr:target td,tbody tr.hl td{background:var(--raised)}
tbody tr:target td:first-child,tbody tr.hl td:first-child{box-shadow:inset 2px 0 0 var(--accent)}
.empty{padding:var(--s-4xl) 0;text-align:center}
.empty p{margin:var(--s-sm) 0 0;color:var(--t-dis);font-size:13px}

footer{margin-top:var(--s-4xl);padding:var(--s-lg) 0 var(--s-3xl);border-top:1px solid var(--border)}
footer p{margin:0;max-width:64ch}
footer p+p{margin-top:var(--s-sm)}

@media(max-width:720px){
 .club{grid-template-columns:minmax(0,1fr) 46px;row-gap:var(--s-xs);align-items:baseline}
 .club .cv{grid-area:1/1}
 .club .cy{grid-area:2/1;font-size:11px}
 .club .cn{grid-area:1/2}
 .club .blocks{grid-area:3/1/auto/-1}
 .night{grid-template-columns:minmax(0,1fr);gap:var(--s-sm)}
 .ndate span{display:inline;margin-left:var(--s-sm)}
 .ses .row{grid-template-columns:20px 1fr;row-gap:var(--s-sm)}
 .sdur{grid-column:2;text-align:left;font-size:32px}
 .segbar,.fly{grid-column:1/-1}
 .facts{gap:var(--s-lg)}
}
@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
"""

# ---------------------------------------------------------------- helpers
def link(name):
    aid = find(name)
    return f'<a href="#{e(aid)}">{e(name)}</a>' if aid else e(name)


def lineup_html(names):
    out = []
    for n in names:
        # A b2b stays billed as one entry but links to each artist's own row.
        b2b = re.match(r'^(.+?)\s+(b2b)\s+(.+)$', n, re.I)
        if b2b and find(b2b.group(1)) and find(b2b.group(3)):
            out.append(f'{link(b2b.group(1))} '
                       f'<span class="sep">{e(b2b.group(2))}</span> '
                       f'{link(b2b.group(3))}')
            continue
        out.append(link(n))
    # Real spaces around the separator: "·" gives no line-break opportunity, so
    # without them a whole lineup is one unbreakable run and widens the grid track.
    return ' <span class="sep">·</span> '.join(out)

def rec_html(recs):
    if not recs:
        return ''
    rows = []
    for r in recs:
        mins = f'<span class="min">{r["minutes"]}m</span>' if r.get('minutes') else ''
        rows.append(
            f'<div class="rec"><span class="pl">&#9834;</span>'
            f'<span class="who">{e(r["artist"])}</span>'
            f'<a href="{e(r["url"])}" target="_blank" rel="noopener noreferrer">'
            f'{e(r["title"])}</a>'
            f'<span class="lbl">{e(r["source"])}</span>{mins}</div>')
    return '<div class="recs">' + ''.join(rows) + '</div>'

def slug(s):
    return 'v-' + re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def blocks(filled, total):
    """Discrete blocks, the same unit used for the longest sessions."""
    filled = min(filled, total)
    return ('<i class="on"></i>' * filled) + ('<i></i>' * (total - filled))

# ---------------------------------------------------------------- sections
maxc = max(v['count'] for v in venues)

clubs_rows = ''.join(
    f'<div class="club" data-city="{e(v["city"])}">'
    f'<a class="cv" href="#{slug(v["venue"])}">{e(v["venue"])}</a>'
    f'<span class="cy lbl">{e(v["city"])}</span>'
    f'<span class="blocks" aria-hidden="true">{blocks(v["count"], maxc)}</span>'
    f'<span class="cn">{v["count"]}</span></div>'
    for v in venues)

ses_rows = ''
for i, s in enumerate(sessions):
    hrs = int(re.match(r'(\d+)', s['duration']).group(1))
    segs = blocks(round(hrs / 2), 21)
    meta = ' · '.join(x for x in (s['date'], s['event']) if x)
    ses_rows += (
        f'<div class="row{" one" if i == 0 else ""}">'
        f'<span class="rk">{i+1:02d}</span>'
        f'<div><div class="svenue">{e(s["venue"])}</div>'
        f'<div class="smeta lbl">{e(meta)}</div></div>'
        f'<div class="sdur">{e(s["duration"])}</div>'
        f'<div class="blocks segbar" aria-hidden="true">{segs}</div>'
        f'<p class="fly">{e(s["flight"])}</p></div>')

log_blocks = ''
for v in venues:
    nights = ''
    for n in v['nights']:
        if n['lineup']:
            body = f'<div class="nlu">{lineup_html(n["lineup"])}</div>'
        else:
            body = f'<div class="nnone">{e(n["unknown"] or "Lineup not recovered")}</div>'
        ev = f'<div class="nev">{e(n["event"])}</div>' if n['event'] else ''
        nights += (
            f'<article class="night"><div class="ndate">{e(n["date"])}'
            f'<span>{e(n["dow"])}</span></div>'
            f'<div>{ev}{body}{rec_html(n["recordings"])}</div></article>')
    log_blocks += (
        f'<div class="vblk" id="{slug(v["venue"])}" data-city="{e(v["city"])}" '
        f'data-venue="{e(v["venue"].lower())}">'
        f'<div class="vhd"><h3>{e(v["venue"])}</h3><span class="lbl">{e(v["city"])}</span>'
        f'<span class="n">{v["count"]} {"night" if v["count"] == 1 else "nights"}</span></div>'
        f'{nights}</div>')

art_rows = ''
for a in sorted(artists, key=lambda x: (-x['times'], x['name'].lower())):
    play = ''
    if a['rec_links']:
        play = ' '.join(f'<a href="{e(u)}" target="_blank" rel="noopener noreferrer" '
                        f'title="Recording">&#9834;</a>' for u in a['rec_links'])
    art_rows += (
        f'<tr id="{e(a["id"])}" data-n="{a["times"]}" data-f="{e(a["first"])}" '
        f'data-l="{e(a["last"])}" data-v="{a["clubs"]}" data-r="{a["recordings"]}" '
        f'data-a="{e(a["name"].lower())}">'
        f'<td class="nm">{e(a["name"])}</td>'
        f'<td class="num">{a["times"]}</td>'
        f'<td class="dt">{e(a["first"])}</td><td class="dt">{e(a["last"])}</td>'
        f'<td class="num">{a["clubs"]}</td><td class="pl">{play}</td>'
        f'<td class="wh">{e(" · ".join(a["where"]))}</td></tr>')

city_chips = ''.join(
    f'<button class="chip" type="button" data-city="{e(c)}" aria-pressed="false">{e(c)}</button>'
    for c in cities)

# ---------------------------------------------------------------- body
BODY = f"""
<nav class="top"><div class="wrap">
<a class="brand" href="#top">Club Archive</a>
<a href="#sessions">Sessions</a><a href="#clubs">Clubs</a>
<a href="#log">Night log</a><a href="#artists">Artists</a>
</div></nav>

<header class="hero" id="top"><div class="wrap">
<p class="lbl">{e(years[0])}&ndash;{e(years[-1])} &middot; {len(cities)} cities</p>
<h1 class="doto">Club<br>Archive</h1>
<div class="herofig">
 <span class="heroval">{len(artists)}</span>
 <span class="herounit lbl">Artists<br>seen</span>
</div>
<div class="facts">
 <div class="fact"><b>{len(venues)}</b><span class="lbl">Venues</span></div>
 <div class="fact"><b>{n_nights}</b><span class="lbl">Nights</span></div>
 <div class="fact"><b>{n_recs}</b><span class="lbl">Sets online</span></div>
 <div class="fact"><b>{len(cities)}</b><span class="lbl">Cities</span></div>
</div>
</div></header>

<main>
<section class="blk" id="sessions"><div class="wrap">
<div class="shead"><h2>Longest sessions</h2><span class="lbl">Top 5 &middot; door to door</span></div>
<p class="snote">The five longest single stretches in the archive. Each block is two hours.</p>
<div class="ses">{ses_rows}</div>
</div></section>

<section class="blk" id="clubs"><div class="wrap">
<div class="shead"><h2>Clubs</h2><span class="lbl">{len(venues)} venues &middot; by nights</span></div>
<p class="snote">How many nights at each &mdash; one block is one night.
Select a name to jump to its nights.</p>
<div class="clubs">{clubs_rows}</div>
</div></section>

<section class="blk" id="log"><div class="wrap">
<div class="shead"><h2>Night log</h2><span class="lbl">{n_nights} nights</span></div>
<p class="snote">Every night, grouped by venue, with the bill as it was billed.
Artist names link through to the index below.</p>
<div class="tools">
 <button class="chip" type="button" data-city="" aria-pressed="true">All</button>
 {city_chips}
 <input class="srch" id="qlog" type="search" placeholder="Filter venues"
  aria-label="Filter venues by name">
 <span class="count lbl" id="clog"></span>
</div>
<div id="logbody">{log_blocks}</div>
<div class="empty" id="elog" hidden><p class="lbl">No venues match</p>
<p>Try a different name or clear the filter.</p></div>
</div></section>

<section class="blk" id="artists"><div class="wrap">
<div class="shead"><h2>Every artist</h2><span class="lbl">{len(artists)} names</span></div>
<p class="snote">Counted once per night, b2b counted individually. Festivals include all DJs
including missed/overlapping sets. Sort by any column. &#9834; links to a surviving
recording from that night.</p>
<div class="tools">
 <input class="srch" id="qart" type="search" placeholder="Search artists"
  aria-label="Search artists">
 <span class="count lbl" id="cart"></span>
</div>
<div class="tblwrap"><table id="atbl">
<thead><tr>
<th class="srt" data-k="a" tabindex="0" aria-sort="none">Artist</th>
<th class="srt num" data-k="n" tabindex="0" aria-sort="descending">Times</th>
<th class="srt" data-k="f" tabindex="0" aria-sort="none">First</th>
<th class="srt" data-k="l" tabindex="0" aria-sort="none">Last</th>
<th class="srt num" data-k="v" tabindex="0" aria-sort="none">Clubs</th>
<th class="srt num" data-k="r" tabindex="0" aria-sort="none" title="Recordings online">&#9834;</th>
<th>Where</th></tr></thead>
<tbody>{art_rows}</tbody></table></div>
<div class="empty" id="eart" hidden><p class="lbl">No artists match</p>
<p>Try a shorter search.</p></div>
</div></section>
</main>

<footer><div class="wrap">
<p class="lbl">Club Archive &middot; {e(years[0])}&ndash;{e(years[-1])}</p>
<p class="snote" style="margin:8px 0 0">Lineups are as published by the venues and promoters.
Recordings link out to SoundCloud and the venues&rsquo; own archives; nothing is hosted here.</p>
</div></footer>
"""

JS = """
(function(){
 var norm=function(s){return (s||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');};

 /* --- night log: city chips + venue search --- */
 var blocks=[].slice.call(document.querySelectorAll('#logbody .vblk')),
     chips=[].slice.call(document.querySelectorAll('#log .chip')),
     q=document.getElementById('qlog'),cnt=document.getElementById('clog'),
     em=document.getElementById('elog'),city='';
 function runLog(){
  var t=norm(q.value.trim()),n=0;
  blocks.forEach(function(b){
   var ok=(!city||b.dataset.city===city)&&(!t||norm(b.dataset.venue).indexOf(t)>-1);
   b.hidden=!ok; if(ok)n++;
  });
  cnt.textContent=n+(n===1?' venue':' venues');
  em.hidden=n>0;
 }
 chips.forEach(function(c){c.addEventListener('click',function(){
  chips.forEach(function(o){o.setAttribute('aria-pressed','false');});
  c.setAttribute('aria-pressed','true'); city=c.dataset.city; runLog();
 });});
 q.addEventListener('input',runLog); runLog();

 /* --- artists: search --- */
 var tb=document.querySelector('#atbl tbody'),
     rows=[].slice.call(tb.rows),
     qa=document.getElementById('qart'),ca=document.getElementById('cart'),
     ea=document.getElementById('eart');
 function runArt(){
  var t=norm(qa.value.trim()),n=0;
  rows.forEach(function(r){
   var ok=!t||norm(r.dataset.a).indexOf(t)>-1||norm(r.cells[6].textContent).indexOf(t)>-1;
   r.hidden=!ok; if(ok)n++;
  });
  ca.textContent=n+(n===1?' artist':' artists');
  ea.hidden=n>0;
 }
 qa.addEventListener('input',runArt); runArt();

 /* --- artists: sort --- */
 var ths=[].slice.call(document.querySelectorAll('#atbl th.srt'));
 function sortBy(th){
  var k=th.dataset.k,
      cur=th.getAttribute('aria-sort'),
      num=(k==='n'||k==='v'||k==='r'),
      dir=cur==='descending'?'ascending':'descending';
  ths.forEach(function(o){o.setAttribute('aria-sort','none');});
  th.setAttribute('aria-sort',dir);
  var s=dir==='ascending'?1:-1;
  rows.sort(function(x,y){
   var a=x.dataset[k],b=y.dataset[k];
   if(num){a=+a;b=+b; if(a!==b)return (a-b)*s;}
   else if(a!==b){return a<b?-s:s;}
   return x.dataset.a<y.dataset.a?-1:1;
  });
  var f=document.createDocumentFragment();
  rows.forEach(function(r){f.appendChild(r);});
  tb.appendChild(f);
 }
 ths.forEach(function(th){
  th.addEventListener('click',function(){sortBy(th);});
  th.addEventListener('keydown',function(ev){
   if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();sortBy(th);}
  });
 });

 /* --- highlight an artist jumped to from a lineup --- */
 function hl(){
  var id=location.hash.slice(1); if(!id)return;
  var r=document.getElementById(id); if(!r||r.tagName!=='TR')return;
  if(r.hidden){qa.value='';runArt();}
  rows.forEach(function(o){o.classList.remove('hl');});
  r.classList.add('hl');
 }
 window.addEventListener('hashchange',hl); hl();
})();
"""

# ---------------------------------------------------------------- emit
# Doto, Space Grotesk and Space Mono are all SIL OFL, so they ship with the page
# instead of being fetched from Google — one less third party, and the design
# never silently falls back if that CDN is blocked.
FACES = [('Doto', 'doto.woff2', '600 900'),
         ('Space Grotesk', 'grotesk.woff2', '400 500'),
         ('Space Mono', 'mono400.woff2', '400'),
         ('Space Mono', 'mono700.woff2', '700')]

def face(fam, src, weight, style='normal'):
    return (f"@font-face{{font-family:'{fam}';font-style:{style};font-weight:{weight};"
            f"font-display:swap;src:url({src}) format('woff2')}}")

def data_uri(file):
    return 'data:font/woff2;base64,' + base64.b64encode(
        (FONTS / file).read_bytes()).decode()

LOCAL = ''.join(face(f, f'fonts/{fn}', w) for f, fn, w in FACES)
EMBED = ''.join(face(f, data_uri(fn), w) for f, fn, w in FACES)

TITLE = 'Club Archive'
DESC = ('A reconstructed record of club nights, lineups and surviving sets, '
        f'{years[0]}–{years[-1]}.')

standalone = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{TITLE}</title>
<meta name="description" content="{e(DESC)}">
<meta name="color-scheme" content="dark">
<meta property="og:title" content="{TITLE}">
<meta property="og:description" content="{e(DESC)}">
<meta property="og:type" content="website">
<style>{LOCAL}{CSS}</style>
</head><body>{BODY}<script>{JS}</script></body></html>"""

artifact = (f"<title>{TITLE}</title>\n<style>{EMBED}{CSS}</style>\n{BODY}\n<script>{JS}</script>")

(SITE / 'index.html').write_text(standalone, encoding='utf-8')
(BASE / 'build').mkdir(exist_ok=True)
(BASE / 'build' / 'artifact.html').write_text(artifact, encoding='utf-8')
print(f"djs/index.html      {len(standalone)/1024:8.1f} KB")
print(f"build/artifact.html {len(artifact)/1024:8.1f} KB")
print(f"venues={len(venues)} nights={n_nights} artists={len(artists)} recs={n_recs} cities={len(cities)}")
