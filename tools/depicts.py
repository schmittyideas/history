#!/usr/bin/env python3
"""Find the places our landscapes and city views depict, from Wikidata, as a draft intake file.

    export SUPABASE_URL=https://alhvzdvabugmkeqmvmiz.supabase.co SUPABASE_SECRET_KEY=<anon key from config.js>
    python tools/depicts.py --out depicts/            # every museum
    python tools/depicts.py --out depicts/ --museum tate-britain --museum national-gallery
    python tools/depicts.py --out depicts/ --titles  # suggestions from titles, for paintings Wikidata
                                                     # files as landscapes but says nothing about what they show

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
Nothing is matched on title words alone: "The Judgement of Paris" isn't Paris. The --titles mode only suggests:
it takes landscape and city-view paintings with no P180, pulls the place-like phrases from their titles
("Hampstead Heath, Looking Toward Harrow" -> "Hampstead Heath", "Harrow"), looks each up on Wikidata, keeps
those with coordinates, and writes <out>/titles.md for someone to check against the museum's own description.
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
    """One of our places: the same name within NEAR_KM; else ours is the longer form of the name within 2 km
    ("Florence Cathedral" and our "Florence Cathedral (Santa Maria del Fiore)"); never the other way round, so
    "Nieuwe Kerk Delft" isn't Delft and "Ivry-sur-Seine" isn't Ivry Cemetery; and a shared word alone never
    matches ("Ponte Vecchio" isn't Palazzo Vecchio)."""
    here, label = (r["lat"], r["lng"]), fold(r["label"])
    near = sorted(((km(here, (float(p["lat"]), float(p["lng"]))), p) for p in ours), key=lambda x: x[0])
    names = lambda p: [n for n in (fold(p["name"]), fold(p["historical_name"])) if n]
    for d, p in near:
        if d <= NEAR_KM and label in names(p):
            return p
    for d, p in near:
        if d > 2:
            break
        if any(n.startswith(label + " ") for n in names(p)):
            return p
    return None


def museum_genre_paintings(http, qid):
    """Landscape and city-view paintings in a museum that say nothing about what they show (no P180)."""
    genres = " ".join(f"wd:{g}" for g in GENRES)
    q = f"""
SELECT ?item ?inv ?genre WHERE {{
  ?item wdt:P195 wd:{qid}; wdt:P217 ?inv; wdt:P136 ?genre.
  VALUES ?genre {{ {genres} }}
  FILTER NOT EXISTS {{ ?item wdt:P180 ?any. }}
}}"""
    return [{"item": b["item"]["value"].rsplit("/", 1)[1], "inv": b["inv"]["value"], "genre": GENRES.get(b["genre"]["value"].rsplit("/", 1)[1])}
            for b in http.sparql(q)]


# Words that open or join a place in a title, and words that never name one on their own.
JOINERS = r"looking|toward|towards|from|near|above|below|beside|across|over|at|in|on|of|with|and|by|seen|view|views|after|the|a|an|le|la|les|de|du|des|der|die|das|van|von|bei|aan"
NOT_PLACES = {"view", "landscape", "evening", "morning", "sunset", "sunrise", "storm", "winter", "summer", "autumn", "spring",
              "river", "sea", "coast", "beach", "harbour", "harbor", "mill", "road", "bridge", "church", "castle", "village",
              "farm", "cottage", "trees", "wood", "forest", "lake", "study", "sketch", "moonlight", "snow", "boats", "ships",
              "looking", "villas", "houses", "street", "garden", "park", "ruins", "night", "dawn", "dusk", "fog", "mist"}


def title_phrases(title):
    """Capitalised phrases in a title that might name a place: 'Hampstead Heath, Looking Toward Harrow'."""
    out = []
    text = re.sub(r"[,;:()\[\]]", "|", " " + title + " ")
    text = re.sub(rf"(?<=\s)(?:{JOINERS})(?=\s)", "|", text, flags=re.I)
    for part in text.split("|"):
        part = part.strip(" .'\"‘’“”")
        words = part.split()
        if not words or len(part) < 4 or not words[0][0].isupper() or part.lower() in NOT_PLACES:
            continue
        if all(w.lower() in NOT_PLACES for w in words):
            continue
        out.append(part)
    return list(dict.fromkeys(out))


def lookup_place(http, phrase, cache):
    """The first Wikidata item for a phrase that has coordinates, and its English article."""
    if phrase in cache:
        return cache[phrase]
    hits = http.get(WIKIDATA_API, {"action": "wbsearchentities", "format": "json", "language": "en", "type": "item", "limit": 5, "search": phrase}).get("search", [])
    found = None
    if hits:
        data = http.get(WIKIDATA_API, {"action": "wbgetentities", "format": "json", "ids": "|".join(h["id"] for h in hits),
                                       "props": "claims|sitelinks|labels|descriptions", "sitefilter": "enwiki", "languages": "en"})
        for h in hits:
            e = data["entities"].get(h["id"], {})
            c = e.get("claims", {}).get("P625")
            if not c:
                continue
            v = c[0]["mainsnak"].get("datavalue", {}).get("value")
            if not v:
                continue
            found = {"qid": h["id"], "label": e.get("labels", {}).get("en", {}).get("value", phrase), "desc": e.get("descriptions", {}).get("en", {}).get("value", ""),
                     "lat": round(v["latitude"], 4), "lng": round(v["longitude"], 4), "article": e.get("sitelinks", {}).get("enwiki", {}).get("title")}
            break
    cache[phrase] = found
    time.sleep(.4)
    return found


def titles_mode(http, args, artworks, museums, qids, ours, have):
    by_museum_inv = {(a["museum_id"], norm_inv(a["accession_number"])): a for a in artworks if a["museum_id"] and a["accession_number"]}
    depicted = {h["artwork_id"] for h in have if h["role"] == "depicts"}
    cache, rows = {}, []
    for m in museums:
        q = qids.get(m["key"])
        if not q:
            continue
        try:
            paintings = museum_genre_paintings(http, q)
        except Exception as e:
            print(f"  {m['key']}: {e}", file=sys.stderr); continue
        n = 0
        for p in paintings:
            a = by_museum_inv.get((m["id"], norm_inv(p["inv"])))
            if not a or a["id"] in depicted:
                continue
            for phrase in title_phrases(a["name"]):
                hit = lookup_place(http, phrase, cache)
                if not hit:
                    continue
                ourp = our_place(ours, {"label": hit["label"], "lat": hit["lat"], "lng": hit["lng"]})
                rows.append({"artwork": a["key"], "title": a["name"], "museum": m["key"], "item": p["item"], "genre": p["genre"], "phrase": phrase, **hit,
                             "place": ourp["key"] if ourp else None})
                n += 1
        print(f"  {m['key']}: {len(paintings)} landscapes without P180 on Wikidata, {n} title suggestions", file=sys.stderr)
        time.sleep(2)
    json.dump(rows, open(os.path.join(args.out, "titles.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    with open(os.path.join(args.out, "titles.md"), "w", encoding="utf-8") as out:
        out.write(f"# Title suggestions: {len(rows)} (check each against the museum's description before linking)\n\n")
        for r in sorted(rows, key=lambda r: (r["museum"], r["title"])):
            where = f"existing `{r['place']}`" if r["place"] else f"new: {r['label']} ({r['desc']}), {r['lat']}, {r['lng']}"
            out.write(f"- {r['title']} ({r['museum']}, [{r['item']}](https://www.wikidata.org/wiki/{r['item']})): \"{r['phrase']}\" -> {where}"
                      + (f" [wiki](https://en.wikipedia.org/wiki/{r['article'].replace(' ', '_')})" if r["article"] else "") + "\n")
    print(f"{len(rows)} title suggestions in {args.out}/titles.md", file=sys.stderr)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default="depicts")
    ap.add_argument("--museum", action="append", help="museum key (default: every museum)")
    ap.add_argument("--rows", type=int, default=150, help="rows per draft intake file")
    ap.add_argument("--titles", action="store_true", help="suggest places from titles of landscapes Wikidata says nothing about")
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

    if args.titles:
        return titles_mode(http, args, artworks, museums, qids, [p for p in places if p["lat"] is not None and p["lng"] is not None], have)

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
