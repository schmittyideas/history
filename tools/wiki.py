#!/usr/bin/env python3
"""Fetch English Wikipedia articles for research: one at a time, politely.

    python tools/wiki.py Henry_I_of_France Philip_I_of_France --out wp/
    python tools/wiki.py Louis_VII_of_France --wikidata

For each title it saves <out>/<Title>.txt: a header with the resolved title,
revision ID and URL, then the plain-text article. Cite that revision when a
fact is checked against it. With --wikidata it also adds the article's
Wikidata birth/death dates (a cross-check, not a replacement for reading).

Requests go out serially with a descriptive User-Agent, and an HTTP 429 waits
for the server's Retry-After before trying again. Files that already exist are
skipped. Exit code 1 if any title failed.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://en.wikipedia.org/w/api.php"
WIKIDATA = "https://www.wikidata.org/w/api.php"
USER_AGENT = "HistoryTimelineBot/1.0 (https://github.com/schmittyideas/history; schmittyideas@gmail.com)"
PAUSE = 3          # seconds between requests
MAX_TRIES = 6
MAX_WAIT = 120     # never sleep longer than this on one retry


def get_json(url, params, sleep=time.sleep):
    """GET url?params as JSON, waiting out 429/5xx with Retry-After."""
    full = url + "?" + urllib.parse.urlencode(params)
    for attempt in range(1, MAX_TRIES + 1):
        req = urllib.request.Request(full, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == MAX_TRIES:
                raise
            wait = retry_after(e.headers.get("Retry-After"), attempt)
            print(f"  HTTP {e.code}, waiting {wait}s (try {attempt}/{MAX_TRIES})", file=sys.stderr)
            sleep(wait)


def retry_after(header, attempt):
    try:
        wait = int(header)
    except (TypeError, ValueError):
        wait = 10 * attempt
    return max(1, min(wait, MAX_WAIT))


def fetch_article(title, sleep=time.sleep):
    """Return dict(title, revid, url, text, qid) for a page title."""
    data = get_json(API, {
        "action": "query", "format": "json", "redirects": 1, "titles": title,
        "prop": "extracts|revisions|pageprops", "explaintext": 1,
        "rvprop": "ids", "ppprop": "wikibase_item",
    }, sleep)
    page = next(iter(data["query"]["pages"].values()))
    if "missing" in page:
        raise ValueError(f"no such article: {title}")
    if "disambiguation" in page.get("pageprops", {}):
        raise ValueError(f"{title} is a disambiguation page; use the article's exact title")
    resolved = page["title"]
    return {
        "title": resolved,
        "revid": page["revisions"][0]["revid"],
        "url": "https://en.wikipedia.org/wiki/" + urllib.parse.quote(resolved.replace(" ", "_")),
        "text": page.get("extract", ""),
        "qid": page.get("pageprops", {}).get("wikibase_item"),
    }


def wikidata_dates(qid, sleep=time.sleep):
    """Birth (P569) and death (P570) dates as Wikidata states them."""
    data = get_json(WIKIDATA, {
        "action": "wbgetentities", "format": "json", "ids": qid, "props": "claims",
    }, sleep)
    claims = data["entities"][qid].get("claims", {})
    out = {}
    for label, prop in (("born", "P569"), ("died", "P570")):
        vals = []
        for c in claims.get(prop, []):
            v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
            if v:
                vals.append(f"{v['time']} (precision {v['precision']})")
        if vals:
            out[label] = vals
    return out


def render(article, dates=None):
    head = [f"# {article['title']}", f"# revision: {article['revid']}", f"# url: {article['url']}"]
    for label, vals in (dates or {}).items():
        head.append(f"# wikidata {label}: " + "; ".join(vals))
    return "\n".join(head) + "\n\n" + article["text"].strip() + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("titles", nargs="+", help="article titles, e.g. Henry_I_of_France")
    ap.add_argument("--out", default="wp", help="directory to save into (default: wp)")
    ap.add_argument("--wikidata", action="store_true", help="add Wikidata birth/death dates")
    args = ap.parse_args(argv)

    import os
    os.makedirs(args.out, exist_ok=True)
    failed = []
    for i, title in enumerate(args.titles):
        path = os.path.join(args.out, title.replace(" ", "_") + ".txt")
        if os.path.exists(path) and os.path.getsize(path) > 0:
            print(f"{title}: already saved")
            continue
        if i:
            time.sleep(PAUSE)
        try:
            art = fetch_article(title)
            dates = wikidata_dates(art["qid"]) if args.wikidata and art["qid"] else None
            with open(path, "w", encoding="utf-8") as f:
                f.write(render(art, dates))
            print(f"{title}: {len(art['text'])} chars, revision {art['revid']}")
        except (urllib.error.URLError, ValueError, KeyError) as e:
            print(f"{title}: FAILED ({e})", file=sys.stderr)
            failed.append(title)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
