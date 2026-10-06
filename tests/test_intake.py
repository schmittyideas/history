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
                  "sources": [], "source_links": [], "learning_log": [], "learning_log_items": []}
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

if __name__ == "__main__":
    test_example_plans_and_applies(); test_errors_are_caught(); print("\nALL TESTS PASSED")
