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
                  "sources": [], "source_links": [], "learning_log": [], "learning_log_items": [], "discrepancies": [], "titles": [], "realms": []}
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

def test_place_dates_and_builders():
    db = FakeDB(snapshot())
    docs = [("p.yaml", {"batch": {"title": "t"}, "sources": [{"key": "s", "title": "S"}], "places": [
        {"key": "westminster-abbey", "founded": 960, "founded_estimated": True, "built_by": "Edward the Confessor", "architect": "Henry of Reyns", "sources": ["s"]},
        {"key": "new-castle", "name": "New Castle", "founded": "1100-05-01", "ended": 1650, "sources": ["s"]}]})]
    world = intake.World(db)
    plan = intake.plan_files(world, docs)
    assert not plan.errors, plan.errors
    intake.apply_files(world, docs, log=lambda m: None)
    pl = {r["key"]: r for r in db.t["places"]}
    wa = pl["westminster-abbey"]
    assert (wa["start_year"], wa["start_estimated"], wa["built_by"], wa["architect"]) == (960, True, "Edward the Confessor", "Henry of Reyns")
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

if __name__ == "__main__":
    test_example_plans_and_applies(); test_errors_are_caught(); test_bad_dates_are_errors_not_crashes(); test_place_dates_and_builders(); test_titles(); test_realms(); test_discrepancies_are_stored_and_surfaced(); print("\nALL TESTS PASSED")
