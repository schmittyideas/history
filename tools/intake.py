#!/usr/bin/env python3
"""Intake files -> History Project database.

  python tools/intake.py plan  inbox/2026-10-05-white-ship.yaml [...]   # preview (Markdown), writes nothing
  python tools/intake.py apply inbox/2026-10-05-white-ship.yaml [...]   # adds and updates; never deletes

Needs SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.
See docs/intake-format.md for the file format.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
from dataclasses import dataclass, field

import yaml

try:
    import requests
except ImportError:  # only needed for the real database
    requests = None


# --------------------------------------------------------------------------- database access

class RestDB:
    """Minimal PostgREST client (Supabase REST API)."""

    def __init__(self, url: str, key: str):
        if requests is None:
            raise SystemExit("The 'requests' package is required: pip install requests")
        self.base = url.rstrip("/") + "/rest/v1"
        self.h = {"apikey": key, "Content-Type": "application/json"}
        if not key.startswith("sb_"):
            self.h["Authorization"] = f"Bearer {key}"

    PAGE = 1000  # Supabase returns at most this many rows per request

    def select(self, table, columns="*", **eq):
        """Every matching row, read in pages: a single request stops at 1,000 rows, and a table read short
        would make apply think existing moments and links are missing, and add them again."""
        out = []
        while True:
            params = {"select": columns, "order": "id", "limit": self.PAGE, "offset": len(out),
                      **{k: f"eq.{v}" for k, v in eq.items()}}
            r = requests.get(f"{self.base}/{table}", headers=self.h, params=params, timeout=30)
            self._check(r, table)
            rows = r.json()
            out += rows
            if len(rows) < self.PAGE:
                return out

    def insert(self, table, row, ignore_duplicates_on=None):
        h = {**self.h, "Prefer": "return=representation"}
        params = {}
        if ignore_duplicates_on:
            h["Prefer"] += ",resolution=ignore-duplicates"
            params["on_conflict"] = ignore_duplicates_on
        r = requests.post(f"{self.base}/{table}", headers=h, params=params, data=json.dumps(row, default=str), timeout=30)
        self._check(r, table)
        out = r.json()
        return out[0] if out else None

    def update(self, table, match: dict, changes: dict):
        h = {**self.h, "Prefer": "return=representation"}
        params = {k: f"eq.{v}" for k, v in match.items()}
        r = requests.patch(f"{self.base}/{table}", headers=h, params=params, data=json.dumps(changes, default=str), timeout=30)
        self._check(r, table)
        return r.json()

    @staticmethod
    def _check(r, table):
        if r.status_code >= 300:
            raise RuntimeError(f"{table}: HTTP {r.status_code}: {r.text[:300]}")


# --------------------------------------------------------------------------- helpers

def parse_when(v):
    """Year or full date -> (year, date or None). BC years are negative (-384 = 384 BC).

    Raises ValueError with a readable message; plan_files turns it into a preview error,
    so a bad date never reaches apply.
    """
    if v is None:
        return None, None
    if isinstance(v, dt.date):
        return v.year, v.isoformat()
    s = str(v).strip()
    if re.fullmatch(r"-?\d+", s):
        year = int(s)
        if year == 0:
            raise ValueError("there is no year 0: 1 BC is `-1`, AD 1 is `1`")
        return year, None
    if re.fullmatch(r"-\d+-\d+-\d+", s):
        raise ValueError(f"`{s}`: full dates aren't supported for BC, use the year alone (`{int(s.split('-')[1]) * -1}`)")
    try:
        m = re.fullmatch(r"(\d{1,4})-(\d{1,2})-(\d{1,2})", s)  # years before 1000 may have fewer digits: 988-05-19
        if not m:
            raise ValueError
        d = dt.date(*map(int, m.groups()))
    except ValueError:
        raise ValueError(f"`{s}` is not a year or a YYYY-MM-DD date") from None
    return d.year, d.isoformat()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s or "").lower()).strip("-")


def realm_key(x):
    return x.get("key") or slug(x.get("name"))


def title_key(x):
    """A title's key: given, or built from person, title and start year so a second reign gets its own row."""
    if x.get("key"):
        return x["key"]
    try:
        year = parse_when(x.get("from"))[0]
    except ValueError:
        year = None
    return f"{x.get('person')}--{slug(x.get('title'))}" + (f"--{year}" if year is not None else "")


def as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


@dataclass
class Plan:
    adds: dict = field(default_factory=lambda: {k: [] for k in PLAN_GROUPS})
    updates: dict = field(default_factory=lambda: {k: [] for k in PLAN_GROUPS})
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    open_discrepancies: list = field(default_factory=list)   # (record label, discrepancy) for records this batch touches


SECTIONS = ["sources", "places", "realms", "people", "events", "museums", "artworks", "links", "moments", "titles", "discrepancies", "log"]
PLAN_GROUPS = SECTIONS + ["external"]   # the preview also lists external links, which live on records, not in a section
REGIONS = ("Western Europe", "Northern Europe", "Eastern Europe", "Middle East and North Africa", "Sub-Saharan Africa",
           "Central Asia", "South Asia", "East Asia", "Southeast Asia", "Americas", "Oceania")  # matches sql/008's check
DATA_ACCESS = ("open-api", "open-data-download", "website-only", "no-access", "unknown")
MUSEUM_FIELDS = {"name": "name", "kind": "kind", "address": "address", "city": "city", "region": "region", "country": "modern_country",
                 "lat": "lat", "lng": "lng", "website": "website", "collection_url": "collection_url",
                 "collection_url_pattern": "collection_url_pattern", "data_access": "data_access", "data_api_url": "data_api_url",
                 "data_licence": "data_licence", "data_notes": "data_notes", "place": "place_key", "obsidian_link": "obsidian_link", "note": "note"}
COVERAGE = ("not-read", "partly", "complete")
ABOUT_KINDS = ("person", "place", "event", "artwork")
EXTERNAL_KINDS = (("person", "people"), ("place", "places"), ("event", "events"), ("artwork", "artworks"), ("museum", "museums"))

PEOPLE_FIELDS = {"name": "name", "type": "type", "roles": "roles", "house": "house", "realm": "realm",
                 "prominence": "prominence", "obsidian_link": "obsidian_link", "note": "note",
                 "born_estimated": "birth_estimated", "died_estimated": "death_estimated",
                 "image_url": "image_url", "image_thumb": "image_thumb", "image_page": "image_page", "image_license": "image_license",
                 "coverage": "coverage", "coverage_note": "coverage_note",
                 "sitelinks": "sitelinks", "sitelinks_on": "sitelinks_on"}
PLACE_FIELDS = {"name": "name", "historical_name": "historical_name", "kind": "kind", "region": "region",
                "city": "city", "country": "modern_country", "lat": "lat", "lng": "lng", "visitable": "visitable_today",
                "visit_site": "visit_site", "obsidian_link": "obsidian_link", "note": "note",
                "founded_estimated": "start_estimated", "built_by": "built_by", "architect": "architect"}
EVENT_FIELDS = {"name": "name", "type": "type", "end_year": "end_year", "estimated": "estimated",
                "prominence": "prominence", "obsidian_link": "obsidian_link", "note": "note", "visitable": "visitable_today",
                "visit_site": "visit_site"}
ARTWORK_FIELDS = {"accession": "accession_number", "museum_url": "museum_url", "name": "name", "kind": "kind", "medium": "medium", "estimated": "estimated", "collection": "collection",
                  "image_url": "image_url", "image_thumb": "image_thumb", "image_page": "image_page", "image_license": "image_license",
                  "image_credit": "image_credit", "prominence": "prominence", "obsidian_link": "obsidian_link", "note": "note"}
ARTWORK_LINKS = (("people", "person", "artwork_people", "entity_id"),   # section key, item key, table, id column
                 ("places", "place", "artwork_places", "place_id"),
                 ("events", "event", "artwork_events", "event_id"))
TITLE_FIELDS = {"title": "title", "realm": "realm", "from_estimated": "start_estimated", "to_estimated": "end_estimated",
                "disputed": "disputed", "note": "note", "obsidian_link": "obsidian_link"}
LOG_FIELDS = {"title": "title", "learned_on": "learned_on", "medium": "medium", "source_title": "source_title",
              "source_detail": "source_detail", "url": "url", "where": "where_text", "notes": "notes",
              "links": "links", "details": "details"}
LINK_KINDS = {  # first key = source side, second = target side, rel_type, year fields
    "parent": ("parent", "child", "parent"),
    "spouse": ("spouse", "to", "spouse"),
    "patron": ("patron", "artist", "patron"),
    "teacher": ("teacher", "student", "teacher"),
}


# --------------------------------------------------------------------------- loading existing data

class World:
    """What the database already holds, indexed by key."""

    def __init__(self, db):
        self.db = db
        self.people = {r["key"]: r for r in db.select("entities", "id,key,name,birth_year,death_year") if r.get("key")}
        self.places = {r["key"]: r for r in db.select("places", "id,key,name,lat,lng") if r.get("key")}
        self.events = {r["key"]: r for r in db.select("events", "id,key,name") if r.get("key")}
        self.sources = {r["key"]: r for r in db.select("sources", "id,key,title")}
        self.logs = {r["key"]: r for r in db.select("learning_log", "id,key,title")}
        self.rels = db.select("relationships", "id,source_id,target_id,rel_type,start_year,end_year")
        self.moments = db.select("person_places", "id,entity_id,place_id,role,year")
        self.event_people = db.select("event_people", "id,event_id,entity_id,role")
        try:
            self.museums = {r["key"]: r for r in db.select("museums", "id,key,name")}
        except RuntimeError:  # sql/014 not run yet
            self.museums = None
        try:
            self.artworks = {r["key"]: r for r in db.select("artworks", "id,key,name")}
            self.artwork_links = {t: db.select(t, "id,artwork_id," + col + ",role") for _, _, t, col in ARTWORK_LINKS}
        except RuntimeError:  # sql/011 not run yet
            self.artworks, self.artwork_links = None, {}
        self.unkeyed_people = [r for r in db.select("entities", "id,key,name,birth_year,death_year") if not r.get("key")]
        try:
            self.discrepancies = {r["key"]: r for r in db.select("discrepancies", "id,key,question,about,field,claims,status,note,resolution")}
        except RuntimeError:  # sql/005 not run yet
            self.discrepancies = None
        try:
            self.titles = {r["key"]: r for r in db.select("titles", "id,key,entity_id,title,start_year,end_year")}
        except RuntimeError:  # sql/007 not run yet
            self.titles = None
        try:
            self.realms = {r["key"]: r for r in db.select("realms", "id,key,name,region")}
        except RuntimeError:  # sql/008 not run yet
            self.realms = None
        try:
            self.event_places = db.select("event_places", "id,event_id,place_id,role,note")
        except RuntimeError:  # sql/016 not run yet
            self.event_places = None
        try:
            self.external = db.select("external_links", "id,record_type,record_key,system,external_id,url,label,note")
        except RuntimeError:  # sql/015 not run yet
            self.external = None


# --------------------------------------------------------------------------- planning

def plan_files(world: World, docs: list[tuple[str, dict]]) -> Plan:
    p = Plan()
    new = {"people": {}, "places": {}, "events": {}, "sources": {}, "artworks": {}, "museums": {}}

    # First pass: collect every key the files define, so references across sections and files resolve.
    for _, d in docs:
        for s in as_list(d.get("sources")):
            new["sources"][s.get("key")] = s
        for x in as_list(d.get("places")):
            new["places"][x.get("key")] = x
        for x in as_list(d.get("people")):
            new["people"][x.get("key")] = x
        for x in as_list(d.get("events")):
            new["events"][x.get("key")] = x
        for x in as_list(d.get("artworks")):
            new["artworks"][x.get("key")] = x
        for x in as_list(d.get("museums")):
            new["museums"][x.get("key")] = x

    def known(kind, key):
        table = {"person": "people", "place": "places", "event": "events", "source": "sources", "artwork": "artworks", "museum": "museums"}[kind]
        return key in (getattr(world, table) or {}) or key in new[table]

    def ref(kind, key, where):
        if key is None:
            p.errors.append(f"{where}: missing {kind}")
            return False
        if not known(kind, key):
            p.errors.append(f"{where}: unknown {kind} `{key}` (not in the database or this file)")
            return False
        return True

    def check_sources(item, where, require=True):
        srcs = as_list(item.get("sources"))
        for s in srcs:
            ref("source", s, where)
        if require and not srcs:
            p.warnings.append(f"{where}: no source given")

    def when(item, field_name, where):
        """parse_when for one field, recording a bad value as an error instead of crashing."""
        try:
            return parse_when(item.get(field_name))
        except ValueError as e:
            p.errors.append(f"{where} `{field_name}`: {e}")
            return None, None

    for fname, d in docs:
        if not isinstance(d.get("batch"), dict) or not d["batch"].get("title"):
            p.errors.append(f"{fname}: `batch.title` is required")
        for sect in d:
            if sect != "batch" and sect not in SECTIONS:
                p.errors.append(f"{fname}: unknown section `{sect}` (it would be ignored)")

        for s in as_list(d.get("sources")):
            if not s.get("key") or not s.get("title"):
                p.errors.append(f"{fname}: every source needs `key` and `title`")
                continue
            (p.updates if s["key"] in world.sources else p.adds)["sources"].append(s["key"])

        for x in as_list(d.get("places")):
            k = x.get("key")
            if not k:
                p.errors.append(f"{fname}: a place is missing `key`"); continue
            if k in world.places:
                p.updates["places"].append(k)
            else:
                if not x.get("name"):
                    p.errors.append(f"place `{k}`: new places need `name`")
                p.adds["places"].append(k)
                if x.get("lat") is None or x.get("lng") is None:
                    p.warnings.append(f"place `{k}`: no coordinates, so it won't appear on the map")
            fy, _ = when(x, "founded", f"place `{k}`"); ey, _ = when(x, "ended", f"place `{k}`")
            if fy is not None and ey is not None and ey < fy:
                p.errors.append(f"place `{k}`: ended ({ey}) before founded ({fy})")
            check_sources(x, f"place `{k}`", require=k not in world.places)

        for x in as_list(d.get("people")):
            k = x.get("key")
            if not k:
                p.errors.append(f"{fname}: a person is missing `key`"); continue
            by, _ = when(x, "born", f"person `{k}`"); dy, _ = when(x, "died", f"person `{k}`")
            if by is not None and dy is not None and dy < by:
                p.errors.append(f"person `{k}`: died ({dy}) before born ({by})")
            if k in world.people:
                p.updates["people"].append(k)
            else:
                if not x.get("name") or not x.get("type"):
                    p.errors.append(f"person `{k}`: new people need `name` and `type`")
                p.adds["people"].append(k)
                nm = (x.get("name") or "").lower()
                for e in list(world.people.values()) + world.unkeyed_people:
                    if e["name"].lower() == nm and (by is None or e.get("birth_year") is None or abs(e["birth_year"] - by) <= 5):
                        p.warnings.append(f"person `{k}`: possible duplicate of existing “{e['name']}” ({e.get('key') or 'no key'})")
            pr = x.get("prominence")
            if pr is not None and pr not in (1, 2, 3, 4, 5):
                p.errors.append(f"person `{k}`: prominence must be 1–5")
            if x.get("portrait"):
                ref("artwork", x["portrait"], f"person `{k}` portrait")
            if x.get("sitelinks") is not None and not (isinstance(x["sitelinks"], int) and x["sitelinks"] >= 0):
                p.errors.append(f"person `{k}`: sitelinks must be a whole number")
            if x.get("coverage") is not None and x["coverage"] not in COVERAGE:
                p.errors.append(f"person `{k}`: coverage must be one of {', '.join(COVERAGE)}")
            elif x.get("coverage") == "partly" and not x.get("coverage_note"):
                p.warnings.append(f"person `{k}`: coverage `partly` without a `coverage_note` saying what was captured and what is missing")
            check_sources(x, f"person `{k}`", require=k not in world.people)

        for x in as_list(d.get("events")):
            k = x.get("key")
            if not k:
                p.errors.append(f"{fname}: an event is missing `key`"); continue
            if k in world.events:
                p.updates["events"].append(k)
            else:
                if not x.get("name") or not x.get("type"):
                    p.errors.append(f"event `{k}`: new events need `name` and `type`")
                if x.get("date") is None and x.get("year") is None:
                    p.warnings.append(f"event `{k}`: no date, so it won't appear on the timeline")
                p.adds["events"].append(k)
            for f in ("date", "year", "end_year"):
                when(x, f, f"event `{k}`")
            if x.get("place"):
                ref("place", x["place"], f"event `{k}`")
            # `places`: every other place the event happened at (the venues of an Olympics), each with a role.
            if x.get("places") and world.event_places is None:
                p.errors.append(f"event `{k}`: `places` needs the event_places table (sql/016)")
            for ep_ in as_list(x.get("places")):
                if not isinstance(ep_, dict) or not ep_.get("role"):
                    p.errors.append(f"event `{k}` places: every entry needs `place` and `role`"); continue
                ref("place", ep_.get("place"), f"event `{k}` places")
            for pe in as_list(x.get("people")):
                ref("person", pe.get("person"), f"event `{k}` people")
            check_sources(x, f"event `{k}`", require=k not in world.events)

        if d.get("museums") and world.museums is None:
            p.errors.append(f"{fname}: the database has no museums table yet: run sql/014_museums.sql first")
        for x in as_list(d.get("museums")):
            k = x.get("key")
            if not k:
                p.errors.append(f"{fname}: a museum is missing `key`"); continue
            where = f"museum `{k}`"
            if k in (world.museums or {}):
                p.updates["museums"].append(k)
            else:
                if not x.get("name"):
                    p.errors.append(f"{where}: new museums need `name`")
                p.adds["museums"].append(k)
                if x.get("lat") is None or x.get("lng") is None:
                    p.warnings.append(f"{where}: no coordinates")
            when(x, "founded", where); when(x, "data_checked_on", where)
            if x.get("data_access") is not None and x["data_access"] not in DATA_ACCESS:
                p.errors.append(f"{where}: data_access must be one of {', '.join(DATA_ACCESS)}")
            if x.get("data_access") in ("open-api", "open-data-download") and not x.get("data_licence"):
                p.warnings.append(f"{where}: open data without `data_licence`")
            if x.get("place"):
                ref("place", x["place"], where)
            check_sources(x, where, require=k not in (world.museums or {}))

        if d.get("artworks") and world.artworks is None:
            p.errors.append(f"{fname}: the database has no artworks table yet: run sql/011_artworks.sql first")
        for x in as_list(d.get("artworks")):
            k = x.get("key")
            if not k:
                p.errors.append(f"{fname}: an artwork is missing `key`"); continue
            where = f"artwork `{k}`"
            if k in (world.artworks or {}):
                p.updates["artworks"].append(k)
            else:
                if not x.get("name"):
                    p.errors.append(f"{where}: new artworks need `name`")
                p.adds["artworks"].append(k)
            my, _ = when(x, "made", where); ey, _ = when(x, "made_end", where)
            if my is not None and ey is not None and ey < my:
                p.errors.append(f"{where}: made_end ({ey}) before made ({my})")
            pr = x.get("prominence")
            if pr is not None and pr not in (1, 2, 3, 4, 5):
                p.errors.append(f"{where}: prominence must be 1–5")
            if x.get("museum"):
                ref("museum", x["museum"], where)
            if x.get("after"):
                if x["after"] == k:
                    p.errors.append(f"{where}: `after` points at itself")
                else:
                    ref("artwork", x["after"], where)
            for sect, item, _, _ in ARTWORK_LINKS:
                for a in as_list(x.get(sect)):
                    ref(item, a.get(item), f"{where} {sect}")
                    if not a.get("role"):
                        p.errors.append(f"{where} {sect}: every entry needs a `role`")
            if k not in (world.artworks or {}) and not x.get("after") and not any(a.get("role") == "creator" for a in as_list(x.get("people"))):
                p.warnings.append(f"{where}: no creator (add a person with role `creator`, or leave it if the maker is unknown)")
            if x.get("image_url") and not (x.get("image_license") and x.get("image_page")):
                p.warnings.append(f"{where}: image without `image_license` and `image_page` (where the licence and author can be checked)")
            check_sources(x, where, require=k not in (world.artworks or {}))

        # `external`: links from a record to its entry in another database (the entertainment database, later
        # restaurants and bars). Each needs a `system` and an `id` or a `url`; one link per record and system.
        for kind, sect in EXTERNAL_KINDS:
            for x in as_list(d.get(sect)):
                ext = as_list(x.get("external"))
                if ext and world.external is None:
                    p.errors.append(f"{kind} `{x.get('key')}`: `external` needs the external_links table (sql/015)")
                    continue
                systems = [e.get("system") for e in ext if isinstance(e, dict)]
                for e in ext:
                    if not isinstance(e, dict) or not e.get("system") or not (e.get("id") or e.get("url")):
                        p.errors.append(f"{kind} `{x.get('key')}` external: every entry needs `system` and an `id` or `url`")
                for sname in {sn for sn in systems if systems.count(sn) > 1}:
                    p.errors.append(f"{kind} `{x.get('key')}` external: `{sname}` listed twice (one link per system)")
                for e in ext:
                    if isinstance(e, dict) and e.get("system"):
                        have = any(r["record_type"] == kind and r["record_key"] == x.get("key") and r["system"] == e["system"] for r in world.external or [])
                        (p.updates if have else p.adds)["external"].append(f"{kind} {x.get('key')} → {e['system']}")

        for x in as_list(d.get("links")):
            kind = next((kk for kk in LINK_KINDS if kk in x), None)
            if not kind:
                p.errors.append(f"link {x}: must start with parent, spouse, patron or teacher"); continue
            a_key, b_key, _ = LINK_KINDS[kind]
            a, b = x.get(a_key), x.get(b_key)
            for f in ("year", "from") + (("to",) if kind in ("patron", "teacher") else ()):
                when(x, f, f"{kind} link {a} → {b}")
            ok = ref("person", a, f"{kind} link") & ref("person", b, f"{kind} link")
            if ok:
                (p.updates if find_rel(world, a, b, LINK_KINDS[kind][2]) else p.adds)["links"].append(f"{kind}: {a} → {b}")

        for x in as_list(d.get("moments")):
            ok = ref("person", x.get("person"), "moment") & ref("place", x.get("place"), "moment")
            if not x.get("role"):
                p.errors.append(f"moment {x}: needs `role`")
            when(x, "year", f"moment {x.get('person')} {x.get('role')}")
            if ok:
                label = f"{x.get('person')} {x.get('role')} at {x.get('place')} ({x.get('year', '?')})"
                pe, pl = world.people.get(x["person"]), world.places.get(x["place"])
                exists = pe and pl and any(m["entity_id"] == pe["id"] and m["place_id"] == pl["id"] and m["role"] == x.get("role") for m in world.moments)
                (p.updates if exists else p.adds)["moments"].append(label)

        if d.get("realms") and world.realms is None:
            p.errors.append(f"{fname}: the database has no realms table yet: run sql/008_realms.sql first")
        for x in as_list(d.get("realms")):
            k = realm_key(x)
            if not k:
                p.errors.append(f"{fname}: every realm needs `name`"); continue
            is_new = k not in (world.realms or {})
            if is_new and (not x.get("name") or not x.get("region")):
                p.errors.append(f"realm `{k}`: new realms need `name` and `region`")
            if x.get("region") and x["region"] not in REGIONS:
                p.errors.append(f"realm `{k}`: region must be one of: {', '.join(REGIONS)}")
            (p.adds if is_new else p.updates)["realms"].append(k)

        known_realms = {r["name"] for r in (world.realms or {}).values()} | {x.get("name") for _, dd in docs for x in as_list(dd.get("realms"))}
        if d.get("titles") and world.titles is None:
            p.errors.append(f"{fname}: the database has no titles table yet: run sql/007_titles.sql first")
        for x in as_list(d.get("titles")):
            k, who = title_key(x), x.get("person")
            where = f"title `{k}`"
            ok = ref("person", who, where)
            if k not in (world.titles or {}) and (not x.get("title") or not x.get("realm")):
                p.errors.append(f"{where}: new titles need `title` and `realm`")
            fy, _ = when(x, "from", where); ty, _ = when(x, "to", where)
            if fy is not None and ty is not None and ty < fy:
                p.errors.append(f"{where}: ended ({ty}) before it began ({fy})")
            if x.get("realm") and world.realms is not None and x["realm"] not in known_realms:
                p.warnings.append(f"{where}: realm “{x['realm']}” has no region yet (add it under `realms`), so the Year view files it under Other")
            if ok:  # a title held outside the holder's life is almost always a typo
                if who in new["people"]:
                    try:
                        by, dy = parse_when(new["people"][who].get("born"))[0], parse_when(new["people"][who].get("died"))[0]
                    except ValueError:
                        by = dy = None
                else:
                    by, dy = world.people[who].get("birth_year"), world.people[who].get("death_year")
                if fy is not None and by is not None and fy < by:
                    p.warnings.append(f"{where}: starts ({fy}) before {who} was born ({by})")
                if ty is not None and dy is not None and ty > dy:
                    p.warnings.append(f"{where}: ends ({ty}) after {who} died ({dy})")
            (p.updates if k in (world.titles or {}) else p.adds)["titles"].append(k)
            check_sources(x, where, require=k not in (world.titles or {}))

        if d.get("discrepancies") and world.discrepancies is None:
            p.errors.append(f"{fname}: the database has no discrepancies table yet: run sql/005_discrepancies.sql first")
        for x in as_list(d.get("discrepancies")):
            k = x.get("key")
            if not k or not x.get("question"):
                p.errors.append(f"{fname}: every discrepancy needs `key` and `question`"); continue
            (p.updates if k in (world.discrepancies or {}) else p.adds)["discrepancies"].append(k)
            if not as_list(x.get("about")):
                p.errors.append(f"discrepancy `{k}`: needs `about` (the records it concerns)")
            for a in as_list(x.get("about")):
                kind = next((kk for kk in ABOUT_KINDS if kk in a), None)
                if kind:
                    ref(kind, a[kind], f"discrepancy `{k}`")
                else:
                    p.errors.append(f"discrepancy `{k}`: `about` entries look like {{person: key}}, {{place: key}} or {{event: key}}")
            if len(as_list(x.get("claims"))) < 2:
                p.warnings.append(f"discrepancy `{k}`: fewer than two claims")
            for c in as_list(x.get("claims")):
                if "value" not in c:
                    p.errors.append(f"discrepancy `{k}`: every claim needs a `value`")
                check_sources(c, f"discrepancy `{k}` claim “{c.get('value')}”")
            if x.get("status", "open") not in ("open", "resolved"):
                p.errors.append(f"discrepancy `{k}`: status must be open or resolved")
            if x.get("status") == "resolved" and not x.get("resolution"):
                p.warnings.append(f"discrepancy `{k}`: resolved but no `resolution` saying what was decided")

        for x in as_list(d.get("log")):
            k = x.get("key")
            if not k or not x.get("title"):
                p.errors.append(f"{fname}: every log entry needs `key` and `title`"); continue
            (p.updates if k in world.logs else p.adds)["log"].append(k)
            when(x, "learned_on", f"log `{k}`")
            for a in as_list(x.get("about")):
                kind = next((kk for kk in ("person", "place", "event") if kk in a), None)
                if kind:
                    ref(kind, a[kind], f"log `{k}`")

    # Records already in the database that this batch changes or cites: show their open discrepancies,
    # so a new source gets checked against what's disputed. (Discrepancies written in this batch are listed above.)
    touched = set()
    for _, d in docs:
        for kind, sect, index in (("place", "places", world.places), ("person", "people", world.people), ("event", "events", world.events)):
            touched |= {(kind, x.get("key")) for x in as_list(d.get(sect)) if x.get("key") in index}
        for x in as_list(d.get("events")):
            touched |= {("person", pe.get("person")) for pe in as_list(x.get("people")) if pe.get("person") in world.people}
            if x.get("place") in world.places:
                touched.add(("place", x["place"]))
        for x in as_list(d.get("links")):
            kind = next((kk for kk in LINK_KINDS if kk in x), None)
            if kind:
                touched |= {("person", x.get(side)) for side in LINK_KINDS[kind][:2] if x.get(side) in world.people}
        for x in as_list(d.get("moments")):
            touched |= {("person", x.get("person")), ("place", x.get("place"))}
        touched |= {("artwork", x.get("key")) for x in as_list(d.get("artworks")) if x.get("key") in (world.artworks or {})}
    in_batch = {x.get("key") for _, d in docs for x in as_list(d.get("discrepancies"))}
    for disc in (world.discrepancies or {}).values():
        if disc.get("status") != "open" or disc["key"] in in_batch:
            continue
        for a in disc.get("about") or []:
            kind = next((kk for kk in ABOUT_KINDS if kk in a), None)
            if kind and (kind, a[kind]) in touched:
                p.open_discrepancies.append((f"{kind} `{a[kind]}`", disc))
                break
    return p


def find_rel(world, a_key, b_key, rel_type):
    a, b = world.people.get(a_key), world.people.get(b_key)
    if not a or not b:
        return None
    return next((r for r in world.rels if r["source_id"] == a["id"] and r["target_id"] == b["id"] and r["rel_type"] == rel_type), None)


def render(plan: Plan, files) -> str:
    out = ["## Intake preview", "", "Files: " + ", ".join(f"`{f}`" for f in files), ""]
    labels = {"sources": "Sources", "places": "Places", "people": "People", "events": "Events", "museums": "Museums", "artworks": "Artworks",
              "links": "Relationships", "moments": "Life moments", "titles": "Titles and reigns", "realms": "Realms", "discrepancies": "Discrepancies (sources disagree)",
              "log": "Learning log (private)", "external": "Links to other databases"}
    total_add = sum(len(v) for v in plan.adds.values()); total_upd = sum(len(v) for v in plan.updates.values())
    out.append(f"**{total_add} to add, {total_upd} to update.** Nothing is deleted.")
    out.append("")
    if plan.errors:
        out += ["### ❌ Must fix before applying", *[f"- {e}" for e in plan.errors], ""]
    if plan.warnings:
        out += ["### ⚠️ Worth a look", *[f"- {w}" for w in plan.warnings], ""]
    if plan.open_discrepancies:
        out += ["### 🔎 Open discrepancies on records in this batch",
                "Sources already disagree about these. Check the new information against them, and resolve or add a claim if it settles anything.", ""]
        for label, disc in plan.open_discrepancies:
            out.append(f"- {label}: **{disc['question']}** (`{disc['key']}`)")
            for c in disc.get("claims") or []:
                srcs = ", ".join(c.get("sources") or []) or "no source"
                out.append(f"  - “{c.get('value')}” ({srcs})" + (f": {c['note']}" if c.get("note") else ""))
            if disc.get("note"):
                out.append(f"  - Note: {disc['note']}")
        out.append("")
    for s in PLAN_GROUPS:
        a, u = plan.adds[s], plan.updates[s]
        if not a and not u:
            continue
        out.append(f"### {labels[s]}")
        out += [f"- ➕ {x}" for x in a]
        out += [f"- ✏️ {x} (update)" for x in u]
        out.append("")
    if not plan.errors:
        out.append("✅ Ready. Merging this pull request applies it to the database.")
    return "\n".join(out)


# --------------------------------------------------------------------------- applying

def apply_files(world: World, docs: list[tuple[str, dict]], log=print):
    db = world.db

    def upsert_keyed(table, index, key, row):
        row = {k: v for k, v in row.items() if v is not None}
        if key in index:
            if row:
                db.update(table, {"key": key}, row)
            log(f"updated {table} {key}")
        else:
            created = db.insert(table, {"key": key, **row})
            index[key] = created
            log(f"added {table} {key}")
        return index[key]

    def map_fields(x, mapping):
        return {col: x[k] for k, col in mapping.items() if k in x}

    def link_sources(record_type, record_key, srcs):
        for s in as_list(srcs):
            db.insert("source_links", {"source_id": world.sources[s]["id"], "record_type": record_type, "record_key": record_key},
                      ignore_duplicates_on="source_id,record_type,record_key")

    for _, d in docs:
        for s in as_list(d.get("sources")):
            upsert_keyed("sources", world.sources, s["key"], {"title": s.get("title"), "url": s.get("url"), "author": s.get("author"), "note": s.get("note")})
    for _, d in docs:
        for x in as_list(d.get("places")):
            row = map_fields(x, PLACE_FIELDS)
            if "founded" in x:  # places keep years only; a full date is reduced to its year
                row["start_year"] = parse_when(x["founded"])[0]
            if "ended" in x:
                row["end_year"] = parse_when(x["ended"])[0]
            upsert_keyed("places", world.places, x["key"], row)
    for _, d in docs:
        for x in as_list(d.get("people")):
            row = map_fields(x, PEOPLE_FIELDS)
            if "born" in x:
                row["birth_year"], row["birth_date"] = parse_when(x["born"])
            if "died" in x:
                row["death_year"], row["death_date"] = parse_when(x["died"])
            upsert_keyed("entities", world.people, x["key"], row)
    for _, d in docs:
        for x in as_list(d.get("events")):
            row = map_fields(x, EVENT_FIELDS)
            if "date" in x:
                row["start_year"], row["start_date"] = parse_when(x["date"])
            elif "year" in x:
                row["start_year"], _ = parse_when(x["year"])
            if x.get("place"):
                pl = world.places[x["place"]]
                row["place_id"] = pl["id"]
                if x["key"] not in world.events:
                    row.setdefault("location", pl.get("name"))
            if x["key"] not in world.events and "visitable_today" not in row and x.get("place"):
                row["visitable_today"] = bool(world.db.select("places", "visitable_today", id=world.places[x["place"]]["id"])[0].get("visitable_today"))
            ev = upsert_keyed("events", world.events, x["key"], row)
            for pe in as_list(x.get("people")):
                pid = world.people[pe["person"]]["id"]
                if not any(r["event_id"] == ev["id"] and r["entity_id"] == pid for r in world.event_people):
                    world.event_people.append(db.insert("event_people", {"event_id": ev["id"], "entity_id": pid, "role": pe.get("role")}))
                    log(f"linked {pe['person']} to {x['key']}")
            for ep_ in as_list(x.get("places")):
                plid = world.places[ep_["place"]]["id"]
                have = next((r for r in world.event_places if r["event_id"] == ev["id"] and r["place_id"] == plid and r["role"] == ep_["role"]), None)
                if have:
                    if ep_.get("note") is not None:
                        db.update("event_places", {"id": have["id"]}, {"note": ep_["note"]})
                else:
                    world.event_places.append(db.insert("event_places", {"event_id": ev["id"], "place_id": plid, "role": ep_["role"], "note": ep_.get("note")}))
                    log(f"linked {ep_['place']} to {x['key']} as {ep_['role']}")
    for _, d in docs:
        for x in as_list(d.get("museums")):
            row = map_fields(x, MUSEUM_FIELDS)
            if "founded" in x:
                row["start_year"] = parse_when(x["founded"])[0]
            if "data_checked_on" in x:
                row["data_checked_on"] = parse_when(x["data_checked_on"])[1] or f"{x['data_checked_on']}-01-01"
            upsert_keyed("museums", world.museums, x["key"], row)
    for _, d in docs:  # artworks: rows first; "after" and the links need every artwork's id
        for x in as_list(d.get("artworks")):
            row = map_fields(x, ARTWORK_FIELDS)
            if x.get("museum"):
                row["museum_id"] = world.museums[x["museum"]]["id"]
            if "made" in x:
                row["start_year"] = parse_when(x["made"])[0]
            if "made_end" in x:
                row["end_year"] = parse_when(x["made_end"])[0]
            upsert_keyed("artworks", world.artworks, x["key"], row)
    for _, d in docs:
        for x in as_list(d.get("artworks")):
            art = world.artworks[x["key"]]
            if x.get("after"):
                db.update("artworks", {"id": art["id"]}, {"derived_from_id": world.artworks[x["after"]]["id"]})
            for sect, item, table, col in ARTWORK_LINKS:
                index = {"people": world.people, "places": world.places, "events": world.events}[sect]
                for a in as_list(x.get(sect)):
                    target = index[a[item]]["id"]
                    have = world.artwork_links[table]
                    if not any(r["artwork_id"] == art["id"] and r[col] == target and r["role"] == a["role"] for r in have):
                        have.append(db.insert(table, {"artwork_id": art["id"], col: target, "role": a["role"]}))
                        log(f"linked {a[item]} to artwork {x['key']} as {a['role']}")
    for _, d in docs:
        for x in as_list(d.get("people")):
            if x.get("portrait"):
                db.update("entities", {"key": x["key"]}, {"portrait_artwork_id": world.artworks[x["portrait"]]["id"]})
    for _, d in docs:
        for x in as_list(d.get("links")):
            kind = next(kk for kk in LINK_KINDS if kk in x)
            a_key, b_key, rel_type = LINK_KINDS[kind]
            a, b = world.people[x[a_key]], world.people[x[b_key]]
            years = {}
            if kind == "spouse" and "year" in x:
                years["start_year"] = x["year"]
            if "from" in x:
                years["start_year"] = x["from"]
            if "to" in x and kind in ("patron", "teacher"):
                years["end_year"] = x["to"]
            existing = find_rel(world, x[a_key], x[b_key], rel_type)
            if existing:
                if years:
                    db.update("relationships", {"id": existing["id"]}, years)
            else:
                world.rels.append(db.insert("relationships", {"source_id": a["id"], "target_id": b["id"], "rel_type": rel_type, **years}))
                log(f"added {kind} link {x[a_key]} → {x[b_key]}")
            link_sources("relationship", f"{kind}:{x[a_key]}>{x[b_key]}", x.get("sources"))
    for _, d in docs:
        for x in as_list(d.get("moments")):
            pid, plid = world.people[x["person"]]["id"], world.places[x["place"]]["id"]
            existing = next((m for m in world.moments if m["entity_id"] == pid and m["place_id"] == plid and m["role"] == x["role"]), None)
            if existing:
                if x.get("year") is not None:
                    db.update("person_places", {"id": existing["id"]}, {"year": x["year"]})
            else:
                world.moments.append(db.insert("person_places", {"entity_id": pid, "place_id": plid, "role": x["role"], "year": x.get("year")}))
                log(f"added moment {x['person']} {x['role']} at {x['place']}")
            link_sources("moment", f"{x['person']}:{x['role']}:{x['place']}", x.get("sources"))
    for _, d in docs:
        for x in as_list(d.get("realms")):
            upsert_keyed("realms", world.realms, realm_key(x),
                         {"name": x.get("name"), "region": x.get("region"), "modern_country": x.get("country"), "note": x.get("note")})
    for _, d in docs:
        for x in as_list(d.get("titles")):
            k = title_key(x)
            row = {"entity_id": world.people[x["person"]]["id"], **map_fields(x, TITLE_FIELDS)}
            if "from" in x:
                row["start_year"], row["start_date"] = parse_when(x["from"])
            if "to" in x:
                row["end_year"], row["end_date"] = parse_when(x["to"])
            upsert_keyed("titles", world.titles, k, row)
            link_sources("title", k, x.get("sources"))
    for _, d in docs:
        for kind, sect in (("place", "places"), ("person", "people"), ("event", "events"), ("artwork", "artworks"), ("museum", "museums")):
            for x in as_list(d.get(sect)):
                link_sources(kind, x["key"], x.get("sources"))
    for _, d in docs:
        for kind, sect in EXTERNAL_KINDS:
            for x in as_list(d.get(sect)):
                for e in as_list(x.get("external")):
                    row = {"external_id": e.get("id"), "url": e.get("url"), "label": e.get("label"), "note": e.get("note")}
                    have = next((r for r in world.external if r["record_type"] == kind and r["record_key"] == x["key"] and r["system"] == e["system"]), None)
                    if have:
                        db.update("external_links", {"id": have["id"]}, row)
                    else:
                        world.external.append(db.insert("external_links", {"record_type": kind, "record_key": x["key"], "system": e["system"], **row}))
                        log(f"linked {kind} {x['key']} to {e['system']}")
    for _, d in docs:
        for x in as_list(d.get("discrepancies")):
            row = {"question": x["question"], "about": as_list(x.get("about")), "field": x.get("field"),
                   "claims": as_list(x.get("claims")), "status": x.get("status", "open"), "note": x.get("note"),
                   "resolution": x.get("resolution")}
            if x["key"] in world.discrepancies:
                row["updated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
            upsert_keyed("discrepancies", world.discrepancies, x["key"], row)
    for _, d in docs:
        for x in as_list(d.get("log")):
            row = map_fields(x, LOG_FIELDS)
            if "learned_on" in row:
                row["learned_on"] = parse_when(row["learned_on"])[1] or f"{row['learned_on']}-01-01"
            entry = upsert_keyed("learning_log", world.logs, x["key"], row)
            for a in as_list(x.get("about")):
                kind = next((kk for kk in ("person", "place", "event") if kk in a), None)
                if kind:
                    db.insert("learning_log_items", {"log_id": entry["id"], "record_type": kind, "record_key": a[kind]},
                              ignore_duplicates_on="log_id,record_type,record_key")


# --------------------------------------------------------------------------- main

def load(files):
    docs = []
    for f in files:
        with open(f, encoding="utf-8") as fh:
            d = yaml.safe_load(fh) or {}
        if not isinstance(d, dict):
            raise SystemExit(f"{f}: not a valid intake file")
        docs.append((f, d))
    return docs


def main(argv):
    if len(argv) < 2 or argv[0] not in ("plan", "apply"):
        print(__doc__); return 2
    cmd, files = argv[0], [f for f in argv[1:] if f.strip()]
    if not files:
        print("No intake files to process."); return 0
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SECRET_KEY")
    docs = load(files)
    world = World(RestDB(url, key))
    plan = plan_files(world, docs)
    if cmd == "plan":
        print(render(plan, files))
        return 1 if plan.errors else 0
    if plan.errors:
        print(render(plan, files)); print("\nNot applied: fix the errors above first.")
        return 1
    apply_files(world, docs)
    print("Applied:", ", ".join(files))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
