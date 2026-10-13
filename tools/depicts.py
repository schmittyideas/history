#!/usr/bin/env python3
"""Find the places our landscapes and city views depict, from Wikidata, as a draft intake file.

    export SUPABASE_URL=https://alhvzdvabugmkeqmvmiz.supabase.co SUPABASE_SECRET_KEY=<anon key from config.js>
    python tools/depicts.py --out depicts/            # every museum
    python tools/depicts.py --out depicts/ --museum tate-britain --museum national-gallery

Read-only: it reads the database with the anon key and Wikidata's public query service, and writes
  <out>/candidates.json   every match, with the evidence
  <out>/review.md         a readable list to check
  <out>/draft-<n>.yaml    intake files of about --rows rows each, ready to preview (tools/intake.py plan)

How it matches, so every link has a source:
- Our artworks don't store Wikidata ids, but most have a museum and an accession number. Wikidata holds the same
  pair (P195 collection, P217 inventory number), so each museum's paintings are read from Wikidata and matched on
  the inventory number. The museum's Wikidata item comes from the Wikipedia article it already cites.
- Only paintings Wikidata files under a landscape or city-view genre (P136) are taken, and only places they
  depict (P180) that have coordinates (P625): a person or a saint has none, so they drop out.
- A depicted place is one of ours when the names match (ignoring case and accents) and it lies within 25 km;
  otherwise it becomes a new place, named and placed as Wikidata gives it, citing its English Wikipedia article
  (or the Wikidata item when there is none).
- The links cite nothing new: each artwork already cites the Wikidata source it was imported from, and the
  depicts claim comes from the same item. The draft says which item, in a comment per artwork.
Nothing is matched on title words alone: "The Judgement of Paris" isn't Paris.
"""
import argparse
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.parse

try:
    import requests
except ImportError:
    raise SystemExit("The 'requests' package is required: pip install requests")

UA = "HistoryTimelineBot/1.0 (https://github.com/schmittyideas/history; schmittyideas@gmail.com)"
SPARQL = "https://query.wikidata.org/sparql"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
ENWIKI_API = "https://en.wikipedia.org/w/api.php"
# Landscape art, cityscape, veduta, capriccio, topographic view, townscape, marine art is left out on purpose.
GENRES = {"Q191163": "landscape", "Q1935974": "cityscape", "Q1640824": "veduta", "Q1037287": "capriccio",
          "Q16509574": "topographic view", "Q2864737": "architectural painting"}
NEAR_KM = 25


def fold(s):
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def norm_inv(s):
    return re.sub(r"[\s.\-_/]+", "", (s or "").lower())


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", fold(s)).strip("-")


def km(a, b):
    r = math.pi / 180
    x = math.sin((b[0] - a[0]) * r / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin((b[1] - a[1]) * r / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(x))


class Http:
    def __init__(self):
        self.s = requests.Session()
        self.s.headers["User-Agent"] = UA

    def get(self, url, params, tries=6):
        for i in range(tries):
            r = self.s.get(url, params=params, timeout=90)
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(min(int(r.headers.get("Retry-After", 10 * (i + 1))), 120)); continue
            r.raise_for_status(); return r.json()
        r.raise_for_status()

    def sparql(self, query, tries=5):
        for i in range(tries):
            r = self.s.post(SPARQL, data={"query": query, "format": "json"}, timeout=120)
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(min(int(r.headers.get("Retry-After", 15 * (i + 1))), 120)); continue
            r.raise_for_status(); return r.json()["results"]["bindings"]
        r.raise_for_status()


def rest(table, columns, **eq):
    base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + table
    key = os.environ["SUPABASE_SECRET_KEY"]
    h = {"apikey": key}
    if not key.startswith("sb_"):
        h["Authorization"] = f"Bearer {key}"
    out = []
    while True:
        params = {"select": columns, "order": "id", "limit": 1000, "offset": len(out), **{k: f"eq.{v}" for k, v in eq.items()}}
        r = requests.get(base, headers=h, params=params, timeout=60)
        r.raise_for_status()
        rows = r.json(); out += rows
        if len(rows) < 1000:
            return out


def museum_qids(http, museums, links, sources):
    """A museum's Wikidata item, from the English Wikipedia article it cites."""
    by_id = {s["id"]: s for s in sources}
    titles = {}
    for l in links:
        url = (by_id.get(l["source_id"]) or {}).get("url") or ""
        m = re.match(r"https?://en\.wikipedia\.org/wiki/(.+)$", url)
        if m:
            titles.setdefault(l["record_key"], urllib.parse.unquote(m.group(1)).replace("_", " "))
    out = {}
    keys = [m["key"] for m in museums if m["key"] in titles]
    for i in range(0, len(keys), 40):
        chunk = keys[i:i + 40]
        data = http.get(ENWIKI_API, {"action": "query", "format": "json", "redirects": 1, "prop": "pageprops",
                                     "ppprop": "wikibase_item", "titles": "|".join(titles[k] for k in chunk)})
        q = data["query"]
        redir = {r["from"]: r["to"] for r in q.get("redirects", []) + q.get("normalized", [])}
        by_title = {p["title"]: p.get("pageprops", {}).get("wikibase_item") for p in q["pages"].values()}
        for k in chunk:
            t = titles[k]
            t = redir.get(t, t); t = redir.get(t, t)
            if by_title.get(t):
                out[k] = by_title[t]
    return out


def museum_paintings(http, qid):
    genres = " ".join(f"wd:{g}" for g in GENRES)
    q = f"""
SELECT ?item ?inv ?genre ?dep ?depLabel ?coord ?article WHERE {{
  ?item wdt:P195 wd:{qid}; wdt:P217 ?inv; wdt:P136 ?genre.
  VALUES ?genre {{ {genres} }}
  ?item wdt:P180 ?dep. ?dep wdt:P625 ?coord.
  # whole countries, states, seas and oceans are too big to be "the place shown"
  FILTER NOT EXISTS {{ ?dep wdt:P31/wdt:P279* ?big. VALUES ?big {{ wd:Q6256 wd:Q3624078 wd:Q107390 wd:Q35657 wd:Q5107 wd:Q165 wd:Q9430 wd:Q10864048 }} }}
  OPTIONAL {{ ?article schema:about ?dep; schema:isPartOf <https://en.wikipedia.org/>. }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}"""
    rows = []
    for b in http.sparql(q):
        m = re.match(r"Point\(([-\d.eE]+) ([-\d.eE]+)\)", b["coord"]["value"])
        if not m:
            continue
        rows.append({"item": b["item"]["value"].rsplit("/", 1)[1], "inv": b["inv"]["value"], "genre": GENRES.get(b["genre"]["value"].rsplit("/", 1)[1]),
                     "dep": b["dep"]["value"].rsplit("/", 1)[1], "label": b["depLabel"]["value"],
                     "lat": round(float(m.group(2)), 4), "lng": round(float(m.group(1)), 4),
                     "article": urllib.parse.unquote(b["article"]["value"]) if "article" in b else None})
    return rows


def our_place(ours, r):
    """One of our places: the same name within NEAR_KM; else one name inside the other within 2 km ("Florence
    Cathedral" and "Florence Cathedral (Santa Maria del Fiore)"); else anything within 300 m with a shared word."""
    here, label = (r["lat"], r["lng"]), fold(r["label"])
    near = [(km(here, (float(p["lat"]), float(p["lng"]))), p) for p in ours]
    names = lambda p: [n for n in (fold(p["name"]), fold(p["historical_name"])) if n]
    for d, p in sorted(near, key=lambda x: x[0]):
        if d <= NEAR_KM and label in names(p):
            return p
    for d, p in sorted(near, key=lambda x: x[0]):
        if d <= 2 and any(label in n or n in label for n in names(p)):
            return p
    words = {w for w in label.split() if len(w) > 3}
    for d, p in sorted(near, key=lambda x: x[0]):
        if d <= 0.3 and any(words & set(n.split()) for n in names(p)):
            return p
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default="depicts")
    ap.add_argument("--museum", action="append", help="museum key (default: every museum)")
    ap.add_argument("--rows", type=int, default=150, help="rows per draft intake file")
    args = ap.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    http = Http()

    artworks = rest("artworks", "id,key,name,museum_id,accession_number,start_year")
    museums = rest("museums", "id,key,name")
    places = rest("places", "id,key,name,historical_name,kind,lat,lng")
    sources = rest("sources", "id,key,url,title")
    mlinks = rest("source_links", "source_id,record_type,record_key", record_type="museum")
    alinks = rest("source_links", "source_id,record_type,record_key", record_type="artwork")
    have = rest("artwork_places", "artwork_id,place_id,role")
    if args.museum:
        museums = [m for m in museums if m["key"] in args.museum]
    qids = museum_qids(http, museums, mlinks, sources)
    print(f"{len(qids)} of {len(museums)} museums have a Wikidata item", file=sys.stderr)

    by_museum_inv = {}
    for a in artworks:
        if a["museum_id"] and a["accession_number"]:
            by_museum_inv[(a["museum_id"], norm_inv(a["accession_number"]))] = a
    linked = {(h["artwork_id"], h["place_id"]) for h in have if h["role"] == "depicts"}
    ours = [p for p in places if p["lat"] is not None and p["lng"] is not None]
    src_of = {s["id"]: s for s in sources}
    wd_source = {}
    for l in alinks:
        s = src_of.get(l["source_id"])
        if s and "wikidata" in (s.get("url") or s.get("title") or "").lower():
            wd_source[l["record_key"]] = s["key"]

    found = []
    for m in museums:
        q = qids.get(m["key"])
        if not q:
            continue
        try:
            rows = museum_paintings(http, q)
        except Exception as e:
            print(f"  {m['key']}: {e}", file=sys.stderr); continue
        hits = 0
        for r in rows:
            a = by_museum_inv.get((m["id"], norm_inv(r["inv"])))
            if not a:
                continue
            # one of our places: same name (or then-name), within NEAR_KM
            match = our_place(ours, r)
            if match and (a["id"], match["id"]) in linked:
                continue
            found.append({"artwork": a["key"], "title": a["name"], "museum": m["key"], "item": r["item"], "genre": r["genre"],
                          "depicts": r["dep"], "label": r["label"], "lat": r["lat"], "lng": r["lng"], "article": r["article"],
                          "place": match["key"] if match else None, "wd_source": wd_source.get(a["key"])})
            hits += 1
        print(f"  {m['key']}: {len(rows)} depicted places on Wikidata, {hits} matched to our artworks", file=sys.stderr)
        time.sleep(2)

    # de-duplicate (a painting can list a place twice through two genres)
    seen, uniq = set(), []
    for f in found:
        k = (f["artwork"], f["depicts"])
        if k not in seen:
            seen.add(k); uniq.append(f)
    json.dump(uniq, open(os.path.join(args.out, "candidates.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # new places, one per depicted item
    taken = {p["key"] for p in places}
    new_places = {}
    for f in uniq:
        if f["place"] or f["depicts"] in new_places:
            continue
        key = slug(f["label"]) or f["depicts"].lower()
        if key in taken:
            key = f"{key}-{f['depicts'].lower()}"
        taken.add(key)
        new_places[f["depicts"]] = {"key": key, "name": f["label"], "lat": f["lat"], "lng": f["lng"], "article": f["article"], "qid": f["depicts"]}
    for f in uniq:
        f["place_key"] = f["place"] or new_places[f["depicts"]]["key"]

    with open(os.path.join(args.out, "review.md"), "w", encoding="utf-8") as out:
        out.write(f"# Depicted places: {len(uniq)} links, {len(new_places)} new places\n\n")
        for f in sorted(uniq, key=lambda f: (f["museum"], f["title"])):
            tag = "existing" if f["place"] else "NEW"
            out.write(f"- {f['title']} ({f['museum']}, {f['genre']}, [{f['item']}](https://www.wikidata.org/wiki/{f['item']})) -> {f['label']} [{tag} `{f['place_key']}`]\n")

    # draft intake files: places first (each with its source), then the artworks' links, ~args.rows rows each
    groups, cur, rows_in = [], {"sources": [], "places": [], "artworks": {}}, 0
    placed = set()
    for f in sorted(uniq, key=lambda f: (f["museum"], f["artwork"])):
        cost = 1
        np_ = None if f["place"] or f["depicts"] in placed else new_places[f["depicts"]]
        if np_:
            cost += 2
        if rows_in + cost > args.rows and rows_in:
            groups.append(cur); cur, rows_in = {"sources": [], "places": [], "artworks": {}}, 0
        if np_:
            placed.add(f["depicts"])
            if np_["article"]:
                skey = "wp-" + slug(np_["article"].rsplit("/", 1)[1].replace("_", " "))
                cur["sources"].append({"key": skey, "title": np_["article"].rsplit("/", 1)[1].replace("_", " ") + " (Wikipedia)", "url": np_["article"]})
            else:
                skey = "wd-" + np_["qid"].lower()
                cur["sources"].append({"key": skey, "title": f"{np_['name']} (Wikidata {np_['qid']})", "url": f"https://www.wikidata.org/wiki/{np_['qid']}"})
            cur["places"].append({**np_, "source": skey})
        cur["artworks"].setdefault(f["artwork"], []).append(f)
        rows_in += cost
    if rows_in:
        groups.append(cur)

    for n, g in enumerate(groups, 1):
        y = [f"batch:\n  title: \"Places shown in landscapes and city views, part {n}\"\n  requested: \"Ty: link the places in painting titles, starting with landscapes and city views\"\n  date: {time.strftime('%Y-%m-%d')}\n",
             "# Drafted by tools/depicts.py from Wikidata (P195 + P217 match, P136 landscape/city-view genre, P180 depicts with P625).",
             "# New places: name and coordinates as Wikidata gives them; check kind, city, region and country before merging.\n"]
        seen_src = set()
        if g["sources"]:
            y.append("sources:")
            for s in g["sources"]:
                if s["key"] in seen_src:
                    continue
                seen_src.add(s["key"])
                y.append(f"  - {{key: {s['key']}, title: {json.dumps(s['title'], ensure_ascii=False)}, url: {json.dumps(s['url'])}}}")
            y.append("")
        if g["places"]:
            y.append("places:")
            for p in g["places"]:
                y.append(f"  - key: {p['key']}\n    name: {json.dumps(p['name'], ensure_ascii=False)}\n    kind: TODO\n    country: TODO\n    lat: {p['lat']}\n    lng: {p['lng']}\n    sources: [{p['source']}]   # Wikidata {p['qid']}")
            y.append("")
        y.append("artworks:")
        for akey, fs in g["artworks"].items():
            y.append(f"  - key: {akey}   # {fs[0]['title']} — Wikidata {fs[0]['item']} ({fs[0]['genre']})")
            y.append("    places:")
            for f in fs:
                y.append(f"      - {{place: {f['place_key']}, role: depicts}}   # P180 {f['depicts']} {f['label']}")
        open(os.path.join(args.out, f"draft-{n}.yaml"), "w", encoding="utf-8").write("\n".join(y) + "\n")
    print(f"{len(uniq)} links ({sum(1 for f in uniq if f['place'])} to existing places), {len(new_places)} new places, {len(groups)} draft files in {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
