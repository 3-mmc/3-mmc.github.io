#!/usr/bin/env python3
"""Add nights, bills and sets to the club archive, then rebuild the site.

    python3 djs-build/add.py night  --venue Nowadays --date 2026-08-15 \
                                    --event Nonstop --lineup "Anz, Cinthie b2b Roza Terenzi"
    python3 djs-build/add.py lineup --venue Nowadays --date 2026-08-15 --add "Bergsonist"
    python3 djs-build/add.py set    --venue Nowadays --date 2026-08-15 --artist Anz \
                                    https://soundcloud.com/anz/nowadays
    python3 djs-build/add.py ra     "~/Nonstop bei Nowadays.mhtml"
    python3 djs-build/add.py find   nowadays          # what is already in there
    python3 djs-build/add.py check                    # integrity + privacy scan

Every command that changes something re-derives the artist index, the venue
counts and the most-visited list, then rebuilds djs/index.html. Pass --no-build
to stage several changes and build once at the end.

data.json is the source of truth. It is public by construction: venues, dates,
event names, bills and links to sets that are still online — nothing about how
any of it was worked out. Keep it that way; `check` will tell you if it slips.
"""
import argparse, email, glob, html, json, os, re, subprocess, sys
from datetime import date as Date
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA = BASE / 'data.json'

SOURCES = {'soundcloud.com': 'SoundCloud', 'youtube.com': 'YouTube',
           'youtu.be': 'YouTube', 'mixcloud.com': 'Mixcloud', 'ra.co': 'RA',
           'archive.org': 'Internet Archive', 'bandcamp.com': 'Bandcamp',
           'nts.live': 'NTS', 'hetarchief.deschoolamsterdam.nl': 'De School archive'}


# ------------------------------------------------------------------ helpers
def nkey(s):
    """Match names on letters and digits only: the same DJ gets billed with
    different case and punctuation ("SHAUN J.WRIGHT" / "Shaun J. Wright")."""
    return re.sub(r'[^a-z0-9]+', '', s.lower())


def aslug(name):
    return 'dj-' + re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def solo(billed):
    """A b2b stays billed as one slot but counts as each artist separately."""
    parts = re.split(r'\s+b2b\s+', billed, flags=re.I)
    return [p.strip() for p in parts if p.strip()] or [billed]


def already(slot, have):
    """True if every name in the slot is on the bill already. Compared part by
    part, so "Facta b2b K-LONE" is not re-added next to Facta and K-LONE."""
    return all(nkey(x) in have for x in solo(slot))


def billed_keys(night):
    return {nkey(x) for slot in night['lineup'] for x in solo(slot)}


def names(arg):
    """Split a bill given on the command line: comma, semicolon or the site's ·.
    b2b pairs stay whole, because that is how they were billed."""
    return [x.strip() for x in re.split(r'\s*[,;·]\s*', arg or '') if x.strip()]


def load():
    return json.loads(DATA.read_text(encoding='utf-8'))


def die(msg, *hints):
    print(f'add.py: {msg}', file=sys.stderr)
    for h in hints:
        print(f'  {h}', file=sys.stderr)
    sys.exit(1)


def find_venue(D, want, create_city=None):
    """Exact name, else unique case-insensitive substring."""
    hit = [v for v in D['venues'] if v['venue'].lower() == want.lower()]
    if not hit:
        hit = [v for v in D['venues'] if want.lower() in v['venue'].lower()]
    if len(hit) > 1:
        die(f'"{want}" matches {len(hit)} venues',
            *[v['venue'] for v in hit])
    if hit:
        return hit[0]
    if not create_city:
        near = [v['venue'] for v in D['venues']
                if nkey(want)[:4] and nkey(want)[:4] in nkey(v['venue'])]
        die(f'no venue matching "{want}"',
            '--city NAME adds it as a new venue',
            *(['did you mean: ' + ', '.join(near[:5])] if near else []))
    v = {'venue': want, 'city': create_city, 'count': 0, 'nights': []}
    D['venues'].append(v)
    print(f'+ new venue: {want} ({create_city})')
    return v


def find_night(venue, date):
    for n in venue['nights']:
        if n['date'] == date:
            return n
    die(f'{venue["venue"]} has no night on {date}',
        'dates on file: ' + ', '.join(n['date'] for n in venue['nights'][-6:]),
        'use `add.py night` to add it')


# ------------------------------------------------------------------ reindex
def reindex(D):
    """Re-derive everything that is a consequence of the nights: weekday labels,
    venue counts, the artist index and the most-visited list.

    The artist rows carry counts the bills alone cannot reproduce — 21 nights
    have no recovered lineup, and their artists were still known. So a rebuilt
    count is only ever allowed to go up, never to drop below what is on file."""
    for v in D['venues']:
        for n in v['nights']:
            n['dow'] = Date.fromisoformat(n['date']).strftime('%a')
        v['nights'].sort(key=lambda n: n['date'])
        v['count'] = len(v['nights'])
    D['venues'].sort(key=lambda v: (-v['count'], v['venue']))

    played, billed, recs = {}, {}, {}
    for v in D['venues']:
        for n in v['nights']:
            for slot in n['lineup']:
                for one in solo(slot):
                    played.setdefault(nkey(one), set()).add((v['venue'], n['date']))
                    billed.setdefault(nkey(one), []).append(one)
            for r in n['recordings']:
                for one in solo(r.get('artist') or ''):
                    if one:
                        recs.setdefault(nkey(one), set()).add(r['url'])

    old = {nkey(a['name']): a for a in D['artists']}
    used, rows = set(), []
    for key in dict.fromkeys(list(old) + list(played)):
        a, app = old.get(key), played.get(key, set())
        dates = {d for _, d in app}
        where = {v for v, _ in app}
        links = set(recs.get(key, ()))
        if a:
            dates |= {a['first'], a['last']}
            where |= {w for w in a['where'] if w != '(unknown)'}
            links |= set(a['rec_links'])
            name, aid = a['name'], a['id']
        else:
            # A newly billed artist: use the spelling the bills use most often.
            seen = billed[key]
            name = max(set(seen), key=lambda x: (seen.count(x), -len(x)))
            aid = aslug(name)
            print(f'+ new artist: {name}')
        where = sorted(where)
        while aid in used:                     # two names, one slug
            aid += '-2'
        used.add(aid)
        rows.append({
            'id': aid, 'name': name,
            'times': max(len(dates), a['times'] if a else 0),
            'first': min(dates), 'last': max(dates),
            'clubs': len(where) if where else (a['clubs'] if a else 0),
            'recordings': max(len(links), a['recordings'] if a else 0),
            'where': where or ['(unknown)'], 'rec_links': sorted(links),
        })
    D['artists'] = rows

    D['top_clubs'] = [{'venue': v['venue'], 'city': v['city'],
                       'nights': f'{v["count"]} night' + ('s' if v['count'] != 1 else '')}
                      for v in D['venues'][:5]]
    return D


def save(D, build=True):
    reindex(D)
    DATA.write_text(json.dumps(D, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    n = sum(len(v['nights']) for v in D['venues'])
    r = sum(len(x['recordings']) for v in D['venues'] for x in v['nights'])
    print(f'data.json: {len(D["venues"])} venues, {n} nights, '
          f'{len(D["artists"])} artists, {r} sets', flush=True)
    if build:
        subprocess.run([sys.executable, str(BASE / 'build_site.py')], check=True)


# ------------------------------------------------------------------ commands
def cmd_night(args, D):
    v = find_venue(D, args.venue, args.city)
    if any(n['date'] == args.date for n in v['nights']):
        die(f'{v["venue"]} already has a night on {args.date}',
            'add to its bill with `add.py lineup`')
    v['nights'].append({
        'date': args.date, 'dow': '', 'event': args.event or '',
        'lineup': names(args.lineup), 'unknown': '' if args.lineup else 'Lineup not recovered',
        'recordings': [],
    })
    print(f'+ {v["venue"]} {args.date} {args.event or ""}'.rstrip())
    save(D, args.build)


def cmd_lineup(args, D):
    v = find_venue(D, args.venue)
    n = find_night(v, args.date)
    add = names(args.add)
    if args.replace:
        n['lineup'] = []
    have = billed_keys(n)
    new = [x for x in add if not already(x, have)]
    n['lineup'] += new
    if n['lineup']:
        n['unknown'] = ''
    print(f'  {v["venue"]} {args.date}: +{len(new)} → ' + ' · '.join(n['lineup']))
    save(D, args.build)


def cmd_set(args, D):
    v = find_venue(D, args.venue)
    n = find_night(v, args.date)
    if any(r['url'] == args.url for r in n['recordings']):
        die('that link is already on this night')
    host = re.sub(r'^www\.', '', re.sub(r'^https?://([^/]+).*', r'\1', args.url))
    artist = args.artist
    if not artist:
        die('--artist is required (whose set is it?)',
            'billed that night: ' + ' · '.join(n['lineup']))
    known = {nkey(x): x for slot in n['lineup'] for x in solo(slot)}
    if nkey(artist) not in known and not args.force:
        die(f'"{artist}" is not on this bill',
            'billed: ' + (' · '.join(n['lineup']) or '(no lineup on file)'),
            '--force adds the set anyway, or fix the bill with `add.py lineup`')
    n['recordings'].append({
        'source': args.source or SOURCES.get(host, host),
        'artist': known.get(nkey(artist), artist),
        'url': args.url,
        'title': args.title or '',
        'minutes': args.minutes,
    })
    print(f'♪ {v["venue"]} {args.date}: {artist} — {args.url}')
    save(D, args.build)


# ---- Resident Advisor pages saved from the browser as .mhtml
RA_LABELS = {'date': ('Datum', 'Date'), 'venue': ('Veranstaltungsort', 'Venue'),
             'lineup': ('Line Up', 'Lineup'), 'end': ('Teilen', 'Share')}
MONTHS = {m: i for i, m in enumerate(
    ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], 1)}
MONTHS.update({'mär': 3, 'mrz': 3, 'mai': 5, 'okt': 10, 'dez': 12})

# A multi-room bill puts room headers and door notices in the same list as the
# DJs. These lines are dropped and printed, so anything caught wrongly can go
# back on with `add.py lineup`.
NON_ARTIST = re.compile(
    r'(?i)\b(room|floor|stage|area|terrace|garten|garden|open air|hall|tent|'
    r'takeover|free entrance|entrance|door|tickets?|line ?up|residents)\b'
    r'|\d{1,2}:\d{2}|^[-–—•]')


def ra_read(path):
    """Pull the event name, venue, date and bill out of a saved RA page.

    Only those four. RA also prints the venue's street address directly under
    its name; that line is never read."""
    msg = email.message_from_file(open(path, encoding='utf-8', errors='replace'))
    raw = next((p.get_payload(decode=True).decode('utf-8', errors='replace')
                for p in msg.walk() if p.get_content_type() == 'text/html'), '')
    t = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', raw, flags=re.S | re.I)
    t = re.sub(r'</?(br|div|li|p|ul|h\d|section)[^>]*>', '\n', t, flags=re.I)
    t = html.unescape(re.sub(r'<[^>]+>', '', t))
    lines = [x for x in (re.sub(r'[ \t\xa0]+', ' ', x).strip() for x in t.split('\n')) if x]

    def after(labels):
        for i, x in enumerate(lines):
            if x in labels and i + 1 < len(lines):
                return i, lines[i + 1]
        return -1, ''

    di, raw_date = after(RA_LABELS['date'])
    m = re.match(r'\w+\.?,\s*(\d{1,2})\.?\s*(\w+)\.?\s*(\d{4})', raw_date)
    if not m:
        die(f'no date found in {os.path.basename(path)}')
    day, mon, year = int(m.group(1)), m.group(2).lower()[:3], int(m.group(3))
    date = f'{year:04d}-{MONTHS.get(mon, 0):02d}-{day:02d}'

    vi, venue = after(RA_LABELS['venue'])
    event = lines[vi - 1] if vi > 0 else ''

    li = next((i for i, x in enumerate(lines) if x in RA_LABELS['lineup']), -1)
    end = next((i for i, x in enumerate(lines[li:], li) if x in RA_LABELS['end']), -1)
    bill, skipped, seen = [], [], set()
    for row in lines[li + 1:end] if li >= 0 < end else []:
        row = re.sub(r'^\s*\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}\s*:?\s*', '', row)
        row = re.sub(r'\s*\((?:live|dj set)\)\s*$', '', row, flags=re.I).strip()
        if not row:
            continue
        if NON_ARTIST.search(row):
            skipped.append(row)
            continue
        if not already(row, seen):
            bill.append(row)
        seen |= {nkey(x) for x in solo(row)}
    return {'date': date, 'venue': venue, 'event': event,
            'lineup': bill, 'skipped': skipped}


def cmd_ra(args, D):
    paths = [p for pat in args.files for p in sorted(glob.glob(os.path.expanduser(pat)))]
    if not paths:
        die('no files matched')
    for path in paths:
        ra = ra_read(path)
        date, venue = args.date or ra['date'], args.venue or ra['venue']
        if args.dry_run:
            print(f'{os.path.basename(path)}\n  {date}  {venue}  {ra["event"]}\n'
                  f'  ' + ' · '.join(ra['lineup']))
            for s in ra['skipped']:
                print(f'  skipped: {s}')
            continue
        v = find_venue(D, venue, args.city)
        # A night billed on the Saturday can run into the Sunday, which is how it
        # is filed. Try the billed date, then the morning after.
        nxt = Date.fromordinal(Date.fromisoformat(date).toordinal() + 1).isoformat()
        n = next((x for x in v['nights'] if x['date'] == date), None) \
            or next((x for x in v['nights'] if x['date'] == nxt), None)
        if n is None:
            n = {'date': date, 'dow': '', 'event': ra['event'], 'lineup': [],
                 'unknown': '', 'recordings': []}
            v['nights'].append(n)
            print(f'+ {v["venue"]} {date} {ra["event"]}')
        have = billed_keys(n)
        new = [x for x in ra['lineup'] if not already(x, have)]
        n['lineup'] = new + n['lineup']      # RA lists in set order, openers first
        if n['lineup']:
            n['unknown'] = ''
        print(f'  {os.path.basename(path)[:48]:48} → {v["venue"]} {n["date"]} (+{len(new)})')
        for s in ra['skipped']:
            print(f'    skipped, not a name: {s}')
    if args.dry_run:
        return
    save(D, args.build)


def cmd_build(args, D):
    """For when data.json was edited by hand — fix up everything derived from it."""
    save(D, True)


def cmd_find(args, D):
    q = args.query.lower()
    for v in D['venues']:
        nights = [n for n in v['nights']
                  if q in v['venue'].lower() or q in n['date'] or q in n['event'].lower()
                  or any(q in x.lower() for x in n['lineup'])]
        for n in nights:
            rec = f'  ♪{len(n["recordings"])}' if n['recordings'] else ''
            print(f'{n["date"]} {n["dow"]}  {v["venue"]:28.28} {n["event"][:34]:34.34}'
                  f'{" · ".join(n["lineup"])[:60]}{rec}')
    for a in D['artists']:
        if q in a['name'].lower():
            print(f'{a["name"]}  ×{a["times"]}  {a["first"]}–{a["last"]}  '
                  f'{", ".join(a["where"])}')


# Things that have no business in a public file. The archive was built from
# location history, bank statements and mail, so this is not hypothetical.
LEAKS = [
    ('street address', r'\d+[- ]?\d*\s+(?:[A-Z][a-z]+\s+){1,3}'
                       r'(?:St|Street|Ave|Avenue|Rd|Road|Blvd|straße|strasse|gracht|laan)\b'),
    ('clock time', r'\b\d{1,2}:\d{2}\b'),
    ('money', r'[$£€]\s?\d'),
    ('coordinates', r'-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}'),
    ('bank or card', r'(?i)\b(revolut|schwab|chase|visa|mastercard|ing|iban|'
                     r'statement|charge[dt]?|receipt|bar tab)\b'),
    ('rides', r'(?i)\b(uber|lyft|bolt|taxi receipt)\b'),
    ('messages', r'(?i)\b(whatsapp|imessage|telegram|signal|dm from)\b'),
    ('location history', r'(?i)\b(gps|timeline|geofence|arrival|departure|'
                         r'phone (?:re-?)?register)\b'),
    ('email', r'[\w.+-]+@[\w-]+\.[\w.]+'),
    ('first person', r'(?i)(^|[.!?]\s)(i|we|my|our)\b'),
]


def cmd_check(args, D):
    bad = 0
    ids, seen_names = set(), set()
    for a in D['artists']:
        if a['id'] in ids:
            print(f'! duplicate id {a["id"]}'); bad += 1
        if nkey(a['name']) in seen_names:
            print(f'! duplicate artist {a["name"]}'); bad += 1
        ids.add(a['id']); seen_names.add(nkey(a['name']))
    for v in D['venues']:
        if v['count'] != len(v['nights']):
            print(f'! {v["venue"]} count {v["count"]} but {len(v["nights"])} nights'); bad += 1
        for n in v['nights']:
            try:
                Date.fromisoformat(n['date'])
            except ValueError:
                print(f'! {v["venue"]}: bad date {n["date"]}'); bad += 1
            for r in n['recordings']:
                if not r['url'].startswith('http'):
                    print(f'! {v["venue"]} {n["date"]}: bad link {r["url"]}'); bad += 1
                billed_here = {nkey(x) for s in n['lineup'] for x in solo(s)}
                if not all(nkey(x) in billed_here for x in solo(r.get('artist', ''))):
                    print(f'~ {v["venue"]} {n["date"]}: set by {r["artist"]}, '
                          f'who is not on the bill')

    # Prose fields only: dates, links and DJ names are not narration.
    for v in D['venues']:
        for n in v['nights']:
            for field in (n['event'], n['unknown']):
                for label, pat in LEAKS:
                    if field and re.search(pat, field):
                        print(f'! {label} in {v["venue"]} {n["date"]}: {field!r}'); bad += 1
    for s in D['longest_sessions']:
        for field in (s['event'], s['flight'], s['duration']):
            for label, pat in LEAKS:
                if field and re.search(pat, field):
                    print(f'! {label} in session {s["venue"]}: {field!r}'); bad += 1

    print('CLEAN — nothing personal, nothing broken' if not bad
          else f'{bad} problem(s) — fix before publishing')
    return 1 if bad else 0


# ------------------------------------------------------------------ cli
def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--no-build', dest='build', action='store_false',
                   help='update data.json but do not rebuild the page')
    sub = p.add_subparsers(dest='cmd', required=True)

    n = sub.add_parser('night', help='add a club night')
    n.add_argument('--venue', required=True)
    n.add_argument('--date', required=True, help='YYYY-MM-DD')
    n.add_argument('--event', default='')
    n.add_argument('--lineup', default='', help='"A, B, C b2b D"')
    n.add_argument('--city', help='only needed for a venue that is new')
    n.set_defaults(fn=cmd_night)

    l = sub.add_parser('lineup', help='add names to a night already on file')
    l.add_argument('--venue', required=True)
    l.add_argument('--date', required=True)
    l.add_argument('--add', required=True)
    l.add_argument('--replace', action='store_true', help='drop the old bill first')
    l.set_defaults(fn=cmd_lineup)

    s = sub.add_parser('set', help='attach a surviving recording to a night')
    s.add_argument('url')
    s.add_argument('--venue', required=True)
    s.add_argument('--date', required=True)
    s.add_argument('--artist', help='whose set — must be on the bill')
    s.add_argument('--title', default='', help='as the upload titles it')
    s.add_argument('--minutes', type=int)
    s.add_argument('--source', help='overrides the guess from the URL')
    s.add_argument('--force', action='store_true')
    s.set_defaults(fn=cmd_set)

    r = sub.add_parser('ra', help='import a Resident Advisor page saved as .mhtml')
    r.add_argument('files', nargs='+')
    r.add_argument('--venue', help='overrides the venue named on the page')
    r.add_argument('--date', help='overrides the date on the page')
    r.add_argument('--city')
    r.add_argument('--dry-run', action='store_true', help='show what it reads, change nothing')
    r.set_defaults(fn=cmd_ra)

    b = sub.add_parser('build', help='rebuild the page (use after editing data.json by hand)')
    b.set_defaults(fn=cmd_build)

    f = sub.add_parser('find', help='search venues, nights and artists')
    f.add_argument('query')
    f.set_defaults(fn=cmd_find)

    c = sub.add_parser('check', help='integrity and privacy scan')
    c.set_defaults(fn=cmd_check)

    args = p.parse_args()
    sys.exit(args.fn(args, load()) or 0)


if __name__ == '__main__':
    main()
