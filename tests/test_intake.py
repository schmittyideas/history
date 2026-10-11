"""Offline test: runs plan and apply against an in-memory copy of the database."""
import json, re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import intake  # noqa: E402

KEYS = {"William I": "william-i-of-england", "Robert Curthose": "robert-curthose", "William II": "william-ii-of-england",
        "Henry I": "henry-i-of-england", "Adela": "adela-of-normandy", "Matilda of Flanders": "matilda-of-flanders",
        "Sybilla of Conversano": "sybilla-of-conversano", "Matilda of Scotland": "matilda-of-scotland",
        "Adeliza of Louvain": "adeliza-of-louvain", "Stephen of Blois": "stephen-of-blois", "Harold II": "harold-ii-of-england",
        "Falaise Castle": "falaise-castle", "Battle Abbey": "battle-abbey", "Westminster Abbey": "westminster-abbey",
        "Saint-Gervais, Rouen": "saint-gervais-rouen", "Abbaye-aux-Hommes": "abbaye-aux-hommes", "Abbaye-aux-Dames": "abbaye-aux-dames",
        "Reading Abbey": "reading-abbey", "Waltham Abbey": "waltham-abbey", "Musée de la Tapisserie": "musee-de-la-tapisserie",
        "Conversano": "conversano", "Jerusalem": "jerusalem", "Battle of Hastings": "battle-of-hastings",
        "Coronation of William I": "coronation-of-william-i"}

class FakeDB:
    def __init__(self, snap):
        self.t = {"entities": snap["entities"], "places": snap["places"], "events": snap["events"],
                  "relationships": snap["relationships"], "person_places": snap["person_places"], "event_people": snap["event_people"],
                  "sources": [], "source_links": [], "learning_log": [], "learning_log_items": [], "discrepancies": [], "titles": [], "realms": [],
                  "artworks": [], "artwork_people": [], "artwork_places": [], "artwork_events": [], "museums": [], "external_links": []}
        for name in ("entities", "places", "events"):
            for r in self.t[name]:
                r["key"] = KEYS.get(r["name"])
        self.writes = []
    def select(self, table, columns="*", **eq):
        rows = [r for r in self.t[table] if all(str(r.get(k)) == str(v) for k, v in eq.items())]
        return [dict(r) for r in rows]
    def insert(self, table, row, ignore_duplicates_on=None):
        if ignore_duplicates_on:
            cols = ignore_duplicates_on.split(",")
            if any(all(r.get(c) == row.get(c) for c in cols) for r in self.t[table]):
                return None
        if "key" in row and any(r.get("key") == row["key"] for r in self.t[table]):
            raise RuntimeError(f"duplicate key {row['key']} in {table}")
        row = {"id": max([r["id"] for r in self.t[table]] or [0]) + 1, **row}
        self.t[table].append(row); self.writes.append(("insert", table, row)); return dict(row)
    def update(self, table, match, changes):
        hit = [r for r in self.t[table] if all(r.get(k) == v for k, v in match.items())]
        for r in hit: r.update(changes)
        self.writes.append(("update", table, match, changes)); return hit

def snapshot():
    s = (ROOT / "data" / "snapshot.js").read_text(encoding="utf-8")
    return json.loads(re.search(r"window\.HISTORY_SNAPSHOT = (\{.*\});", s, re.S).group(1))

def test_example_plans_and_applies():
    db = FakeDB(snapshot())
    docs = intake.load([str(ROOT / "inbox/examples/2026-10-05-white-ship.yaml")])
    world = intake.World(db)
    plan = intake.plan_files(world, docs)
    print(intake.render(plan, ["example"]))
    assert not plan.errors, plan.errors
    assert "henry-i-of-england" in plan.updates["people"]
    assert set(plan.adds["people"]) == {"william-adelin", "empress-matilda", "geoffrey-plantagenet", "king-stephen"}
    intake.apply_files(world, docs, log=lambda m: None)
    ents = {r["key"]: r for r in db.t["entities"]}
    assert ents["william-adelin"]["death_date"] == "1120-11-25" and ents["william-adelin"]["death_year"] == 1120
    assert ents["empress-matilda"]["birth_estimated"] is True
    assert ents["henry-i-of-england"]["prominence"] == 5 and ents["henry-i-of-england"]["name"] == "Henry I"
    ev = {r["key"]: r for r in db.t["events"]}
    assert ev["white-ship-1120"]["place_id"] == next(p["id"] for p in db.t["places"] if p["key"] == "barfleur")
    assert ev["coronation-of-stephen"]["start_year"] == 1135
    rels = [(r["source_id"], r["target_id"], r["rel_type"]) for r in db.t["relationships"]]
    assert (ents["matilda-of-scotland"]["id"], ents["empress-matilda"]["id"], "parent") in rels
    assert len(db.t["learning_log"]) == 1 and len(db.t["learning_log_items"]) == 3
    n_before = len(db.writes)
    # Re-applying the same file must not create duplicates.
    world2 = intake.World(db)
    plan2 = intake.plan_files(world2, docs)
    assert not plan2.adds["people"] and not plan2.adds["links"], plan2.adds
    intake.apply_files(world2, docs, log=lambda m: None)
    assert len([r for r in db.t["entities"] if r.get("key") == "william-adelin"]) == 1
    assert sum(1 for w in db.writes[n_before:] if w[0] == "insert" and w[1] in ("entities", "relationships", "person_places", "event_people")) == 0

def test_errors_are_caught():
    db = FakeDB(snapshot())
    docs = [("bad.yaml", {"batch": {"title": "t"},
             "people": [{"key": "x", "name": "X", "type": "Royalty", "born": 1100, "died": 1090}],
             "links": [{"parent": "nobody", "child": "x"}],
             "moments": [{"person": "x", "role": "died", "place": "atlantis"}]})]
    plan = intake.plan_files(intake.World(db), docs)
    text = " ".join(plan.errors)
    assert "died (1090) before born (1100)" in text and "unknown person `nobody`" in text and "unknown place `atlantis`" in text
    assert any("no source" in w for w in plan.warnings)

def test_person_image_fields():
    db = FakeDB(snapshot())
    docs = [("p.yaml", {"batch": {"title": "t"}, "sources": [{"key": "s", "title": "S"}], "people": [
        {"key": "pic-person", "name": "Pic Person", "type": "Artist", "born": 1600, "image_url": "https://x/a.jpg", "image_thumb": "https://x/t.jpg",
         "image_page": "https://commons/File:a.jpg", "image_license": "Public domain", "sources": ["s"]}]})]
    world = intake.World(db)
    plan = intake.plan_files(world, docs)
    assert not plan.errors, plan.errors
    intake.apply_files(world, docs, log=lambda m: None)
    r = [x for x in db.t["entities"] if x["key"] == "pic-person"][0]
    assert (r["image_url"], r["image_thumb"], r["image_license"]) == ("https://x/a.jpg", "https://x/t.jpg", "Public domain")

def test_artworks():
    db = FakeDB(snapshot())
    docs = [("a.yaml", {"batch": {"title": "t"}, "sources": [{"key": "s", "title": "S"}],
        "people": [{"key": "painter", "name": "Painter", "type": "Artist", "born": 1599, "portrait": "engraving", "sources": ["s"]},
                   {"key": "engraver", "name": "Engraver", "type": "Artist", "born": 1697, "sources": ["s"]},
                   {"key": "sitter", "name": "Sitter", "type": "Artist", "born": 1573, "sources": ["s"]}],
        "artworks": [
            {"key": "painting", "name": "Portrait of Sitter", "kind": "painting", "medium": "oil on canvas", "made": 1632,
             "collection": "Somewhere", "people": [{"person": "painter", "role": "creator"}, {"person": "sitter", "role": "subject"}],
             "places": [{"place": "westminster-abbey", "role": "held"}], "events": [{"event": "battle-of-hastings", "role": "depicts"}],
             "sources": ["s"]},
            {"key": "engraving", "name": "Portrait of Sitter (engraving)", "kind": "engraving", "made": 1743, "after": "painting",
             "image_url": "https://x/a.jpg", "image_page": "https://commons/File:a.jpg", "image_license": "Public domain",
             "people": [{"person": "engraver", "role": "creator"}, {"person": "sitter", "role": "subject"}], "sources": ["s"]}]})]
    world = intake.World(db)
    plan = intake.plan_files(world, docs)
    assert not plan.errors and not plan.warnings, (plan.errors, plan.warnings)
    assert plan.adds["artworks"] == ["painting", "engraving"]
    intake.apply_files(world, docs, log=lambda m: None)
    art = {r["key"]: r for r in db.t["artworks"]}
    assert art["painting"]["start_year"] == 1632 and art["painting"]["medium"] == "oil on canvas"
    assert art["engraving"]["derived_from_id"] == art["painting"]["id"] and art["engraving"]["image_license"] == "Public domain"
    ent = {r["key"]: r for r in db.t["entities"]}
    assert ent["painter"]["portrait_artwork_id"] == art["engraving"]["id"]
    assert sorted(r["role"] for r in db.t["artwork_people"] if r["artwork_id"] == art["painting"]["id"]) == ["creator", "subject"]
    assert len(db.t["artwork_places"]) == 1 and len(db.t["artwork_events"]) == 1
    assert any(l["record_type"] == "artwork" and l["record_key"] == "painting" for l in db.t["source_links"])
    n = len(db.t["artwork_people"]); intake.apply_files(intake.World(db), docs, log=lambda m: None)   # re-sending adds no duplicates
    assert len(db.t["artwork_people"]) == n and len(db.t["artworks"]) == 2
    bad = [("b.yaml", {"batch": {"title": "t"}, "artworks": [
        {"key": "x", "name": "X", "after": "nope", "people": [{"person": "ghost", "role": "creator"}], "sources": ["s"]},
        {"key": "y", "name": "Y", "made": 1700, "made_end": 1690, "people": [{"person": "ghost"}]}]})]
    errs = intake.plan_files(intake.World(FakeDB(snapshot())), bad).errors
    assert any("unknown artwork `nope`" in e for e in errs) and any("unknown person `ghost`" in e for e in errs)
    assert any("made_end" in e for e in errs) and any("needs a `role`" in e for e in errs)

def test_person_coverage():
    db = FakeDB(snapshot())
    docs = [("c.yaml", {"batch": {"title": "t"}, "sources": [{"key": "s", "title": "S"}], "people": [
        {"key": "c1", "name": "C1", "type": "Artist", "coverage": "partly", "coverage_note": "dates only", "sitelinks": 120, "sitelinks_on": "2026-10-10", "sources": ["s"]}]})]
    world = intake.World(db)
    plan = intake.plan_files(world, docs)
    assert not plan.errors and not plan.warnings, (plan.errors, plan.warnings)
    intake.apply_files(world, docs, log=lambda m: None)
    r = [x for x in db.t["entities"] if x["key"] == "c1"][0]
    assert (r["coverage"], r["coverage_note"], r["sitelinks"]) == ("partly", "dates only", 120)
    bad = [("d.yaml", {"batch": {"title": "t"}, "people": [{"key": "c1", "coverage": "done"}, {"key": "c1", "coverage": "partly"}]})]
    plan = intake.plan_files(intake.World(db), bad)
    assert any("coverage must be one of" in e for e in plan.errors) and any("without a `coverage_note`" in w for w in plan.warnings)

def test_museums():
    db = FakeDB(snapshot())
    docs = [("m.yaml", {"batch": {"title": "t"}, "sources": [{"key": "s", "title": "S"}],
        "museums": [{"key": "louvre", "name": "Louvre", "kind": "art museum", "city": "Paris", "country": "France", "lat": 48.861, "lng": 2.336,
                     "website": "https://www.louvre.fr", "founded": 1793, "data_access": "open-data-download", "data_licence": "Etalab", "data_checked_on": "2026-10-10",
                     "sources": ["s"]}],
        "people": [{"key": "pm", "name": "PM", "type": "Artist", "sources": ["s"]}],
        "artworks": [{"key": "work", "name": "Work", "museum": "louvre", "accession": "INV 1", "museum_url": "https://collections.louvre.fr/x",
                      "people": [{"person": "pm", "role": "creator"}], "sources": ["s"]}]})]
    world = intake.World(db)
    plan = intake.plan_files(world, docs)
    assert not plan.errors and not plan.warnings, (plan.errors, plan.warnings)
    intake.apply_files(world, docs, log=lambda m: None)
    mu = db.t["museums"][0]; aw = db.t["artworks"][0]
    assert (mu["modern_country"], mu["start_year"], mu["data_access"], mu["data_checked_on"]) == ("France", 1793, "open-data-download", "2026-10-10")
    assert aw["museum_id"] == mu["id"] and aw["accession_number"] == "INV 1" and aw["museum_url"].endswith("/x")
    assert any(l["record_type"] == "museum" and l["record_key"] == "louvre" for l in db.t["source_links"])
    bad = [("b.yaml", {"batch": {"title": "t"}, "museums": [{"key": "x", "name": "X", "data_access": "scrape-it"}],
                       "artworks": [{"key": "y", "name": "Y", "museum": "nowhere"}]})]
    errs = intake.plan_files(intake.World(FakeDB(snapshot())), bad).errors
    assert any("data_access must be one of" in e for e in errs) and any("unknown museum `nowhere`" in e for e in errs)

def test_place_dates_and_builders():
    db = FakeDB(snapshot())
    docs = [("p.yaml", {"batch": {"title": "t"}, "sources": [{"key": "s", "title": "S"}], "places": [
        {"key": "westminster-abbey", "founded": 960, "founded_estimated": True, "built_by": "Edward the Confessor", "architect": "Henry of Reyns", "city": "London", "sources": ["s"]},
        {"key": "new-castle", "name": "New Castle", "founded": "1100-05-01", "ended": 1650, "sources": ["s"]}]})]
    world = intake.World(db)
    plan = intake.plan_files(world, docs)
    assert not plan.errors, plan.errors
    intake.apply_files(world, docs, log=lambda m: None)
    pl = {r["key"]: r for r in db.t["places"]}
    wa = pl["westminster-abbey"]
    assert (wa["start_year"], wa["start_estimated"], wa["built_by"], wa["architect"]) == (960, True, "Edward the Confessor", "Henry of Reyns")
    assert wa["city"] == "London"
    assert wa["name"] == "Westminster Abbey" and "end_year" not in wa  # an update only touches the fields given
    assert (pl["new-castle"]["start_year"], pl["new-castle"]["end_year"]) == (1100, 1650)
    bad = [("b.yaml", {"batch": {"title": "t"}, "places": [{"key": "x", "name": "X", "founded": 1500, "ended": 1400}, {"key": "y", "name": "Y", "founded": "c. 900"}]})]
    text = " ".join(intake.plan_files(intake.World(db), bad).errors)
    assert "ended (1400) before founded (1500)" in text and "place `y` `founded`: `c. 900` is not a year" in text, text

def test_titles():
    db = FakeDB(snapshot())
    src = [{"key": "s", "title": "S"}]
    docs = [("t.yaml", {"batch": {"title": "t"}, "sources": src, "titles": [
        {"person": "william-i-of-england", "title": "King of England", "realm": "England", "from": "1066-12-25", "to": "1087-09-09", "sources": ["s"]},
        {"person": "william-i-of-england", "title": "Duke of Normandy", "realm": "Normandy", "from": 1035, "to": 1087, "sources": ["s"]}]})]
    world = intake.World(db)
    plan = intake.plan_files(world, docs)
    assert not plan.errors and all("no region" in w for w in plan.warnings), (plan.errors, plan.warnings)
    assert plan.adds["titles"] == ["william-i-of-england--king-of-england--1066", "william-i-of-england--duke-of-normandy--1035"]
    intake.apply_files(world, docs, log=lambda m: None)
    t = {r["key"]: r for r in db.t["titles"]}["william-i-of-england--king-of-england--1066"]
    assert (t["start_year"], t["start_date"], t["end_year"], t["realm"]) == (1066, "1066-12-25", 1087, "England")
    assert any(l["record_type"] == "title" for l in db.t["source_links"])
    # Re-sending updates rather than duplicating.
    plan2 = intake.plan_files(intake.World(db), docs)
    assert not plan2.adds["titles"] and len(plan2.updates["titles"]) == 2
    bad = [("b.yaml", {"batch": {"title": "t"}, "titles": [
        {"person": "william-i-of-england", "title": "King of England", "realm": "England", "from": 1090, "to": 1080},
        {"person": "william-i-of-england", "title": "Count of Nowhere", "realm": "Nowhere", "from": 1000},
        {"person": "nobody", "title": "X", "realm": "Y"},
        {"person": "william-i-of-england", "from": 1050}]})]
    p3 = intake.plan_files(intake.World(db), bad)
    text = " ".join(p3.errors) + " | " + " ".join(p3.warnings)
    assert "ended (1080) before it began (1090)" in text and "unknown person `nobody`" in text, text
    assert "need `title` and `realm`" in text and "starts (1000) before william-i-of-england was born (1028)" in text, text

def test_realms():
    db = FakeDB(snapshot())
    src = [{"key": "s", "title": "S"}]
    docs = [("r.yaml", {"batch": {"title": "t"}, "sources": src,
             "realms": [{"name": "England", "region": "Western Europe", "country": "United Kingdom"}],
             "titles": [{"person": "william-i-of-england", "title": "King of England", "realm": "England", "from": 1066, "to": 1087, "sources": ["s"]},
                        {"person": "william-i-of-england", "title": "Duke of Normandy", "realm": "Normandy", "from": 1035, "to": 1087, "sources": ["s"]}]})]
    world = intake.World(db)
    plan = intake.plan_files(world, docs)
    assert not plan.errors, plan.errors
    assert plan.adds["realms"] == ["england"]
    assert [w for w in plan.warnings if "Normandy" in w and "no region" in w] and not [w for w in plan.warnings if "“England”" in w], plan.warnings
    intake.apply_files(world, docs, log=lambda m: None)
    r = db.t["realms"][0]
    assert (r["key"], r["name"], r["region"], r["modern_country"]) == ("england", "England", "Western Europe", "United Kingdom")
    bad = intake.plan_files(intake.World(db), [("b.yaml", {"batch": {"title": "t"}, "realms": [{"name": "Atlantis", "region": "Undersea"}, {"name": "Mu"}]})])
    text = " ".join(bad.errors)
    assert "region must be one of" in text and "new realms need `name` and `region`" in text, text

def test_restdb_reads_every_page():
    # Supabase caps a request at 1,000 rows; select must keep reading until a page comes back short.
    rows = [{"id": i} for i in range(1, 2501)]
    calls = []
    class Resp:
        def __init__(self, data): self.status_code, self._data, self.text = 200, data, ""
        def json(self): return self._data
    class FakeRequests:
        @staticmethod
        def get(url, headers=None, params=None, timeout=None):
            calls.append(params)
            o, n = params["offset"], params["limit"]
            return Resp(rows[o:o + n])
    real = intake.requests
    intake.requests = FakeRequests
    try:
        got = intake.RestDB("https://example.supabase.co", "sb_test").select("source_links", "id")
    finally:
        intake.requests = real
    assert len(got) == 2500 and got[-1]["id"] == 2500, len(got)
    assert [c["offset"] for c in calls] == [0, 1000, 2000] and all(c["order"] == "id" for c in calls), calls

def test_bad_dates_are_errors_not_crashes():
    assert intake.parse_when(-384) == (-384, None) and intake.parse_when("-384") == (-384, None)
    assert intake.parse_when("1120-11-25") == (1120, "1120-11-25")
    assert intake.parse_when("988-05-19") == (988, "0988-05-19")  # pre-1000 full dates need no zero-padding
    db = FakeDB(snapshot())
    docs = [("bad.yaml", {"batch": {"title": "t"},
             "people": [{"key": "caesar", "name": "Julius Caesar", "type": "Royalty", "born": -100, "died": "-0044-03-15"},
                        {"key": "y0", "name": "Y", "type": "Scholar", "born": 0}],
             "events": [{"key": "ides", "name": "Ides", "type": "Assassination", "date": "-0044-03-15"},
                        {"key": "typo", "name": "T", "type": "Battle", "date": "1066-13-40"}],
             "moments": [{"person": "caesar", "role": "died", "place": "jerusalem", "year": "c. 44"}]})]
    plan = intake.plan_files(intake.World(db), docs)
    text = " ".join(plan.errors)
    assert "person `caesar` `died`" in text and "use the year alone (`-44`)" in text, text
    assert "event `ides` `date`" in text and "there is no year 0" in text, text
    assert "`1066-13-40` is not a year" in text and "`c. 44` is not a year" in text, text

def test_discrepancies_are_stored_and_surfaced():
    db = FakeDB(snapshot())
    src = [{"key": "a", "title": "A"}, {"key": "b", "title": "B"}]
    first = [("d.yaml", {"batch": {"title": "t"}, "sources": src, "discrepancies": [
        {"key": "henry-birth", "question": "When was Henry I born?", "about": [{"person": "henry-i-of-england"}], "field": "born",
         "claims": [{"value": 1068, "sources": ["a"]}, {"value": 1069, "sources": ["b"]}]}]})]
    world = intake.World(db)
    plan = intake.plan_files(world, first)
    assert not plan.errors and plan.adds["discrepancies"] == ["henry-birth"], (plan.errors, plan.adds)
    intake.apply_files(world, first, log=lambda m: None)
    assert db.t["discrepancies"][0]["status"] == "open" and db.t["discrepancies"][0]["about"] == [{"person": "henry-i-of-england"}]
    # A later batch that touches Henry I (here, via an event) is shown the open discrepancy.
    later = [("e.yaml", {"batch": {"title": "t2"}, "sources": src, "events": [
        {"key": "x-event", "name": "X", "type": "Battle", "year": 1100, "sources": ["a"], "people": [{"person": "henry-i-of-england"}]}]})]
    plan2 = intake.plan_files(intake.World(db), later)
    assert [d["key"] for _, d in plan2.open_discrepancies] == ["henry-birth"]
    assert "When was Henry I born?" in intake.render(plan2, ["e.yaml"])
    # Resolving it in a batch stops the flag.
    resolved = [("r.yaml", {"batch": {"title": "t3"}, "discrepancies": [{"key": "henry-birth", "question": "When was Henry I born?",
                "about": [{"person": "henry-i-of-england"}], "status": "resolved", "resolution": "1068: most sources"}]})]
    w3 = intake.World(db); intake.apply_files(w3, resolved, log=lambda m: None)
    assert not intake.plan_files(intake.World(db), later).open_discrepancies
    # Unknown sections are an error, not silently ignored; so is using discrepancies before sql/005.
    plan4 = intake.plan_files(intake.World(db), [("u.yaml", {"batch": {"title": "t"}, "disputes": []})])
    assert any("unknown section `disputes`" in e for e in plan4.errors)
    del db.t["discrepancies"]
    db.select = (lambda orig: lambda t, *a, **k: (_ for _ in ()).throw(RuntimeError("missing")) if t == "discrepancies" else orig(t, *a, **k))(db.select)
    plan5 = intake.plan_files(intake.World(db), first)
    assert any("run sql/005" in e for e in plan5.errors)

def test_external_links():
    db = FakeDB(snapshot()); world = intake.World(db)
    doc = {"batch": {"title": "t"}, "sources": [{"key": "s", "title": "S"}],
           "artworks": [{"key": "die-hard-1988", "name": "Die Hard", "kind": "film", "sources": ["s"],
                         "external": [{"system": "entertainment", "id": "tt0095016", "url": "https://example.org/tt0095016"}]}]}
    plan = intake.plan_files(world, [("a.yaml", doc)])
    assert not plan.errors, plan.errors
    assert plan.adds["external"] == ["artwork die-hard-1988 → entertainment"]
    intake.apply_files(world, [("a.yaml", doc)], log=lambda m: None)
    rows = db.t["external_links"]
    assert len(rows) == 1 and rows[0]["record_type"] == "artwork" and rows[0]["external_id"] == "tt0095016"
    # Re-sending updates the one link instead of adding a second.
    doc["artworks"][0]["external"][0]["url"] = "https://example.org/new"
    world = intake.World(db)
    plan = intake.plan_files(world, [("a.yaml", doc)])
    assert plan.updates["external"] == ["artwork die-hard-1988 → entertainment"]
    intake.apply_files(world, [("a.yaml", doc)], log=lambda m: None)
    assert len(db.t["external_links"]) == 1 and db.t["external_links"][0]["url"] == "https://example.org/new"
    bad = {"batch": {"title": "t"}, "places": [{"key": "p", "name": "P", "lat": 1, "lng": 1,
           "external": [{"system": "restaurants"}, {"id": "x"}, {"system": "a", "id": "1"}, {"system": "a", "id": "2"}]}]}
    errs = intake.plan_files(intake.World(db), [("b.yaml", bad)]).errors
    assert sum("needs `system` and an `id` or `url`" in e for e in errs) == 2 and any("`a` listed twice" in e for e in errs)

if __name__ == "__main__":
    test_example_plans_and_applies(); test_errors_are_caught(); test_bad_dates_are_errors_not_crashes(); test_restdb_reads_every_page(); test_person_image_fields(); test_artworks(); test_person_coverage(); test_museums(); test_place_dates_and_builders(); test_titles(); test_realms(); test_discrepancies_are_stored_and_surfaced(); test_external_links(); print("\nALL TESTS PASSED")
