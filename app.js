/* History Timeline viewer.
   Reads the History Project database (live via Supabase, or the bundled snapshot),
   turns a plain-language request into filters, and draws lanes of lifespans with
   time running down the page. */
(() => {
"use strict";

const NS = "http://www.w3.org/2000/svg";
const $ = id => document.getElementById(id);
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};
const h = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const k in props) {
    if (k === "class") n.className = props[k];
    else if (k === "text") n.textContent = props[k];
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), props[k]);
    else if (props[k] !== undefined && props[k] !== null) n.setAttribute(k, props[k]);
  }
  kids.flat().forEach(c => { if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return n;
};
const store = {
  get(k, d) { try { const v = localStorage.getItem("ht:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("ht:" + k, JSON.stringify(v)); } catch (e) {} }
};
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = iso => { if (!iso) return null; const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
// Years are whole numbers; BC is negative (-384 = 384 BC). There is no year 0, so 0 marks the BC/AD boundary.
const fmtYear = y => y == null ? null : y < 0 ? `${-y} BC` : y === 0 ? "BC/AD" : `${y}`;
const fmtSpan = (a, b) => a == null || b == null || b >= 0 && a >= 0 ? `${fmtYear(a) ?? "?"}–${fmtYear(b) ?? "?"}`
  : b < 0 ? `${-a}–${-b} BC` : `${-a} BC–AD ${Math.max(1, b)}`;
const yearsBetween = (a, b) => b - a - (a < 0 && b > 0 ? 1 : 0);
const byYear = (a, b) => (a ?? Infinity) - (b ?? Infinity) || 0;  // unknown years last
// Years written so parseQuery reads them back: "384 BC", "AD 14", "1066".
const yearQuery = (y, ad = false) => y < 0 ? `${-y} BC` : ad || y < 100 ? `AD ${Math.max(1, y)}` : `${y}`;
const rangeQuery = (a, b) => a === b ? yearQuery(a) : `${yearQuery(a)} to ${yearQuery(b, a < 0)}`;
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ------------------------------------------------------------------ data */

const TABLES = ["entities", "relationships", "events", "event_people", "places", "person_places"];

async function loadData() {
  const c = window.HISTORY_CONFIG || {};
  if (c.supabaseUrl && c.publishableKey) {
    const headers = { apikey: c.publishableKey };
    if (!c.publishableKey.startsWith("sb_")) headers.Authorization = `Bearer ${c.publishableKey}`;
    // Supabase returns at most 1,000 rows per request, so read each table in pages, in id order, until a page
    // comes back short. (Reading only the first page once hid most sources: source_links had 2,490 rows.)
    const PAGE = 1000;
    const getAll = async t => {
      const out = [];
      for (let offset = 0; ; offset += PAGE) {
        const r = await fetch(`${c.supabaseUrl}/rest/v1/${t}?select=*&order=id&limit=${PAGE}&offset=${offset}`, { headers });
        if (!r.ok) throw new Error(`${t}: HTTP ${r.status}`);
        const rows = await r.json();
        out.push(...rows);
        if (rows.length < PAGE) return out;
      }
    };
    try {
      const rows = await Promise.all(TABLES.map(getAll));
      const raw = Object.fromEntries(TABLES.map((t, i) => [t, rows[i]]));
      if (!raw.entities.length) throw new Error("no rows returned (check read policies)");
      // Titles (sql/007) are optional: without them the Year view just has no rulers to show.
      const optional = t => getAll(t).catch(() => []);
      [raw.titles, raw.realms, raw.sources, raw.source_links, raw.artworks, raw.artwork_people] = await Promise.all(
        ["titles", "realms", "sources", "source_links", "artworks", "artwork_people"].map(optional));
      return { source: "live", raw };
    } catch (e) {
      return { source: "snapshot", raw: window.HISTORY_SNAPSHOT || {}, error: e.message };
    }
  }
  return { source: "snapshot", raw: window.HISTORY_SNAPSHOT || {}, error: c.supabaseUrl ? "no publishable key in config.js" : null };
}

function indexData(raw) {
  const people = raw.entities || [], rels = raw.relationships || [], events = raw.events || [];
  const ep = raw.event_people || [], places = raw.places || [], pp = raw.person_places || [], titles = raw.titles || [];
  const byId = Object.fromEntries(people.map(p => [p.id, p]));
  const eventById = Object.fromEntries(events.map(e => [e.id, e]));
  const placeById = Object.fromEntries(places.map(p => [p.id, p]));
  const parentLinks = rels.filter(r => r.rel_type === "parent");
  const spouseLinks = rels.filter(r => r.rel_type === "spouse");
  const parentsOf = id => parentLinks.filter(r => r.target_id === id).map(r => byId[r.source_id]).filter(Boolean);
  const childrenOf = id => parentLinks.filter(r => r.source_id === id).map(r => byId[r.target_id]).filter(Boolean)
    .sort((a, b) => byYear(a.birth_year, b.birth_year));
  const spousesOf = id => spouseLinks.filter(r => r.source_id === id || r.target_id === id)
    .map(r => ({ person: byId[r.source_id === id ? r.target_id : r.source_id], year: r.start_year }))
    .filter(s => s.person).sort((a, b) => byYear(a.year, b.year));
  const marriedIn = new Set(spouseLinks.map(r => r.target_id).filter(id => parentsOf(id).length === 0));
  const marriageYear = id => { const r = spouseLinks.find(r => r.target_id === id); return r ? r.start_year : null; };
  const startOf = p => p.birth_year ?? marriageYear(p.id) ?? p.death_year;
  const endOf = p => p.death_year ?? startOf(p);
  const eventsOf = id => ep.filter(x => x.entity_id === id).map(x => ({ event: eventById[x.event_id], role: x.role })).filter(x => x.event);
  const peopleInEvent = evId => ep.filter(x => x.event_id === evId).map(x => ({ person: byId[x.entity_id], role: x.role })).filter(x => x.person);
  const placesOfPerson = id => [
    ...pp.filter(x => x.entity_id === id).map(x => placeById[x.place_id]),
    ...eventsOf(id).map(x => placeById[x.event.place_id])
  ].filter(Boolean);
  const neighbours = id => [...parentsOf(id), ...childrenOf(id), ...spousesOf(id).map(s => s.person)];
  // What happened at a place: events held there, and life moments (born, buried, ...) recorded there.
  const eventsAt = id => events.filter(e => e.place_id === id);
  const momentsAt = id => pp.filter(x => x.place_id === id).map(x => ({ person: byId[x.entity_id], role: x.role, year: x.year })).filter(x => x.person);
  return { people, rels, events, ep, places, pp, byId, eventById, placeById, parentLinks, spouseLinks,
    parentsOf, childrenOf, spousesOf, marriedIn, marriageYear, startOf, endOf, eventsOf, peopleInEvent, placesOfPerson, neighbours,
    eventsAt, momentsAt, titles,
    regionOf: Object.fromEntries((raw.realms || []).map(r => [r.name, r.region])),
    countryOf: Object.fromEntries((raw.realms || []).map(r => [r.name, r.modern_country])),
    // Every realm a title names (England, Byzantine Empire, Kievan Rus'), for searching and focusing.
    realmNames: [...new Set([...titles.map(t => t.realm), ...(raw.realms || []).map(r => r.name)])].filter(Boolean),
    titlesOf: id => titles.filter(t => t.entity_id === id).sort((a, b) => byYear(a.start_year, b.start_year)),
    // Artworks a person made (artwork_people role "creator").
    worksBy: id => {
      const byId = Object.fromEntries((raw.artworks || []).map(w => [w.id, w]));
      return (raw.artwork_people || []).filter(x => x.entity_id === id && x.role === "creator").map(x => byId[x.artwork_id]).filter(Boolean);
    },
    // Where a record's facts come from (usually its Wikipedia article): record type + key -> sources.
    sourcesFor: (type, key) => {
      const byId = Object.fromEntries((raw.sources || []).map(s => [s.id, s]));
      return (raw.source_links || []).filter(l => l.record_type === type && l.record_key === key).map(l => byId[l.source_id]).filter(Boolean);
    } };
}

/* ------------------------------------------------------------------ request parsing */

const TYPE_WORDS = [
  [/\b(rulers?|rules|reign(?:s|ing)?|kings?|queens?|monarchs?|royal(?:ty|s)?|emperors?|empress(?:es)?|crowns?)\b/gi, "Royalty"],
  [/\b(nobles?|nobility|dukes?|duchess(?:es)?|counts?|countess(?:es)?|earls?|barons?|lords?)\b/gi, "Nobility"],
  [/\b(popes?|papacy|cardinals?|bishops?|clergy|church(?:men)?)\b/gi, "Clergy"],
  [/\b(painters?|artists?|sculptors?|architects?)\b/gi, "Artist"],
  [/\b(writers?|poets?|playwrights?|novelists?|authors?)\b/gi, "Writer"],
  [/\b(composers?|musicians?)\b/gi, "Composer"],
  [/\b(inventors?|scientists?|philosophers?)\b/gi, "Scholar"],
];
const TYPE_LABEL = { Royalty: "royalty", Nobility: "nobility", Clergy: "popes and clergy", Artist: "painters and artists", Writer: "writers", Composer: "composers", Scholar: "scholars and inventors" };
// Who to show: the groups behind the buttons under the title. A person shows if any group they belong to is on.
// Architects are a role, not a type (Wren is typed Artist), so groups match roles as well as types.
const hasRole = (p, re) => (p.roles || []).some(r => re.test(r));
// Artists are those with an artistic role (an Artist-typed astronomer-architect like Wren is an architect, not an artist).
const ARCHITECT = /architect/i, ART_ROLE = /paint|miniatur|engrav|etch|sculpt|carv|goldsmith|illustrat|draughts|print|(?<!landscape )designer/i;
const CATS = [
  // Each group has a colour: its button and the lifespan bars of its people share it, so the buttons are the colour key.
  { key: "royalty", label: "Royalty", color: "var(--woad)", test: p => p.type === "Royalty" },
  { key: "nobility", label: "Nobility", color: "var(--weld)", test: p => p.type === "Nobility" },
  { key: "clergy", label: "Clergy", color: "var(--stitch)", test: p => p.type === "Clergy" },
  { key: "artists", label: "Artists", color: "var(--ochre)", test: p => p.type === "Artist" && (!(p.roles || []).length || hasRole(p, ART_ROLE)) },
  { key: "architects", label: "Architects", color: "var(--walnut)", test: p => hasRole(p, ARCHITECT) },
  { key: "writers", label: "Writers", color: "var(--lichen)", test: p => p.type === "Writer" },
  { key: "composers", label: "Composers", color: "var(--rose)", test: p => p.type === "Composer" },
  { key: "scholars", label: "Scholars", color: "var(--slate)", test: p => p.type === "Scholar" },
];
const catsOf = p => { const ks = CATS.filter(c => c.test(p)).map(c => c.key); return ks.length ? ks : ["other"]; };
const catsFiltering = () => S.catsOff.size > 0;
const catOn = p => !!p && catsOf(p).some(k => !S.catsOff.has(k));
// An event stays if it has nobody attached, or anyone in it is shown.
const eventCatOn = (db, e) => { const ppl = db.peopleInEvent(e.id); return !ppl.length || ppl.some(x => catOn(x.person)); };
const COMMON_REGIONS = ["italy","france","england","spain","germany","scotland","wales","ireland","normandy","flanders","rome","venice","florence","milan","naples","sicily","papal states","portugal","netherlands","austria","burgundy","aquitaine","brittany","london","paris","jerusalem","byzantium","constantinople","holy roman empire"];
const STOP = new Set("a an and or the of in on at to for from with who were was is are during time times all show me see view overlap overlapping between era period age around circa c about people persons".split(" "));

function parseQuery(text, db) {
  const f = { raw: text, from: null, to: null, types: new Set(), regions: [], missingRegions: [], realms: [], focus: null, ignored: [] };
  let t = " " + text.replace(/[’']/g, "'") + " ";
  let m;
  // Era markers: "384 BC", "AD 14", "4th century BC", "400–300 BC". Plain numbers are AD.
  const ERA = String.raw`(BCE|BC|B\.C\.E\.|B\.C\.|CE|AD|C\.E\.|A\.D\.)(?!\w)`;
  const isBC = e => !!e && /^b/i.test(e);
  const SEP = String.raw`\s*(?:-|–|—|to|until|through|and)\s*`;
  const sign = (n, bc) => bc ? -n : n;
  if ((m = t.match(new RegExp(String.raw`(?:\b(AD|A\.D\.)\s*)?\b(\d{1,4})(?:\s*${ERA})?${SEP}(?:\b(AD|A\.D\.)\s*)?(\d{1,4})(?:\s*${ERA})?(?!\d)`, "i")))
      && (m[1] || m[3] || m[4] || m[6] || (m[2].length >= 3 && m[5].length >= 2))) {
    let a = +m[2], b = +m[5];
    if (!m[1] && !m[3] && !m[4] && !m[6] && b < 100) b = Math.floor(a / 100) * 100 + b;   // "1066-87"
    const aBC = isBC(m[3]) || (!m[1] && !m[3] && isBC(m[6]));                         // "400–300 BC"
    const bBC = isBC(m[6]) || (!m[4] && !m[6] && aBC && b < a);                       // "400 BC–300"
    a = sign(a, aBC); b = sign(b, bBC);
    f.from = Math.min(a, b); f.to = Math.max(a, b); t = t.replace(m[0], " ");
  } else if ((m = t.match(new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)\s*(?:century|cent\.?|c\.)(?:\s*${ERA})?`, "i")))) {
    const n = +m[1];
    if (isBC(m[2])) { f.from = -n * 100; f.to = -(n - 1) * 100 - 1; } else { f.from = (n - 1) * 100; f.to = n * 100 - 1; }
    t = t.replace(m[0], " ");
  } else if ((m = t.match(new RegExp(String.raw`\b(\d{1,2})00s\b(?:\s*${ERA})?`, "i")))) {
    const n = +m[1];
    if (isBC(m[2])) { f.from = -(n * 100 + 99); f.to = -n * 100; } else { f.from = n * 100; f.to = n * 100 + 99; }
    t = t.replace(m[0], " ");
  } else if ((m = t.match(new RegExp(String.raw`\b(\d{2,3})0s\b(?:\s*${ERA})?`, "i")))) {
    const d = +m[1];
    if (isBC(m[2])) { f.from = -(d * 10 + 9); f.to = -d * 10; } else { f.from = d * 10; f.to = d * 10 + 9; }
    t = t.replace(m[0], " ");
  } else if ((m = t.match(new RegExp(String.raw`\b(around|circa|c\.|about)?\s*(?:\b(?:AD|A\.D\.)\s*(\d{1,4})\b|\b(\d{1,4})\s*${ERA}|\b(\d{3,4})\b)`, "i")))) {
    const y = m[2] ? +m[2] : m[3] ? sign(+m[3], isBC(m[4])) : +m[5];
    if (m[1]) { f.from = y - 25; f.to = y + 25; } else { f.from = y; f.to = y; }
    t = t.replace(m[0], " ");
  }

  for (const [re, type] of TYPE_WORDS) {
    if (re.test(t)) { f.types.add(type); t = t.replace(re, " "); }
    re.lastIndex = 0;
  }

  // People named in the request (longest names first so "Henry I" doesn't swallow "Henry II").
  const names = [];
  db.people.forEach(p => { names.push([p.name, p.id]); if (p.obsidian_link && p.obsidian_link !== p.name) names.push([p.obsidian_link, p.id]); });
  names.sort((a, b) => b[0].length - a[0].length);
  for (const [name, id] of names) {
    const re = new RegExp(`(^|[^\\w])${esc(name)}(?![\\w])`, "i");
    if (re.test(t)) { f.focus = id; t = t.replace(re, " "); break; }
  }

  // Realms: anything a title rules ("Byzantine Empire", "France", "Kievan Rus'"), longest first. A realm that is
  // also a place name (England) counts as both, so its rulers and the people with places there all match.
  const known = new Map();
  db.places.forEach(p => [p.name, p.historical_name, p.region, p.modern_country].forEach(v => { if (v && v.length > 2) known.set(v.toLowerCase(), v); }));
  for (const r of (db.realmNames || []).slice().sort((x, y) => y.length - x.length)) {
    const re = new RegExp(`(^|[^\\w])${esc(r)}(?![\\w])`, "i");
    if (re.test(t)) {
      f.realms.push(r);
      if (known.has(r.toLowerCase())) f.regions.push(known.get(r.toLowerCase()));
      t = t.replace(re, " ");
    }
  }

  // Regions: anything the places table knows, plus common region names.
  const candidates = [...new Set([...known.keys(), ...COMMON_REGIONS])].sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    const re = new RegExp(`(^|[^\\w])${esc(c)}(?![\\w])`, "i");
    if (re.test(t)) {
      if (known.has(c)) f.regions.push(known.get(c)); else f.missingRegions.push(cap(c));
      t = t.replace(re, " ");
    }
  }

  f.ignored = t.split(/[^\w]+/).filter(w => w && !STOP.has(w.toLowerCase()) && !/^\d+$/.test(w));
  return f;
}

function isEmptyFilter(f) {
  return f.from == null && !f.types.size && !f.regions.length && !f.missingRegions.length && !f.realms.length && f.focus == null;
}

/* ------------------------------------------------------------------ filtering */

function familyWithin(db, id, steps) {
  const seen = new Set([id]); let frontier = [id];
  for (let i = 0; i < steps; i++) {
    const next = [];
    frontier.forEach(x => db.neighbours(x).forEach(n => { if (!seen.has(n.id)) { seen.add(n.id); next.push(n.id); } }));
    frontier = next;
  }
  return seen;
}

function placeMatches(place, regions) {
  if (!place) return false;
  const vals = [place.name, place.historical_name, place.region, place.modern_country].filter(Boolean).map(v => v.toLowerCase());
  return regions.some(r => vals.includes(r.toLowerCase()));
}

function computeView(db, f) {
  const warnings = [];
  let people = db.people.slice();
  if (f.focus != null) {
    const fam = familyWithin(db, f.focus, 2);
    people = people.filter(p => fam.has(p.id));
  }
  if (f.types.size) {
    f.types.forEach(t => { if (!db.people.some(p => p.type === t || (p.roles || []).includes(t))) warnings.push(`No ${TYPE_LABEL[t] || t} in the database yet`); });
    people = people.filter(p => f.types.has(p.type) || (p.roles || []).some(r => f.types.has(r)));
  }
  if (f.from != null) {
    people = people.filter(p => {
      const s = db.startOf(p), e = db.endOf(p);
      if (s == null && e == null) return true;
      return (s ?? e) <= f.to && (e ?? s) >= f.from;
    });
  }
  if (f.missingRegions.length) warnings.push(`No places recorded yet for ${f.missingRegions.join(", ")}`);
  if (f.regions.length || f.missingRegions.length || f.realms.length) {
    const pool = new Set(people.map(p => p.id));
    const ruled = p => db.titlesOf(p.id).some(t => f.realms.includes(t.realm) && (f.from == null || overlaps(t.start_year, t.end_year, f.from, f.to)));
    const hit = new Set(people.filter(p => (f.regions.length && db.placesOfPerson(p.id).some(pl => placeMatches(pl, f.regions))) || (f.realms.length && ruled(p))).map(p => p.id));
    // Include close family of matched people, so sparse place data doesn't hide relatives.
    [...hit].forEach(id => db.neighbours(id).forEach(n => { if (pool.has(n.id)) hit.add(n.id); }));
    people = people.filter(p => hit.has(p.id));
  }
  if (catsFiltering()) people = people.filter(catOn);
  const shown = new Set(people.map(p => p.id));
  let events = db.events.filter(e => Number.isFinite(e.start_year));
  if (catsFiltering()) events = events.filter(e => { const ppl = db.peopleInEvent(e.id); return !ppl.length || ppl.some(x => shown.has(x.person.id)); });
  if (f.from != null) events = events.filter(e => e.start_year <= f.to && (e.end_year ?? e.start_year) >= f.from);
  if (f.regions.length || f.missingRegions.length || f.realms.length) events = events.filter(e => placeMatches(db.placeById[e.place_id], f.regions) || db.peopleInEvent(e.id).some(x => shown.has(x.person.id)));
  if (f.focus != null || f.types.size) events = events.filter(e => db.peopleInEvent(e.id).some(x => shown.has(x.person.id)));
  return { people, events, warnings };
}

/* ------------------------------------------------------------------ lanes */

const TYPE_ORDER = ["Royalty", "Nobility", "Clergy", "Artist", "Writer", "Composer", "Scholar"];

function familyOrder(db, members, ids) {
  const order = [], seen = new Set();
  const visit = p => {
    if (!p || seen.has(p.id) || !ids.has(p.id)) return;
    seen.add(p.id); order.push(p);
    if (S.layers.spouses) db.spousesOf(p.id).forEach(s => {
      if (db.marriedIn.has(s.person.id) && ids.has(s.person.id) && !seen.has(s.person.id)) { seen.add(s.person.id); order.push(s.person); }
    });
    db.childrenOf(p.id).forEach(visit);
  };
  members.filter(p => !db.marriedIn.has(p.id) && !db.parentsOf(p.id).some(x => ids.has(x.id)))
    .sort((a, b) => byYear(db.startOf(a), db.startOf(b))).forEach(visit);
  members.slice().sort((a, b) => byYear(db.startOf(a), db.startOf(b))).forEach(p => {
    if (!seen.has(p.id)) { seen.add(p.id); order.push(p); }
  });
  return order;
}

function buildLanes(db, people) {
  let list = people;
  if (!S.layers.spouses) list = list.filter(p => !db.marriedIn.has(p.id));
  const ids = new Set(list.map(p => p.id));
  if (S.group === "type") {
    const groups = new Map();
    list.forEach(p => { const k = p.type || "Other"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
    return [...groups.entries()]
      .sort((a, b) => (TYPE_ORDER.indexOf(a[0]) + 1 || 99) - (TYPE_ORDER.indexOf(b[0]) + 1 || 99))
      .map(([k, members]) => ({ label: k, people: members.slice().sort((a, b) => byYear(db.startOf(a), db.startOf(b))) }));
  }
  // Family lanes: connected groups through parent and spouse links.
  const parent = new Map(list.map(p => [p.id, p.id]));
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const unite = (a, b) => { if (ids.has(a) && ids.has(b)) parent.set(find(a), find(b)); };
  db.parentLinks.forEach(r => unite(r.source_id, r.target_id));
  db.spouseLinks.forEach(r => unite(r.source_id, r.target_id));
  const comps = new Map();
  list.forEach(p => { const r = find(p.id); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(p); });
  const lanes = [], loners = [];
  comps.forEach(members => { if (members.length > 1) lanes.push(members); else loners.push(members[0]); });
  lanes.sort((a, b) => Math.min(...a.map(p => db.startOf(p) ?? 9999)) - Math.min(...b.map(p => db.startOf(p) ?? 9999)));
  const out = lanes.map(members => {
    const order = familyOrder(db, members, ids);
    return { label: `Family of ${order[0].name}`, people: order };
  });
  if (loners.length) out.push({ label: lanes.length ? "Others in this period" : "People", people: loners.sort((a, b) => byYear(db.startOf(a), db.startOf(b))) });
  return out;
}

/* ------------------------------------------------------------------ state */

const ZOOMS = [
  { name: "Era",         px: 1.2, col: 30,  bar: 8,  names: "none"  },
  { name: "Centuries",   px: 2.6, col: 60,  bar: 10, names: "short" },
  { name: "Generations", px: 6,   col: 112, bar: 14, names: "full"  },
  { name: "Lifetime",    px: 11,  col: 150, bar: 16, names: "full"  },
];

const S = {
  db: null, source: null,
  query: "", filter: null, view: null,
  group: store.get("group", "family"),
  layers: { spouses: store.get("spouses", true), events: store.get("events", true) },
  zoom: 2, zoomAuto: true,
  selected: null, mapMode: "selected", catsOff: new Set(store.get("catsOff", [])),
  trail: [], layout: null,
};

/* ------------------------------------------------------------------ run a request */

function run(query, { pushTrail = false, keepZoom = false } = {}) {
  if (pushTrail && S.query !== query) { S.trail.push(S.query); if (S.trail.length > 8) S.trail.shift(); }
  S.query = query;
  $("q").value = query;
  S.filter = parseQuery(query, S.db);
  S.view = computeView(S.db, S.filter);
  if (!keepZoom) {
    const ps = S.view.people;
    const ends = ps.map(S.db.endOf).filter(Number.isFinite), starts = ps.map(S.db.startOf).filter(Number.isFinite);
    const span = starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : 100;
    S.zoom = span > 700 ? 0 : span > 300 ? 1 : 2;
  }
  try { history.replaceState(null, "", query ? "?q=" + encodeURIComponent(query) : location.pathname); } catch (e) {}
  renderChips();
  renderTrail();
  render();
  const chart = $("chart");
  chart.scrollLeft = 0; chart.scrollTop = 0;
  if (S.filter.focus != null && S.layout?.xOf[S.filter.focus] != null) select(S.filter.focus);
  else if (S.filter.focus == null && S.filter.regions.length === 1) {
    // A request naming one place ("Westminster Abbey") opens that place, not just the people tied to it.
    const pl = S.db.places.find(p => p.name.toLowerCase() === S.filter.regions[0].toLowerCase());
    if (pl) selectPlace(pl.id);
  }
  updateOverviewWindow();
}

function renderChips() {
  const box = $("chips"); box.innerHTML = "";
  const f = S.filter;
  if (isEmptyFilter(f)) { box.append(h("span", { class: "lbl", text: "Showing" }), h("span", { class: "chip" }, h("b", { text: "Everything in the database" }))); return; }
  box.append(h("span", { class: "lbl", text: "Understood" }));
  const chip = (label, value, onRemove) => h("span", { class: "chip" }, label ? `${label}: ` : "", h("b", { text: value }),
    h("button", { type: "button", "aria-label": `Remove ${value}`, title: "Remove", onclick: onRemove, text: "×" }));
  const rerun = mut => { mut(); S.view = computeView(S.db, S.filter); S.query = describe(S.filter); $("q").value = S.query; renderChips(); render(); };
  if (f.from != null) box.append(chip("Years", f.from === f.to ? `alive in ${fmtYear(f.from)}` : fmtSpan(f.from, f.to), () => rerun(() => { f.from = f.to = null; })),
    h("button", { type: "button", class: "plink", onclick: () => openYear(f.from, f.to, f.realms[0] || null), text: f.realms.length ? `Who ruled ${f.realms[0]} then?` : "Who ruled then?" }));
  f.types.forEach(t => box.append(chip("Who", TYPE_LABEL[t] || t, () => rerun(() => f.types.delete(t)))));
  // A place that is also a realm (England) shows once, as the Realm chip.
  f.regions.filter(r => !f.realms.some(x => x.toLowerCase() === r.toLowerCase()))
    .forEach(r => box.append(chip("Where", r, () => rerun(() => { f.regions = f.regions.filter(x => x !== r); }))));
  f.missingRegions.forEach(r => box.append(chip("Where", r, () => rerun(() => { f.missingRegions = f.missingRegions.filter(x => x !== r); }))));
  f.realms.forEach(r => box.append(chip("Realm", r, () => rerun(() => { f.realms = f.realms.filter(x => x !== r); f.regions = f.regions.filter(x => x.toLowerCase() !== r.toLowerCase()); }))));
  if (f.focus != null) box.append(chip("Around", S.db.byId[f.focus].name, () => rerun(() => { f.focus = null; })));
  S.view.warnings.forEach(w => box.append(h("span", { class: "chip warn", text: w })));
  if (f.ignored.length) box.append(h("span", { class: "chip warn", text: `Not understood: ${f.ignored.join(" ")}` }));
}

function describe(f) {
  const parts = [];
  if (f.focus != null) parts.push(S.db.byId[f.focus].name);
  parts.push(...f.realms, ...f.regions.filter(r => !f.realms.some(x => x.toLowerCase() === r.toLowerCase())), ...f.missingRegions);
  if (f.from != null) parts.push(rangeQuery(f.from, f.to));
  f.types.forEach(t => parts.push(TYPE_LABEL[t] || t));
  return parts.join(" ");
}

function renderTrail() {
  const box = $("trail"); box.innerHTML = "";
  if (!S.trail.length) { box.hidden = true; return; }
  box.hidden = false;
  box.append(h("span", { class: "lbl", text: "Back to:" }));
  S.trail.slice().reverse().forEach((q, i, arr) => {
    const idx = S.trail.length - 1 - i;
    box.append(h("button", { type: "button", text: q || "everything", onclick: () => { S.trail = S.trail.slice(0, idx); run(q); } }));
    if (i < arr.length - 1) box.append(" ‹ ");
  });
}

/* ------------------------------------------------------------------ chart */

// A person's colour is their first group's (see CATS); anyone in no group is muted.
const colorFor = p => (CATS.find(c => c.test(p)) || { color: "var(--muted)" }).color;

// Crowns: who held a title, and which one to name. Sovereign titles outrank dukes, counts and offices.
const SOVEREIGN = /\b(king|queen|emperor|empress|caliph|sultan|tsar|pope|high king|grand prince|doge|khan|lady of the english)\b/i;
// 0 = sovereign, 1 = co-ruler of one (Byzantine co-emperor, co-king), 2 = everything else (dukes, regents, offices).
const titleRank = t => /\bco-/i.test(t) ? 1 : SOVEREIGN.test(t) ? 0 : 2;
// The title to show under a name: one held in the view's years if it asks for some, else the highest held in life.
function headlineTitle(id, from, to) {
  let ts = S.db.titlesOf(id);
  if (from != null) ts = ts.filter(t => overlaps(t.start_year, t.end_year, from, to ?? from));
  if (!ts.length) return null;
  const rank = t => titleRank(t.title);
  const best = ts.slice().sort((a, b) => rank(a) - rank(b) || byYear(b.start_year, a.start_year))[0];
  return { title: best, more: new Set(ts.map(t => t.title)).size - 1 };
}
// A small crown, drawn into an SVG at (x, y) as its top-left corner.
function crownPath(x, y, w = 12) {
  const h = w * .75;
  return `M${x},${y + h} L${x},${y + h * .2} L${x + w * .27},${y + h * .55} L${x + w / 2},${y} L${x + w * .73},${y + h * .55} L${x + w},${y + h * .2} L${x + w},${y + h} Z`;
}
// The same crown as a standalone inline icon for HTML text (Year view, side panel).
function crownIcon(label = "Held a title") {
  const svg = el("svg", { viewBox: "0 0 12 10", width: 13, height: 11, class: "crown-icon", role: "img", "aria-label": label });
  el("path", { d: crownPath(0, .5, 12) }, svg);
  return svg;
}
let groups = {}, eventGroups = {};

function render() {
  const db = S.db, Z = ZOOMS[S.zoom];
  $("zoom-level").textContent = Z.name;
  $("zoom-out").disabled = S.zoom === 0; $("zoom-in").disabled = S.zoom === ZOOMS.length - 1;
  const host = $("chart"); host.innerHTML = "";
  groups = {}; eventGroups = {};
  const lanes = buildLanes(db, S.view.people);
  const order = lanes.flatMap(l => l.people);
  $("count").textContent = `${order.length} of ${db.people.length} people`;

  if (!order.length) {
    S.layout = null;
    const ys = db.people.flatMap(p => [db.startOf(p), db.endOf(p)]).filter(Number.isFinite);
    const regions = [...new Set(db.places.map(p => p.region).filter(Boolean))].slice(0, 6).join(", ");
    host.append(h("div", { class: "empty-state" },
      h("strong", { text: "Nothing in the database matches yet" }),
      `The database currently covers ${Math.min(...ys)}–${Math.max(...ys)}, with places in ${regions}. Try a wider range or remove a filter above.`));
    $("span").textContent = "";
    renderOverview(); renderDetailEmpty(); drawMap();
    return;
  }

  const shownIds = new Set(order.map(p => p.id));
  const evShown = S.layers.events ? S.view.events.slice().sort((a, b) => a.start_year - b.start_year || (a.start_date || "").localeCompare(b.start_date || "")) : [];
  const starts = order.map(db.startOf).filter(Number.isFinite).concat(evShown.map(e => e.start_year));
  const ends = order.map(db.endOf).filter(Number.isFinite).concat(evShown.map(e => e.end_year ?? e.start_year));
  const step0 = Z.px * 10 >= 24 ? 10 : Z.px * 50 >= 24 ? 50 : 100;
  const y0 = Math.floor((Math.min(...starts) - 5) / step0) * step0;
  const y1 = Math.ceil((Math.max(...ends) + 5) / step0) * step0;
  $("span").textContent = fmtSpan(y0, y1);

  // At full zoom a ruler's column carries a third header line: a crown and their title ("King of England").
  // and a crown above the name.
  const titled = Z.names !== "none" && order.some(p => db.titlesOf(p.id).length);
  const NAMES_H = Z.names === "full" ? (titled ? 92 : 62) : Z.names === "short" ? (titled ? 44 : 30) : 8;
  const LANE_H = 22, TOP = LANE_H + NAMES_H + 16;
  const LANEW = evShown.length ? (Z.names === "none" ? 40 : Z.names === "short" ? 120 : 176) : 0;
  const LEFT = LANEW + 52, GAP = 18;
  const y = yr => TOP + (yr - y0) * Z.px;
  const H = Math.round(y(y1) + 20);
  const xOf = {}; const laneBoxes = [];
  let x = LEFT;
  lanes.forEach(l => {
    const x0 = x;
    l.people.forEach(p => { xOf[p.id] = x + Z.col / 2; x += Z.col; });
    laneBoxes.push({ label: l.label, x0, x1: x });
    x += GAP;
  });
  const W = Math.round(x + 10);
  S.layout = { W, H, xOf, y, laneBoxes, y0, y1, TOP, Z };

  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Timeline chart" }, host);

  // Lane bands and labels
  laneBoxes.forEach((b, i) => {
    el("rect", { x: b.x0 - 4, y: 4, width: b.x1 - b.x0 + 8, height: H - 4, rx: 4, class: "lane-bg", opacity: i % 2 ? .55 : 1 }, svg);
    const maxChars = Math.floor((b.x1 - b.x0) / 7);
    const label = b.label.length > maxChars ? b.label.slice(0, Math.max(3, maxChars - 1)) + "…" : b.label;
    const t = el("text", { x: b.x0 + 4, y: 18, class: "lane-label" }, svg); t.textContent = label;
    el("title", {}, t).textContent = b.label;
  });

  // Year rail and grid
  for (let yr = y0; yr <= y1; yr += step0) {
    const major = yr % (step0 * 5) === 0;
    el("line", { x1: LEFT - 6, x2: W - 6, y1: y(yr), y2: y(yr), class: "grid", opacity: major ? 1 : .45 }, svg);
    el("text", { x: LEFT - 10, y: y(yr) + 4, "text-anchor": "end", class: "yr" }, svg).textContent = fmtYear(yr);
  }

  // Events lane. Prominence is a star rating: 5 = always labelled, then 4, 3, 2, 1 while labels fit
  // without overlapping (no rating counts as 3). An event left without room gets only a small marker,
  // with its name as a tooltip, and stays clickable. A labelled event draws only a short tick to the year
  // rail (the people in it carry a diamond on their bars); its line out to the rightmost person in view who
  // took part appears on hover or when selected, so the chart isn't striped by events.
  if (evShown.length) {
    if (Z.names !== "none") el("text", { x: 8, y: TOP - 10, class: "dates" }, svg).textContent = "EVENTS";
    const gapNeeded = Z.names === "full" ? 30 : 16;
    const stars = e => e.prominence ?? 3;
    const taken = [], labelY = {};
    const fits = ly => taken.every(t => Math.abs(t - ly) >= gapNeeded);
    if (Z.names !== "none") evShown.slice()
      .sort((a, b) => stars(b) - stars(a) || a.start_year - b.start_year || (a.start_date || "").localeCompare(b.start_date || ""))
      .forEach(e => {
        let ly = y(e.start_year);
        if (!fits(ly)) {
          if (stars(e) < 5) return;          // no room: marker only
          while (!fits(ly)) ly += 2;         // a 5 always gets a label: nudge it to the next free spot
        }
        taken.push(ly); labelY[e.id] = ly;
      });
    evShown.forEach(e => {
      const yy = y(e.start_year), ly = labelY[e.id];
      const g = el("g", { class: "event", tabindex: 0, role: "button", "aria-label": `${e.name}, ${fmtYear(e.start_year)}` }, svg);
      if (Z.names !== "none" && ly != null) {
        // A short tick to the year rail; the line out to the people involved shows on hover or selection.
        el("line", { x1: LANEW - 6, x2: LEFT - 6, y1: yy, y2: yy, class: "event-line" }, g);
        const xs = db.peopleInEvent(e.id).map(x => xOf[x.person.id]).filter(v => v != null);
        if (xs.length) el("line", { x1: LEFT - 6, x2: Math.max(...xs) + Z.bar / 2, y1: yy, y2: yy, class: "event-line reach" }, g);
      }
      el("title", {}, g).textContent = `${e.name} (${e.start_date ? fmtDate(e.start_date) : fmtYear(e.start_year)})`;
      if (Z.names === "none" || ly == null) {
        el("path", { d: `M${LANEW - 18},${yy - 5} l5,5 l-5,5 l-5,-5 Z`, fill: "var(--madder)", class: Z.names === "none" ? null : "event-mark" }, g);
        // Beside labels, the marker's click area is just the marker so it can't cover a label.
        if (Z.names === "none") el("rect", { x: 2, y: yy - 9, width: LANEW - 6, height: 18, class: "hit" }, g);
        else el("rect", { x: LANEW - 28, y: yy - 9, width: 20, height: 18, class: "hit" }, g);
      } else {
        if (ly !== yy) el("path", { d: `M${LANEW - 10},${ly - 4} L${LANEW - 6},${yy}`, class: "event-line" }, svg);
        const name = Z.names === "short" && e.name.length > 16 ? e.name.slice(0, 15) + "…" : e.name;
        el("text", { x: LANEW - 12, y: ly - 4, "text-anchor": "end", class: "event-label" }, g).textContent = name;
        if (Z.names === "full") el("text", { x: LANEW - 12, y: ly + 9, "text-anchor": "end", class: "event-sub" }, g).textContent =
          (e.start_date ? fmtDate(e.start_date) : fmtYear(e.start_year)) + (e.visitable_today ? " · ◆ visitable" : "");
        el("rect", { x: 2, y: ly - 17, width: LANEW - 10, height: Z.names === "full" ? 30 : 18, rx: 3, class: "hit" }, g);
      }
      g.addEventListener("click", () => selectEvent(e.id));
      g.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectEvent(e.id); } });
      eventGroups[e.id] = g;
    });
  }

  // Descent
  db.parentLinks.forEach(r => {
    const p = db.byId[r.source_id], c = db.byId[r.target_id];
    if (!shownIds.has(p?.id) || !shownIds.has(c?.id) || !Number.isFinite(c.birth_year) || xOf[p.id] == null || xOf[c.id] == null) return;
    const x1 = xOf[p.id] + (xOf[c.id] > xOf[p.id] ? Z.bar / 2 : -Z.bar / 2), x2 = xOf[c.id], yy = y(c.birth_year);
    el("path", { d: `M${x1},${yy} L${x2},${yy}`, class: "link" }, svg);
    el("circle", { cx: x2, cy: yy, r: Z.names === "none" ? 2 : 3, fill: "var(--madder)" }, svg);
  });

  // Marriages: double stitch for neighbours, an arc when the spouse sits further away (another lane).
  if (S.layers.spouses) db.spouseLinks.forEach(r => {
    const a = db.byId[r.source_id], b = db.byId[r.target_id];
    if (xOf[a?.id] == null || xOf[b?.id] == null || !Number.isFinite(r.start_year)) return;
    const [l, rt] = xOf[a.id] < xOf[b.id] ? [a, b] : [b, a];
    const x1 = xOf[l.id] + Z.bar / 2, x2 = xOf[rt.id] - Z.bar / 2, yy = y(r.start_year);
    const adjacent = (xOf[rt.id] - xOf[l.id]) <= Z.col + 1;
    if (adjacent) {
      el("line", { x1, x2, y1: yy - 2, y2: yy - 2, class: "marriage" }, svg);
      el("line", { x1, x2, y1: yy + 2, y2: yy + 2, class: "marriage" }, svg);
    } else {
      const lift = Math.min(60, (x2 - x1) / 6);
      el("path", { d: `M${x1},${yy} Q${(x1 + x2) / 2},${yy - lift} ${x2},${yy}`, class: "marriage-arc" }, svg);
    }
    if (Z.names === "full") el("text", { x: (x1 + x2) / 2, y: yy - (adjacent ? 6 : Math.min(60, (x2 - x1) / 6) / 2 + 6), "text-anchor": "middle", class: "marriage-yr" }, svg).textContent = `m. ${fmtYear(r.start_year)}`;
  });

  // People
  order.forEach(p => {
    const cx = xOf[p.id];
    const s = db.startOf(p), d = db.endOf(p);
    const inLaw = db.marriedIn.has(p.id);
    const g = el("g", { class: "person", tabindex: 0, role: "button", "aria-label": `${p.name}, ${fmtYear(p.birth_year) ?? "birth unknown"} to ${fmtYear(p.death_year) ?? "unknown"}` }, svg);
    const titles = db.titlesOf(p.id);
    el("title", {}, g).textContent = `${p.name} (${fmtSpan(p.birth_year, p.death_year)})` + titles.map(t => `\n♛ ${t.title}, ${reignSpan(t)}`).join("");
    // A crown sits above the name of anyone who held a title (in the requested years, if the request names some).
    const head = headlineTitle(p.id, S.filter?.from, S.filter?.to);
    const crown = (cy, w) => el("path", { d: crownPath(cx - w / 2, cy, w), class: "crown" + (head.title.disputed ? " disputed" : "") }, g);
    // The name card (crown, name, dates, title) sits just above the top of this person's own bar, not in a
    // header row: in a long span, someone born late would otherwise have their name far above their line.
    // dy is how far their bar starts below the chart's top; people born at the start keep the header spot.
    const top = y(s ?? y0), dy = Math.max(0, top - TOP);
    if (Z.names === "full") {
      const lift = titled ? 16 : 0;   // room for the title line
      const i = p.name.indexOf(" of ");
      const parts = i > 0 ? [p.name.slice(0, i), p.name.slice(i + 1)] : [p.name];
      const firstY = TOP - 46 - lift + (parts.length === 1 ? 16 : 0) + dy;
      parts.forEach((line, k) => el("text", { x: cx, y: firstY + k * 16, "text-anchor": "middle", class: "name" }, g).textContent = line);
      el("text", { x: cx, y: TOP - 12 - lift + dy, "text-anchor": "middle", class: "dates" }, g).textContent = fmtSpan(p.birth_year, p.death_year);
      if (head) {
        crown(firstY - 25, 15);
        // "King of England +1" under the dates, cut to fit the column.
        const CH = 5.5;   // width of one 9px mono character
        const max = Math.floor((Z.col - 10) / CH);
        // Keep the title whole if possible: the "+1" (other titles, listed in the panel) goes first.
        let label = head.title.title + (head.more ? ` +${head.more}` : "");
        if (label.length > max) label = head.title.title;
        if (label.length > max) label = label.slice(0, max - 1) + "…";
        el("text", { x: cx, y: TOP - 13 + dy, "text-anchor": "middle", class: "rank" }, g).textContent = label;
      }
    } else if (Z.names === "short") {
      const short = p.name.split(" of ")[0];
      el("text", { x: cx, y: TOP - 12 + dy, "text-anchor": "middle", class: "name", style: "font-size:11px" }, g).textContent = short.length > 9 ? short.slice(0, 8) + "…" : short;
      if (head) crown(TOP - 34 + dy, 12);
    }
    const color = colorFor(p);
    const hgt = Math.max(2, y(d ?? s ?? y0) - top);
    if (inLaw) el("rect", { x: cx - Z.bar / 2 + .75, y: top, width: Z.bar - 1.5, height: hgt, rx: 3, fill: color, "fill-opacity": .22, stroke: color, "stroke-width": 1.5, "stroke-dasharray": p.birth_year == null ? "4 3" : null, class: "bar" }, g);
    else el("rect", { x: cx - Z.bar / 2, y: top, width: Z.bar, height: hgt, rx: 3, fill: color, class: "bar" }, g);
    // Reigns: a gold strip beside the bar for the years each title was held.
    // Titles held at the same time (Duke of Normandy and King of England) get side-by-side strips.
    const tracks = [];
    titles.forEach(t => {
      if (t.start_year == null) return;
      const end = t.end_year ?? d ?? t.start_year;
      let k = tracks.findIndex(last => last < t.start_year);
      if (k < 0) k = tracks.push(end) - 1; else tracks[k] = end;
      const ry = y(t.start_year), rh = Math.max(2, y(end) - ry);
      el("rect", { x: cx + Z.bar / 2 + 2 + k * 5, y: ry, width: 3, height: rh, rx: 1.5, class: "reign" + (t.disputed ? " disputed" : "") }, g);
    });
    // Click area: from the name card down to the end of the bar.
    const hy = LANE_H + 4 + dy;
    el("rect", { x: cx - Z.col / 2 + 3, y: hy, width: Z.col - 6, height: Math.max(top + hgt, TOP + dy) - hy + 8, rx: 4, class: "hit" }, g);
    g.addEventListener("click", () => select(p.id));
    g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(p.id); } });
    groups[p.id] = g;
  });

  // Event participation diamonds (one per person per year, roles joined)
  if (S.layers.events) {
    const marks = new Map();
    S.db.ep.forEach(x => {
      const e = db.eventById[x.event_id], p = db.byId[x.entity_id];
      if (!e || xOf[p?.id] == null || !Number.isFinite(e.start_year) || !evShown.includes(e)) return;
      const k = p.id + ":" + e.start_year;
      if (!marks.has(k)) marks.set(k, { p, year: e.start_year, roles: [] });
      if (x.role) marks.get(k).roles.push(x.role);
    });
    marks.forEach(m => {
      const cx = xOf[m.p.id], cy = y(m.year), r = Z.names === "none" ? 4 : 6;
      el("path", { d: `M${cx},${cy - r} L${cx + r},${cy} L${cx},${cy + r} L${cx - r},${cy} Z`, fill: "var(--madder)", stroke: "var(--linen)", "stroke-width": 1.5, "pointer-events": "none" }, svg);
      if (m.roles.length && Z.names === "full") el("text", { x: cx + r + 4, y: cy + 14, class: "role-label", "pointer-events": "none" }, svg).textContent = m.roles.join(", ");
    });
  }

  // Keep or pick a selection
  if (S.selected?.kind === "event" && eventGroups[S.selected.id]) selectEvent(S.selected.id);
  else if (S.selected?.kind === "person" && xOf[S.selected.id] != null) select(S.selected.id);
  else if (S.selected?.kind === "place" && placeInView(S.selected.id)) selectPlace(S.selected.id);
  else select((order.find(p => db.childrenOf(p.id).some(c => shownIds.has(c.id))) || order[0]).id);

  renderOverview();
}

/* ------------------------------------------------------------------ overview strip */

function renderOverview() {
  const box = $("overview"); box.innerHTML = "";
  const L = S.layout;
  const OW = Math.max(200, box.clientWidth || 600), OH = 56;
  const svg = el("svg", { viewBox: `0 0 ${OW} ${OH}`, preserveAspectRatio: "none", "aria-hidden": "true" }, box);
  if (!L) return;
  const sx = OW / L.W, sy = OH / L.H;
  L.laneBoxes.forEach((b, i) => el("rect", { x: b.x0 * sx, y: 0, width: (b.x1 - b.x0) * sx, height: OH, class: "lane-bg", opacity: i % 2 ? .55 : 1 }, svg));
  Object.entries(L.xOf).forEach(([id, cx]) => {
    const p = S.db.byId[id];
    const s = S.db.startOf(p), d = S.db.endOf(p);
    if (s == null) return;
    el("rect", { x: cx * sx - 1, y: L.y(s) * sy, width: Math.max(2, L.Z.bar * sx), height: Math.max(2, (L.y(d) - L.y(s)) * sy), fill: colorFor(p), opacity: S.db.marriedIn.has(p.id) ? .45 : 1 }, svg);
  });
  S.ovWindow = el("rect", { class: "ov-window", x: 0, y: 0, width: 10, height: OH }, svg);
  S.ovScale = { sx, sy, OW, OH };
  updateOverviewWindow();
}

function updateOverviewWindow() {
  const L = S.layout, c = $("chart");
  if (!L || !S.ovWindow) return;
  const { sx, sy, OW, OH } = S.ovScale;
  const w = Math.min(OW, c.clientWidth * sx), hh = Math.min(OH, c.clientHeight * sy);
  S.ovWindow.setAttribute("x", Math.min(OW - w, c.scrollLeft * sx));
  S.ovWindow.setAttribute("y", Math.min(OH - hh, c.scrollTop * sy));
  S.ovWindow.setAttribute("width", Math.max(6, w));
  S.ovWindow.setAttribute("height", Math.max(6, hh));
}

function overviewJump(ev) {
  const L = S.layout; if (!L) return;
  const r = $("overview").getBoundingClientRect(), c = $("chart");
  const fx = (ev.clientX - r.left) / r.width, fy = (ev.clientY - r.top) / r.height;
  c.scrollLeft = fx * L.W - c.clientWidth / 2;
  c.scrollTop = fy * L.H - c.clientHeight / 2;
}

/* ------------------------------------------------------------------ zoom */

function setZoom(z, anchor) {
  z = Math.max(0, Math.min(ZOOMS.length - 1, z));
  if (z === S.zoom || !S.layout) return;
  const c = $("chart"), L = S.layout;
  const ax = anchor ? anchor.x : c.clientWidth / 2, ay = anchor ? anchor.y : c.clientHeight / 2;
  const fx = (c.scrollLeft + ax) / L.W;
  const year = L.y0 + ((c.scrollTop + ay) - L.TOP) / L.Z.px;
  S.zoom = z;
  render();
  const N = S.layout;
  c.scrollLeft = fx * N.W - ax;
  c.scrollTop = N.y(year) - ay;
  updateOverviewWindow();
}

/* ------------------------------------------------------------------ selection and links */

function clearSel() {
  Object.values(groups).forEach(g => g.classList.remove("sel"));
  Object.values(eventGroups).forEach(g => g.classList.remove("sel"));
}

function personLink(p, extra = "") {
  const inView = S.layout?.xOf[p.id] != null;
  return h("button", {
    type: "button", class: "plink" + (inView ? "" : " out"),
    title: inView ? `Go to ${p.name}` : `${p.name} isn't in this view. Opens a view around them.`,
    onclick: () => reveal(p.id), text: p.name + extra
  });
}
function eventLink(e, extra = "") {
  return h("button", { type: "button", class: "plink", title: `Show ${e.name}`, onclick: () => revealEvent(e.id), text: e.name + extra });
}
function placeLink(pl, extra = "") {
  return h("button", { type: "button", class: "plink", title: `Show ${pl.name}`, onclick: () => selectPlace(pl.id), text: pl.name + extra });
}
// Plain text with any database person's name turned into a link ("Edward the Confessor; Henry III from 1245").
function linkNames(text) {
  const names = S.db.people.map(p => p.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!text || !names.length) return [text];
  const byName = Object.fromEntries(S.db.people.map(p => [p.name, p]));
  return text.split(new RegExp(`(?<![\\w])(${names.map(esc).join("|")})(?![\\w])`)).filter(Boolean)
    .map(part => byName[part] ? personLink(byName[part]) : part);
}
const joinNodes = (nodes, empty = "None recorded") => nodes.length ? nodes.flatMap((n, i) => i ? [", ", n] : [n]) : [empty];

function reveal(id) {
  const L = S.layout, c = $("chart");
  if (L && L.xOf[id] != null) {
    select(id);
    const p = S.db.byId[id], s = S.db.startOf(p);
    c.scrollTo({ left: L.xOf[id] - c.clientWidth / 2, top: Math.max(0, L.y(s ?? L.y0) - 120), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    const g = groups[id]; g.classList.remove("flash"); void g.getBoundingClientRect(); g.classList.add("flash");
    g.focus({ preventScroll: true });
  } else {
    run(S.db.byId[id].name, { pushTrail: true });
  }
}

function revealEvent(id) {
  if (eventGroups[id]) {
    selectEvent(id);
    const e = S.db.eventById[id], c = $("chart");
    c.scrollTo({ top: Math.max(0, S.layout.y(e.start_year) - 120), behavior: "smooth" });
  } else {
    const e = S.db.eventById[id];
    run(rangeQuery(e.start_year - 20, e.start_year + 20), { pushTrail: true });
    selectEvent(id);
  }
}

function select(id) {
  S.selected = { kind: "person", id };
  clearSel(); groups[id]?.classList.add("sel");
  const db = S.db, p = db.byId[id];
  const age = Number.isFinite(p.birth_year) && Number.isFinite(p.death_year) ? yearsBetween(p.birth_year, p.death_year) : null;
  const box = $("detail"); box.innerHTML = "";
  const rows = [
    ["Born", fmtYear(p.birth_year) ?? "Unknown"],
    ["Died", fmtYear(p.death_year) ?? "Unknown"],
    ["Age at death", age ?? "Unknown"],
    ["Spouses", joinNodes(db.spousesOf(id).map(s => personLink(s.person, s.year != null ? ` (m. ${fmtYear(s.year)})` : "")))],
    ["Parents", joinNodes(db.parentsOf(id).map(x => personLink(x)))],
    ["Children", joinNodes(db.childrenOf(id).map(x => personLink(x)))],
    ["Events", joinNodes(db.eventsOf(id).map(x => eventLink(x.event, x.role ? ` (${x.role})` : "")), "None linked")],
    ...(db.titlesOf(id).length ? [[h("span", {}, crownIcon(), " Titles"), joinNodes(db.titlesOf(id).map(t => h("button", { type: "button", class: "plink",
      title: `Who else ruled during ${reignSpan(t)}`, onclick: () => openYear(t.start_year, t.end_year ?? t.start_year),
      text: `${t.title}${t.disputed ? " (disputed)" : ""}, ${reignSpan(t)}` })))]] : []),
    ["Sources", sourceLinks(db.sourcesFor("person", p.key))],
    ["Obsidian note", obsidianLink(p.obsidian_link)],
  ];
  const dl = h("dl");
  rows.forEach(([k, v]) => dl.append(h("dt", {}, k), h("dd", {}, ...(Array.isArray(v) ? v : [v]))));
  box.append(
    h("div", { class: "kind", style: `color:${colorFor(p)}`, text: (p.type || "Person") + (db.marriedIn.has(id) ? " · married in" : "") }),
    h("h2", { text: p.name }), dl,
    h("button", { type: "button", class: "btn ghost", onclick: () => run(p.name, { pushTrail: true }), text: `Show ${p.name}'s family` })
  );
  drawMap();
}

function selectEvent(id) {
  S.selected = { kind: "event", id };
  clearSel(); eventGroups[id]?.classList.add("sel");
  const db = S.db, e = db.eventById[id], place = db.placeById[e.place_id];
  const box = $("detail"); box.innerHTML = "";
  const dl = h("dl");
  [["Date", fmtDate(e.start_date) || fmtYear(e.start_year) || "Unknown"],
   ...(e.end_year != null && e.end_year !== e.start_year ? [["Ended", fmtYear(e.end_year)]] : []),
   ["Where", place ? placeLink(place, place.historical_name ? ` (then ${place.historical_name})` : "") : (e.location || "Unknown")],
   ["People", joinNodes(db.peopleInEvent(id).map(x => personLink(x.person, x.role ? ` (${x.role})` : "")), "None linked")],
   ["Visit today", e.visitable_today ? (e.visit_site || "Yes") : "No"],
   ["Sources", sourceLinks(db.sourcesFor("event", e.key))],
   ["Obsidian note", obsidianLink(e.obsidian_link)]]
    .forEach(([k, v]) => dl.append(h("dt", { text: k }), h("dd", {}, ...(Array.isArray(v) ? v : [v]))));
  box.append(h("div", { class: "kind", style: "color:var(--madder)", text: e.type || "Event" }), h("h2", { text: e.name }), dl);
  drawMap();
}

function selectPlace(id) {
  S.selected = { kind: "place", id };
  clearSel();
  const db = S.db, pl = db.placeById[id];
  const box = $("detail"); box.innerHTML = "";
  const events = db.eventsAt(id).sort((a, b) => byYear(a.start_year, b.start_year) || (a.start_date || "").localeCompare(b.start_date || ""));
  const people = [...new Map([...db.momentsAt(id).map(m => m.person), ...events.flatMap(e => db.peopleInEvent(e.id).map(x => x.person))]
    .map(p => [p.id, p])).values()].sort((a, b) => byYear(db.startOf(a), db.startOf(b)));
  const where = [...new Set([pl.city, pl.region, pl.modern_country].filter(Boolean))].join(", ");
  const rows = [
    ["Where", where || "Unknown"],
    ...(pl.historical_name ? [["Then called", pl.historical_name]] : []),
    ["Founded", pl.start_year != null ? (pl.start_estimated ? "c. " : "") + fmtYear(pl.start_year) : "Unknown"],
    ...(pl.end_year != null ? [["Ended", fmtYear(pl.end_year)]] : pl.visitable_today ? [["Ended", "Still stands"]] : []),
    ...(pl.built_by ? [["Built by", linkNames(pl.built_by)]] : []),
    ...(pl.architect ? [["Architect", linkNames(pl.architect)]] : []),
    ["Visit today", pl.visitable_today ? (pl.visit_site || "Yes") : "No"],
    ["Events here", joinNodes(events.map(e => eventLink(e, e.start_year != null ? ` (${fmtYear(e.start_year)})` : "")), "None linked")],
    ["People", joinNodes(people.map(p => personLink(p)), "None linked")],
    ...(pl.note ? [["Note", pl.note]] : []),
    ["Sources", sourceLinks(db.sourcesFor("place", pl.key))],
    ["Obsidian note", obsidianLink(pl.obsidian_link)],
  ];
  const dl = h("dl");
  rows.forEach(([k, v]) => dl.append(h("dt", {}, k), h("dd", {}, ...(Array.isArray(v) ? v : [v]))));
  box.append(h("div", { class: "kind", style: "color:var(--ink)", text: cap(pl.kind) || "Place" }), h("h2", { text: pl.name }), dl,
    h("p", { class: "hint", text: "Everything that happened here is listed in date order under the map." }));
  drawMap();
}
// A place stays selected across views only while something in the view connects to it.
function placeInView(id) {
  const L = S.layout, db = S.db;
  return db.eventsAt(id).some(e => eventGroups[e.id]) || db.momentsAt(id).some(m => L?.xOf[m.person.id] != null);
}

// Source links open in a new tab: "Wikipedia: Matilda of Flanders", or the source's title when it isn't Wikipedia.
// A source without a URL (an Obsidian note, a conversation) is listed as plain text.
// A person's own Wikipedia article: of the Wikipedia sources they cite, the one whose title shares the most
// words with their name (so William Adelin links to "William Adelin", not to "White Ship").
function wikiFor(p) {
  const words = s => new Set(s.toLowerCase().replace(/\(wikipedia\)/, "").split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1));
  const name = words(p.name);
  const wps = S.db.sourcesFor("person", p.key).filter(s => /wikipedia\.org\/wiki\//.test(s.url || ""));
  let best = null, score = -1;
  wps.forEach(s => { const n = [...words(s.title)].filter(w => name.has(w)).length; if (n > score) { best = s; score = n; } });
  return best;
}
// A small "Wikipedia ↗" link after a name, opening the person's article in a new tab (nothing if none is cited).
function wikiLink(p) {
  const s = wikiFor(p);
  return s ? h("a", { class: "wiki", href: s.url, target: "_blank", rel: "noopener", title: s.title, "aria-label": `${p.name} on Wikipedia`, text: "Wikipedia ↗" }) : null;
}

function sourceLinks(sources) {
  if (!sources.length) return ["None recorded"];
  return joinNodes(sources.map(s => {
    const wiki = /wikipedia\.org/.test(s.url || "");
    const label = wiki ? "Wikipedia: " + s.title.replace(/\s*\(Wikipedia\)\s*$/, "") : s.title;
    return s.url ? h("a", { class: "ext", href: s.url, target: "_blank", rel: "noopener", text: label + " ↗" }) : label;
  }));
}

function obsidianLink(name) {
  if (!name) return "None yet";
  const vault = (window.HISTORY_CONFIG || {}).obsidianVault;
  if (!vault) return name;
  return h("a", { class: "ext", href: `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(name)}`, text: name, title: "Open in Obsidian (on a computer with your vault)" });
}

function renderDetailEmpty() {
  const box = $("detail"); box.innerHTML = "";
  box.append(h("p", { class: "hint", text: "Nothing selected. Ask for a different view above." }));
  S.selected = null;
}

/* ------------------------------------------------------------------ map */

const ROLE_ORDER = { born: 0, died: 8, buried: 9 };
const ROUTE_COLORS = ["var(--woad)", "var(--madder)", "var(--weld)", "var(--stitch)", "var(--ochre)", "var(--ink)"];

function stopsForPerson(id) {
  const db = S.db, stops = [];
  db.pp.filter(x => x.entity_id === id).forEach(x => {
    const place = db.placeById[x.place_id];
    if (place) stops.push({ year: x.year, date: null, what: cap(x.role), place, rank: ROLE_ORDER[x.role] ?? 5 });
  });
  db.eventsOf(id).forEach(({ event: e, role }) => {
    const place = db.placeById[e.place_id];
    if (place) stops.push({ year: e.start_year, date: e.start_date, what: e.name + (role ? ` (${role})` : ""), place, rank: 2 });
  });
  return stops.sort((a, b) => byYear(a.year, b.year) || a.rank - b.rank || (a.date || "").localeCompare(b.date || ""));
}
function stopsForEvent(id) {
  const e = S.db.eventById[id], place = e && S.db.placeById[e.place_id];
  return place ? [{ year: e.start_year, date: e.start_date, what: e.name, place, rank: 2 }] : [];
}
// One place's history: its events and the life moments recorded there, with links in place of plain text.
function stopsForPlace(id) {
  const db = S.db, place = db.placeById[id];
  if (!place) return [];
  const stops = [
    ...db.eventsAt(id).map(e => ({ year: e.start_year, date: e.start_date, what: e.name, node: eventLink(e), place, rank: 2 })),
    ...db.momentsAt(id).map(m => ({ year: m.year, date: null, what: `${m.person.name}: ${m.role}`,
      node: [personLink(m.person), ` ${m.role}`], place, rank: ROLE_ORDER[m.role] ?? 5 })),
  ];
  return stops.sort((a, b) => byYear(a.year, b.year) || a.rank - b.rank || (a.date || "").localeCompare(b.date || ""));
}

function drawMap() {
  const host = $("map"), list = $("stops");
  host.innerHTML = ""; list.innerHTML = "";
  const W = 340, H = 280, db = S.db;
  let routes = [], emptyMsg = "";
  if (S.mapMode === "everyone") {
    const ids = S.layout ? Object.keys(S.layout.xOf).map(Number) : [];
    routes = ids.map(id => ({ person: db.byId[id], stops: stopsForPerson(id) })).filter(r => r.stops.length)
      .map((r, i) => ({ ...r, color: ROUTE_COLORS[i % ROUTE_COLORS.length] }));
    if (!routes.length) emptyMsg = "No places recorded for anyone in this view yet.";
  } else if (S.selected?.kind === "event") {
    const s = stopsForEvent(S.selected.id);
    if (s.length) routes = [{ event: db.eventById[S.selected.id], stops: s, color: "var(--madder)" }]; else emptyMsg = "No place recorded for this event yet.";
  } else if (S.selected?.kind === "person") {
    const p = db.byId[S.selected.id], s = stopsForPerson(p.id);
    if (s.length) routes = [{ person: p, stops: s, color: colorFor(p) }]; else emptyMsg = `No places recorded for ${p.name} yet.`;
  } else if (S.selected?.kind === "place") {
    const pl = db.placeById[S.selected.id], s = stopsForPlace(pl.id);
    if (pl.lat != null && pl.lng != null) routes = [{ place: pl, stops: s.length ? s : [{ year: null, what: "", place: pl }], color: "var(--ink)" }];
    if (!s.length) emptyMsg = `Nothing linked to ${pl.name} yet.`;
  } else emptyMsg = "Select a person, event or place to see where it happened.";
  const placeMode = S.selected?.kind === "place" && S.mapMode !== "everyone";

  const pts = routes.flatMap(r => r.stops.map(s => [Number(s.place.lng), Number(s.place.lat)]));
  let lon0 = -3, lon1 = 3, lat0 = 48, lat1 = 53;
  if (pts.length) {
    lon0 = Math.min(...pts.map(p => p[0])); lon1 = Math.max(...pts.map(p => p[0]));
    lat0 = Math.min(...pts.map(p => p[1])); lat1 = Math.max(...pts.map(p => p[1]));
    if (lon1 - lon0 < 5) { const c = (lon0 + lon1) / 2; lon0 = c - 2.5; lon1 = c + 2.5; }
    if (lat1 - lat0 < 3.2) { const c = (lat0 + lat1) / 2; lat0 = c - 1.6; lat1 = c + 1.6; }
    const pl = (lon1 - lon0) * .18, pa = (lat1 - lat0) * .18;
    lon0 -= pl; lon1 += pl; lat0 -= pa; lat1 += pa;
  }
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Map of places" }, host);
  if (window.d3 && window.HISTORY_LAND) {
    const proj = d3.geoMercator().fitExtent([[10, 10], [W - 10, H - 10]], { type: "MultiPoint", coordinates: [[lon0, lat0], [lon1, lat1], [lon0, lat1], [lon1, lat0]] });
    const path = d3.geoPath(proj);
    el("rect", { width: W, height: H }, el("clipPath", { id: "mapclip" }, el("defs", {}, svg)));
    const g = el("g", { "clip-path": "url(#mapclip)" }, svg);
    el("path", { d: path(window.HISTORY_LAND), class: "landpath" }, g);
    routes.forEach(r => {
      const xy = r.stops.map(s => proj([Number(s.place.lng), Number(s.place.lat)]));
      const dd = xy.filter((p, i) => i === 0 || p[0] !== xy[i - 1][0] || p[1] !== xy[i - 1][1]);
      if (dd.length > 1) el("path", { d: "M" + dd.map(p => p.join(",")).join("L"), class: "route", stroke: r.color }, g);
    });
    const numbered = S.mapMode !== "everyone";
    let n = 0; const labelled = new Set();
    routes.forEach(r => {
      const byPlace = new Map();
      r.stops.forEach(s => { s.n = ++n; if (!byPlace.has(s.place.id)) byPlace.set(s.place.id, []); byPlace.get(s.place.id).push(s); });
      byPlace.forEach(items => {
        const pl = items[0].place, [px, py] = proj([Number(pl.lng), Number(pl.lat)]);
        // A place pin holds every stop there, so it shows a count instead of a list of numbers.
        const label = !numbered ? "" : placeMode ? (items[0].what ? String(items.length) : "") : items.map(s => s.n).join(",");
        const rr = numbered ? (label.length > 1 ? 10 : 8) : 5;
        const pin = el("circle", { cx: px, cy: py, r: rr, fill: r.color, stroke: "var(--land)", "stroke-width": 1.5,
          class: "pin", tabindex: 0, role: "button", "aria-label": `Show ${pl.name}` }, g);
        el("title", {}, pin).textContent = `Show ${pl.name}`;
        pin.addEventListener("click", () => selectPlace(pl.id));
        pin.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectPlace(pl.id); } });
        if (numbered) el("text", { x: px, y: py + 3.5, "text-anchor": "middle", class: "stop-num", "pointer-events": "none" }, g).textContent = label;
        if (!labelled.has(pl.id)) {
          labelled.add(pl.id);
          const right = px < W - 110;
          el("text", { x: right ? px + rr + 4 : px - rr - 4, y: py + 4, "text-anchor": right ? "start" : "end", class: "stop-label" }, g).textContent = pl.name;
        }
      });
    });
  }
  if (emptyMsg) { list.append(h("li", { style: "display:block" }, h("span", { class: "empty", text: emptyMsg }))); return; }
  if (S.mapMode !== "everyone") {
    routes.forEach(r => r.stops.forEach((s, i) => {
      const pl = s.place;
      list.append(h("li", {},
        h("span", { class: "n", style: `background:${r.color}`, text: placeMode ? i + 1 : s.n }),
        h("div", {},
          h("div", {}, h("span", { class: "yrs", text: (s.date ? fmtDate(s.date) : fmtYear(s.year) ?? "") + "  " }), h("span", { class: "what" }, s.node ?? s.what)),
          // In place mode every stop is the same place, already described in the panel above.
          placeMode ? null : h("div", { class: "where" }, placeLink(pl, pl.historical_name ? ` (then ${pl.historical_name})` : ""), pl.region ? `, ${pl.region}` : ""),
          !placeMode && pl.visitable_today ? h("div", { class: "visit", text: "◆ Visit: " + (pl.visit_site || pl.name) }) : null)));
    }));
  } else {
    routes.forEach(r => list.append(h("li", {},
      h("span", { class: "n", style: `background:${r.color}` }),
      h("div", {}, h("div", { class: "what" }, personLink(r.person)),
        h("div", { class: "where", text: r.stops.map(s => `${s.place.name} ${fmtYear(s.year) ?? ""}`.trim()).join(" → ") })))));
  }
}

function setMapMode(m) {
  S.mapMode = m;
  $("map-selected").setAttribute("aria-pressed", m === "selected");
  $("map-everyone").setAttribute("aria-pressed", m === "everyone");
  drawMap();
}

/* ------------------------------------------------------------------ year view */
// Who ruled where, and what happened, in a year or a span. Rulers come from the titles table,
// grouped by realm, so it grows to any country as titles are added.

// realm: the realm the page is focused on (its rulers, their events and people), or null for the whole world.
const Y = { from: null, to: null, realm: null, hidden: new Set(store.get("hiddenRegions", [])) };
// World regions in display order (matches sql/008). Realms not yet given a region go under Other.
const REGIONS = ["Western Europe", "Northern Europe", "Eastern Europe", "Middle East and North Africa", "Sub-Saharan Africa",
  "Central Asia", "South Asia", "East Asia", "Southeast Asia", "Americas", "Oceania", "Other"];
const reignSpan = t => {
  const s = (t.start_estimated ? "c. " : "") + (fmtYear(t.start_year) ?? "?");
  if (t.end_year == null) return `from ${s}`;
  if (t.end_year === t.start_year) return s;
  return (t.start_estimated ? "c. " : "") + fmtSpan(t.start_year, t.end_year) + (t.end_estimated ? " (end approx.)" : "");
};
const overlaps = (s, e, a, b) => s != null && s <= b && (e ?? Infinity) >= a;

// Links out of the Year view switch to the timeline first, then go to the record there.
const toTimeline = fn => () => { showView("timeline"); fn(); };
const yPerson = (p, extra = "") => h("button", { type: "button", class: "plink", title: `Show ${p.name} on the timeline`, onclick: toTimeline(() => reveal(p.id)), text: p.name + extra });
const yEvent = e => h("button", { type: "button", class: "plink", title: `Show ${e.name} on the timeline`, onclick: toTimeline(() => revealEvent(e.id)), text: e.name });
const yPlace = pl => h("button", { type: "button", class: "plink", title: `Show ${pl.name}`, onclick: toTimeline(() => selectPlace(pl.id)), text: pl.name });

function showView(v) {
  $("timeline-view").hidden = v !== "timeline";
  $("year-view").hidden = v !== "year";
  $("view-timeline").setAttribute("aria-pressed", v === "timeline");
  $("view-year").setAttribute("aria-pressed", v === "year");
  S.viewMode = v;
  if (v === "timeline") {
    try { history.replaceState(null, "", S.query ? "?q=" + encodeURIComponent(S.query) : location.pathname); } catch (e) {}
    renderOverview(); updateOverviewWindow();
  } else {
    syncYearUrl();
    $("year-from").focus({ preventScroll: true });
  }
}

function syncYearUrl() {
  if (S.viewMode !== "year") return;
  const p = new URLSearchParams({ view: "year" });
  if (Y.from != null) p.set("y", yearQuery(Y.from));
  if (Y.to != null && Y.to !== Y.from) p.set("to", yearQuery(Y.to, Y.from < 0));
  if (Y.realm) p.set("realm", Y.realm);
  try { history.replaceState(null, "", "?" + p.toString()); } catch (e) {}
}

// Opens the Year view on a year or span, from anywhere in the site.
function openYear(from, to, realm) {
  Y.from = from; Y.to = to ?? from;
  if (realm !== undefined) Y.realm = realm || null;
  $("year-from").value = from != null ? yearQuery(from) : "";
  $("year-to").value = Y.to !== Y.from ? yearQuery(Y.to, from < 0) : "";
  showView("year");
  renderYear();
}

// Focuses the Year view on one realm (null for the whole world), keeping the years.
function focusRealm(realm) {
  Y.realm = realm || null;
  syncYearUrl(); renderYear();
  window.scrollTo({ top: $("year-out").getBoundingClientRect().top + scrollY - 12, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

// Reads the two boxes with the same rules as the main request box: "1060", "384 BC", "11th century", "1060 to 1100".
// A realm named in the first box ("Scotland 1300") focuses the page on it, as in the timeline's search.
function readYearForm() {
  const a = $("year-from").value.trim(), b = $("year-to").value.trim();
  if (!a) return { error: "Type a year, e.g. 1060." };
  const fa = parseQuery(a, S.db), realm = fa.realms[0];
  if (fa.from == null) return { error: `Couldn't read "${a}" as a year. Try 1060, 384 BC or 11th century.` };
  let from = fa.from, to = fa.to;
  if (b) {
    const fb = parseQuery(b, S.db);
    if (fb.from == null) return { error: `Couldn't read "${b}" as a year.` };
    to = fb.to;
  }
  return from <= to ? { from, to, realm } : { from: to, to: from, realm };
}

function renderYear() {
  const db = S.db, out = $("year-out"), realmsBox = $("year-realms");
  out.innerHTML = ""; realmsBox.innerHTML = "";
  if (Y.error) { out.append(h("p", { class: "hint", text: Y.error })); return; }
  if (Y.from == null) {
    out.append(h("p", { class: "hint", text: "Type a year above to see who ruled and what happened." }));
    return;
  }
  const a = Y.from, b = Y.to ?? Y.from, single = a === b;
  const label = single ? fmtYear(a) : fmtSpan(a, b);
  const span = single ? 1 : yearsBetween(a, b) + 1;

  // Rulers, grouped by realm, then by title in the order each title first appears.
  const inRange = db.titles.filter(t => overlaps(t.start_year, t.end_year, a, b) && catOn(db.byId[t.entity_id]) && (!Y.realm || t.realm === Y.realm));
  // With a realm in focus: its title holders and their close family are "its people"; its places are those in its modern country.
  const holders = new Set(inRange.map(t => t.entity_id));
  const realmPeople = new Set([...holders].flatMap(id => [id, ...db.neighbours(id).map(n => n.id)]));
  const realmCountry = Y.realm ? db.countryOf[Y.realm] : null;
  const inRealm = p => !Y.realm || realmPeople.has(p.id);
  // Realms with the most rulers in the span first (the main kingdoms), then by name.
  const count = r => inRange.filter(t => t.realm === r).length;
  const realms = [...new Set(inRange.map(t => t.realm))].sort((x, y) => count(y) - count(x) || x.localeCompare(y));
  const regionOf = r => db.regionOf[r] || "Other";
  const regions = REGIONS.filter(g => realms.some(r => regionOf(r) === g));
  if (regions.length > 1) {
    realmsBox.append(h("span", { class: "lbl", text: "Regions" }));
    regions.forEach(g => {
      const on = !Y.hidden.has(g), n = realms.filter(r => regionOf(r) === g).length;
      realmsBox.append(h("button", { type: "button", class: "chip toggle-chip", "aria-pressed": on, title: on ? `Hide ${g}` : `Show ${g}`,
        onclick: () => { on ? Y.hidden.add(g) : Y.hidden.delete(g); store.set("hiddenRegions", [...Y.hidden]); renderYear(); }, text: `${g} (${n})` }));
    });
  }

  if (Y.realm) out.append(h("div", { class: "chips focus-chip" }, h("span", { class: "lbl", text: "Focused on" }),
    h("span", { class: "chip" }, h("b", { text: Y.realm }), h("button", { type: "button", "aria-label": "Show the whole world", title: "Show the whole world", onclick: () => focusRealm(null), text: "×" })),
    h("span", { class: "hint", text: "Its rulers, the people around them, and their events." })));
  out.append(h("div", { class: "year-head" },
    h("h2", { text: label }),
    h("button", { type: "button", class: "btn ghost", onclick: toTimeline(() => run(rangeQuery(a, b), { pushTrail: true })), text: "Show these years on the timeline" })));

  const rulers = h("section", { class: "year-sec" }, h("h3", { text: single ? "Who ruled" : "Who ruled, in order" }));
  const shown = realms.filter(r => !Y.hidden.has(regionOf(r)));
  out.append(yearMap(a, b, shown));
  // Hidden by the Show buttons: someone held a title (in the focused realm, if any) but their group is off.
  const hiddenRulers = !inRange.length && db.titles.some(t => overlaps(t.start_year, t.end_year, a, b) && (!Y.realm || t.realm === Y.realm));
  if (hiddenRulers) {
    rulers.append(h("p", { class: "hint", text: "Rulers are hidden by the Show buttons above (Royalty, Nobility, Clergy)." }));
  } else if (!inRange.length && Y.realm) {
    // A realm in focus with no holder: an interregnum or a gap in the data. Say which years we do have for it.
    const rs = db.titles.filter(t => t.realm === Y.realm).sort((x, y) => byYear(x.start_year, y.start_year));
    const before = rs.filter(t => t.end_year != null && t.end_year < a).pop(), after = rs.find(t => t.start_year > b);
    rulers.append(h("p", { class: "hint" }, `No ruler of ${Y.realm} is recorded for ${label}.`,
      before ? [" Before: ", yPerson(db.byId[before.entity_id], ` (to ${fmtYear(before.end_year)})`), "."] : "",
      after ? [" After: ", yPerson(db.byId[after.entity_id], ` (from ${fmtYear(after.start_year)})`), "."] : ""));
  } else if (!inRange.length) {
    const ys = db.titles.flatMap(t => [t.start_year, t.end_year]).filter(Number.isFinite);
    rulers.append(h("p", { class: "hint", text: db.titles.length
      ? `No rulers recorded for ${label} yet. Titles so far cover ${fmtSpan(Math.min(...ys), Math.max(...ys))}: ${[...new Set(db.titles.map(t => t.realm))].sort().join(", ")}.`
      : "No titles or reigns in the database yet." }));
  } else if (!shown.length) {
    rulers.append(h("p", { class: "hint", text: "Every region is hidden. Turn one back on above." }));
  }
  // With more than one region, each gets a heading and its own grid of realm cards.
  const grids = {};
  const gridFor = realm => {
    const g = regionOf(realm);
    if (!grids[g]) {
      grids[g] = h("div", { class: "realms" });
      if (regions.length > 1) rulers.append(h("h4", { class: "region-head", text: g }));
      rulers.append(grids[g]);
    }
    return grids[g];
  };
  // Grouped by region, the realms in each region read best alphabetically; without regions, biggest first (as sorted above).
  if (regions.length > 1) shown.sort((x, y) => REGIONS.indexOf(regionOf(x)) - REGIONS.indexOf(regionOf(y)) || x.localeCompare(y));
  shown.forEach(realm => {
    const ts = inRange.filter(t => t.realm === realm);
    const names = [...new Set(ts.slice().sort((x, y) => byYear(x.start_year, y.start_year)).map(t => t.title))];
    // The heading focuses the page on this realm (or back to the whole world when it's already in focus).
    const card = h("article", { class: "realm-card", "data-realm": realm }, h("h4", {},
      h("button", { type: "button", class: "realm-link", title: Y.realm ? "Show the whole world" : `Focus on ${realm}`,
        onclick: () => focusRealm(Y.realm ? null : realm), text: realm })));
    names.forEach(name => {
      const holders = ts.filter(t => t.title === name).sort((x, y) => byYear(x.start_year, y.start_year) || (x.start_date || "").localeCompare(y.start_date || ""));
      const row = h("div", { class: "title-row-y" }, h("div", { class: "tname", text: name }));
      const list = h("ol", { class: "holders" });
      holders.forEach(t => {
        const p = db.byId[t.entity_id];
        if (!p) return;
        // "year 5 of 22": works for offices and regencies as well as reigns.
        const nth = single && t.start_year != null
          ? ` · year ${yearsBetween(t.start_year, a) + 1}` + (t.end_year != null ? ` of ${yearsBetween(t.start_year, t.end_year) + 1}` : "") : "";
        list.append(h("li", { class: t.disputed ? "disputed" : "" }, crownIcon(t.disputed ? "Disputed claim" : "Held this title"), " ", yPerson(p),
          h("span", { class: "yrs", text: ` ${reignSpan(t)}${t.disputed ? " · disputed" : ""}${nth}` }),
          wikiLink(p),
          t.note ? h("div", { class: "tnote", text: t.note }) : null));
      });
      row.append(list);
      if (!single) row.append(reignStrip(holders, a, b));
      card.append(row);
    });
    gridFor(realm).append(card);
  });
  out.append(rulers);
  out.append(makersSection(a, b, single, label, realmCountry));

  // Events in the span, in date order.
  // Within a year, dated events first in date order, then those known only by year.
  const evInRealm = e => !Y.realm || db.peopleInEvent(e.id).some(x => realmPeople.has(x.person.id))
    || (realmCountry && db.placeById[e.place_id]?.modern_country === realmCountry);
  const evs = db.events.filter(e => overlaps(e.start_year, e.end_year ?? e.start_year, a, b) && eventCatOn(db, e) && evInRealm(e))
    .sort((x, y) => byYear(x.start_year, y.start_year) || !x.start_date - !y.start_date || (x.start_date || "").localeCompare(y.start_date || ""));
  const evSec = h("section", { class: "year-sec" }, h("h3", { text: `Events (${evs.length})` }));
  if (!evs.length) evSec.append(h("p", { class: "hint", text: `No events recorded for ${label} yet.` }));
  const evList = h("ul", { class: "ylist" });
  evs.forEach(e => {
    const pl = db.placeById[e.place_id], ppl = db.peopleInEvent(e.id);
    const when = e.start_date ? fmtDate(e.start_date) : fmtYear(e.start_year) + (e.end_year != null && e.end_year !== e.start_year ? `–${fmtYear(e.end_year)}` : "");
    evList.append(h("li", {}, h("span", { class: "yrs", text: (e.estimated ? "c. " : "") + when }), " ", yEvent(e),
      pl ? [" · ", yPlace(pl)] : null,
      ppl.length ? h("div", { class: "who" }, ...joinNodes(ppl.map(x => yPerson(x.person, x.role ? ` (${x.role})` : "")))) : null));
  });
  evSec.append(evList);
  out.append(evSec);

  // Births and deaths in the span.
  const born = db.people.filter(p => catOn(p) && inRealm(p) && p.birth_year != null && p.birth_year >= a && p.birth_year <= b).sort((x, y) => byYear(x.birth_year, y.birth_year));
  const died = db.people.filter(p => catOn(p) && inRealm(p) && p.death_year != null && p.death_year >= a && p.death_year <= b).sort((x, y) => byYear(x.death_year, y.death_year));
  const bd = h("section", { class: "year-sec two" });
  [["Born", born, "birth"], ["Died", died, "death"]].forEach(([title, list, k]) => {
    const sec = h("div", {}, h("h3", { text: `${title} (${list.length})` }));
    if (!list.length) sec.append(h("p", { class: "hint", text: "None recorded." }));
    else sec.append(h("ul", { class: "ylist" }, ...list.map(p => h("li", {},
      h("span", { class: "yrs", text: (p[k + "_estimated"] ? "c. " : "") + (p[k + "_date"] ? fmtDate(p[k + "_date"]) : fmtYear(p[k + "_year"])) }), " ", yPerson(p)))));
    bd.append(sec);
  });
  out.append(bd);
  if (span > 1) out.append(h("p", { class: "hint", text: `${span} years. Rulers are listed if any part of their reign falls in this span.` }));
}

// Artists, writers, composers and scholars alive in the span, grouped by type, each with what they did in it:
// their events, life moments (with the place) and the artworks they made.
const MAKER_TYPES = ["Artist", "Writer", "Composer", "Scholar"];
function makersSection(a, b, single, label, country) {
  const db = S.db, inSpan = (s, e) => overlaps(s, e ?? s, a, b);
  const alive = p => (p.birth_year != null || p.death_year != null) && inSpan(p.birth_year ?? p.death_year, p.death_year ?? p.birth_year);
  // With a realm in focus, the makers are those with a recorded place in its modern country.
  const makers = db.people.filter(p => MAKER_TYPES.includes(p.type) && alive(p) && catOn(p)
    && (!Y.realm || (country && db.placesOfPerson(p.id).some(pl => pl.modern_country === country))));
  const sec = h("section", { class: "year-sec" }, h("h3", { text: `Artists, writers and thinkers (${makers.length})` }));
  if (!makers.length) { sec.append(h("p", { class: "hint", text: `None recorded for ${label} yet.` })); return sec; }
  const grid = h("div", { class: "realms" });
  MAKER_TYPES.forEach(type => {
    const ps = makers.filter(p => p.type === type).sort((x, y) => byYear(x.birth_year, y.birth_year));
    if (!ps.length) return;
    const list = h("ul", { class: "makers" });
    ps.forEach(p => {
      const doings = [
        ...db.eventsOf(p.id).filter(x => inSpan(x.event.start_year, x.event.end_year))
          .map(x => ({ y: x.event.start_year, d: x.event.start_date, node: [yEvent(x.event), x.role ? ` (${x.role})` : ""] })),
        ...db.pp.filter(m => m.entity_id === p.id && m.year != null && inSpan(m.year)).map(m => {
          const pl = db.placeById[m.place_id];
          return { y: m.year, d: null, node: [cap(m.role), pl ? [" at ", yPlace(pl)] : ""] };
        }),
        ...db.worksBy(p.id).filter(w => inSpan(w.start_year, w.end_year)).map(w => ({ y: w.start_year, d: null,
          node: [w.image_page ? h("a", { class: "ext", href: w.image_page, target: "_blank", rel: "noopener", text: w.name + " ↗" }) : h("i", { text: w.name }),
            w.kind ? ` (${w.kind})` : ""] })),
      ].sort((x, y) => byYear(x.y, y.y) || (x.d || "").localeCompare(y.d || ""));
      // "aged 34" for a single year they were alive in; otherwise their life span.
      const when = single && p.birth_year != null && a >= p.birth_year ? `aged ${yearsBetween(p.birth_year, a)}` : fmtSpan(p.birth_year, p.death_year);
      const roles = (p.roles || []).slice(0, 3).join(", ");
      const shown = doings.slice(0, 8);
      list.append(h("li", {}, yPerson(p), h("span", { class: "yrs", text: ` ${when}${roles ? " · " + roles : ""}` }),
        shown.length ? h("ul", { class: "doings" }, ...shown.map(x => h("li", {}, h("span", { class: "yrs", text: `${x.d ? fmtDate(x.d) : fmtYear(x.y)} ` }), ...x.node))) : null,
        doings.length > shown.length ? h("div", { class: "tnote", text: `+${doings.length - shown.length} more` }) : null));
    });
    grid.append(h("article", { class: "realm-card maker-card" }, h("h4", { text: cap(TYPE_LABEL[type]) }), list));
  });
  sec.append(grid);
  return sec;
}

/* ------------------------------------------------------------------ year view: border map */
// World borders for snapshot years, from historical-basemaps (GPL-3.0, kept in data/maps/ with its licence).
// The map uses the latest snapshot at or before the year asked for (up to 99 years back); a span that
// crosses later snapshots gets a switch between them. Realms with a ruler in the span are shaded and
// clickable; data/maps/index.json says which map names belong to which realm.

const MAPS = { index: null, geo: {} };
const mapIndex = () => MAPS.index ??= fetch("data/maps/index.json").then(r => r.ok ? r.json() : null).catch(() => null);
const mapGeo = file => MAPS.geo[file] ??= fetch("data/maps/" + file).then(r => r.json()).then(rewind);

// d3 reads a polygon ring's direction to tell inside from outside; rings drawn the other way would
// cover the whole globe, so any polygon claiming more than half the sphere gets its rings reversed.
function rewind(geo) {
  geo.features.forEach(f => {
    const g = f.geometry; if (!g) return;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    polys.forEach(rings => {
      if (d3.geoArea({ type: "Polygon", coordinates: rings }) > 2 * Math.PI) rings.forEach(r => r.reverse());
    });
  });
  return geo;
}

function jumpToRealm(realm) {
  const card = document.querySelector(`.realm-card[data-realm="${CSS.escape(realm)}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
}

function yearMap(a, b, realmsInView) {
  const sec = h("section", { class: "year-sec map-sec", hidden: "" });
  (async () => {
    const idx = await mapIndex();
    if (!idx || !window.d3) return;
    const years = Object.keys(idx.years).map(Number).sort((x, y) => x - y);
    const start = years.filter(y => y <= a && a - y < 100).pop();
    const choices = years.filter(y => y === start || (y > a && y <= b && start != null) || (start == null && y >= a && y <= b));
    if (!choices.length) return;
    if (!choices.includes(Y.mapYear)) Y.mapYear = choices[0];
    sec.hidden = false;

    const realmsOf = {};   // map name -> realms in view it belongs to
    Object.entries(idx.realms).forEach(([realm, names]) => {
      if (realmsInView.includes(realm)) names.forEach(n => (realmsOf[n] ||= []).push(realm));
    });

    const head = h("div", { class: "map-head" }, h("h3", { text: "Borders" }));
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Snapshot year" });
    // Map labels: a plain flag with the ruler's name (default), or the realm's name alone.
    const modeSeg = h("div", { class: "seg", role: "group", "aria-label": "Map labels" });
    const tools = h("div", { class: "map-tools" }, modeSeg);
    if (choices.length > 1) tools.prepend(seg);
    head.append(tools);
    const box = h("div", { class: "histmap-box" });
    const credit = h("p", { class: "hint map-credit" });
    sec.append(head, box, credit);

    const draw = async () => {
      seg.innerHTML = "";
      choices.forEach(y => seg.append(h("button", { type: "button", "aria-pressed": y === Y.mapYear, text: fmtYear(y),
        onclick: () => { Y.mapYear = y; draw(); } })));
      const mode = store.get("mapLabels", "rulers");
      modeSeg.innerHTML = "";
      [["rulers", "Rulers"], ["realms", "Realms"]].forEach(([m, label]) => modeSeg.append(h("button", { type: "button", "aria-pressed": m === mode, text: label,
        onclick: () => { store.set("mapLabels", m); draw(); } })));
      // Whose name goes on a realm's flag: the year shown on the map if it falls in the span, else the span's start.
      const at = Y.mapYear >= a && Y.mapYear <= b ? Y.mapYear : a;
      const geo = await mapGeo(idx.years[Y.mapYear]);
      box.innerHTML = "";
      const W = 960, H = 500;
      const proj = d3.geoNaturalEarth1().fitExtent([[6, 6], [W - 6, H - 6]], { type: "Sphere" });
      const path = d3.geoPath(proj);
      const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "histmap", role: "img", "aria-label": `World borders around ${fmtYear(Y.mapYear)}` }, box);
      const g = el("g", {}, svg);
      el("path", { d: path({ type: "Sphere" }), class: "hm-sea" }, g);
      const labelFor = {};   // one label per realm, on its largest piece; our realm name where it's one realm
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      geo.features.forEach(f => {
        const pr = f.properties || {};
        const realms = realmsOf[pr.NAME] || realmsOf[pr.SUBJECTO] || null;
        const p = el("path", { d: path(f), class: "hm-land" + (realms ? " ruled" : "") }, g);
        el("title", {}, p).textContent = (pr.NAME || "Unnamed") + (realms ? `: ${realms.join(", ")}. Click for its rulers.` : "");
        if (realms) {
          p.setAttribute("tabindex", 0); p.setAttribute("role", "button");
          const go = () => focusRealm(realms[0]);
          p.addEventListener("click", go);
          p.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
          const name = realms.length === 1 ? realms[0] : pr.NAME, area = path.area(f);
          if (!labelFor[name] || labelFor[name].area < area) labelFor[name] = { name, realms, area, xy: path.centroid(f) };
          const [[x0, y0], [x1, y1]] = path.bounds(f);
          bx0 = Math.min(bx0, x0); by0 = Math.min(by0, y0); bx1 = Math.max(bx1, x1); by1 = Math.max(by1, y1);
        }
      });
      // The ruler a realm's flag names: a sovereign (king, caliph, emperor) over dukes, regents and officials,
      // an undisputed holder over a disputed one; "+1" when others also held titles there then.
      const rulerFor = realms => {
        const ts = S.db.titles.filter(t => realms.includes(t.realm) && overlaps(t.start_year, t.end_year, at, at) && S.db.byId[t.entity_id]);
        if (!ts.length) return null;
        const best = ts.slice().sort((x, y) => titleRank(x.title) - titleRank(y.title)
          || x.disputed - y.disputed || byYear(x.start_year, y.start_year))[0];
        return { t: best, more: new Set(ts.map(t => t.entity_id)).size - 1 };
      };
      // Realms the map draws inside a bigger territory (Barcelona inside France, Bohemia inside the Empire)
      // get a pin at their capital instead, from index.json's points.
      const withShape = new Set(Object.values(labelFor).flatMap(l => l.realms));
      const pg = el("g", { class: "hm-points" }, g);
      const pins = [];
      Object.entries(idx.points || {}).forEach(([realm, lnglat]) => {
        if (!realmsInView.includes(realm) || withShape.has(realm)) return;
        const xy = proj(lnglat);
        // Area 300 ranks a pin's label with a mid-sized realm's (Croatia, León) when labels compete for room.
        labelFor["pin:" + realm] = { name: realm, realms: [realm], area: 300, xy, point: true };
        const c = el("circle", { cx: xy[0], cy: xy[1], class: "hm-pin", tabindex: 0, role: "button", "aria-label": `${realm}: show its rulers` }, pg);
        el("title", {}, c).textContent = `${realm}. Click for its rulers.`;
        c.addEventListener("click", () => focusRealm(realm));
        c.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); focusRealm(realm); } });
        pins.push(c);
        bx0 = Math.min(bx0, xy[0]); by0 = Math.min(by0, xy[1]); bx1 = Math.max(bx1, xy[0]); by1 = Math.max(by1, xy[1]);
      });
      const lg = el("g", { class: "hm-labels" }, g);
      const labels = Object.values(labelFor).sort((p, q) => q.area - p.area).map(l => {
        // Drawn at screen size around (0, 0); placeLabels moves and scales the group. A pin's label sits to its right.
        const lab = el("g", {}, lg);
        const ruler = mode === "rulers" ? rulerFor(l.realms) : null;
        if (ruler) {
          const who = S.db.byId[ruler.t.entity_id].name + (ruler.more ? ` +${ruler.more}` : "");
          l.w = 12 + Math.max(who.length * 6.4, l.name.length * 5.2);
          const x0 = l.point ? 7 : -l.w / 2;
          el("line", { x1: x0 + 1, y1: -9, x2: x0 + 1, y2: 6, class: "flag-pole" }, lab);
          el("path", { d: `M${x0 + 1},-9 h8 l-2,3 l2,3 h-8 Z`, class: "flag" + (ruler.t.disputed ? " disputed" : "") }, lab);
          el("text", { x: x0 + 12, y: -1, class: "hm-ruler" }, lab).textContent = who;
          el("text", { x: x0 + 12, y: 10, class: "hm-realm" }, lab).textContent = l.name;
          l.h0 = 11; l.h1 = 13;
          el("title", {}, lab).textContent = `${l.name}: ${S.db.byId[ruler.t.entity_id].name}, ${ruler.t.title} (${reignSpan(ruler.t)})`;
        } else {
          el("text", { x: l.point ? 7 : 0, y: 4, "text-anchor": l.point ? "start" : "middle", class: "hm-ruler plain" }, lab).textContent = l.name;
          l.w = l.name.length * 6.2 + 6; l.h0 = 8; l.h1 = 8;
        }
        return { ...l, lab };
      });
      // Labels keep their on-screen size at any zoom; one that would overlap a bigger realm's label is hidden
      // until zooming in makes room.
      const placeLabels = tr => {
        // r converts screen pixels to map units, so labels stay the same size on a phone as on a desktop.
        const r = W / (svg.getBoundingClientRect().width || W), kept = [];
        pins.forEach(c => c.setAttribute("r", 4 * r / tr.k));
        labels.forEach(l => {
          l.lab.setAttribute("transform", `translate(${l.xy[0]},${l.xy[1]}) scale(${r / tr.k})`);
          const [sx, sy] = tr.apply(l.xy), w = l.w * r;
          const box = l.point ? [sx, sy - l.h0 * r, sx + (w + 7 * r), sy + l.h1 * r] : [sx - w / 2, sy - l.h0 * r, sx + w / 2, sy + l.h1 * r];
          const ok = (l.point || l.area * tr.k * tr.k > 60) && !kept.some(o => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1]);
          l.lab.style.display = ok ? "" : "none";
          if (ok) kept.push(box);
        });
      };
      // Pinch or Ctrl/⌘ + scroll to zoom, drag to pan.
      const zoom = d3.zoom().scaleExtent([1, 12]).translateExtent([[0, 0], [W, H]])
        .filter(e => e.type === "wheel" ? (e.ctrlKey || e.metaKey) : !e.button)
        .on("zoom", e => { g.setAttribute("transform", e.transform); placeLabels(e.transform); });
      const sel = d3.select(svg).call(zoom);
      // Open fitted to the shaded realms and pins (the whole world if none).
      let home = d3.zoomIdentity;
      if (bx1 > bx0) {
        const k = Math.max(1, Math.min(4, .92 / Math.max((bx1 - bx0) / W, (by1 - by0) / H)));
        home = d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-(bx0 + bx1) / 2, -(by0 + by1) / 2);
      }
      sel.call(zoom.transform, home);
      // Zoom buttons for those who don't know the Ctrl/⌘ + scroll or pinch gestures.
      const ease = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 250;
      box.append(h("div", { class: "map-zoom" },
        h("button", { type: "button", "aria-label": "Zoom in", title: "Zoom in", text: "+", onclick: () => sel.transition().duration(ease).call(zoom.scaleBy, 1.8) }),
        h("button", { type: "button", "aria-label": "Zoom out", title: "Zoom out", text: "−", onclick: () => sel.transition().duration(ease).call(zoom.scaleBy, 1 / 1.8) }),
        h("button", { type: "button", "aria-label": "Reset the map", title: "Back to the starting view", text: "⟲", onclick: () => sel.transition().duration(ease).call(zoom.transform, home) })));
      credit.innerHTML = "";
      credit.append(`Borders around ${fmtYear(Y.mapYear)}, approximate. Shaded: realms with a ruler in ${single(a, b)}; dots: realms the map draws inside a larger one, at their capital. Zoom with + and −, Ctrl/⌘ + scroll or a pinch; drag to move. Map data: `,
        h("a", { class: "ext", href: idx.source, text: "historical-basemaps" }), " by André Ourednik, ",
        h("a", { class: "ext", href: "data/maps/LICENSE", text: "GPL-3.0" }), " (",
        h("a", { class: "ext", href: "https://github.com/schmittyideas/history/tree/main/data/maps", text: "our copy of the files" }), ").");
    };
    draw();
  })();
  return sec;
}
const single = (a, b) => a === b ? fmtYear(a) : fmtSpan(a, b);

// One title's holders across the span, as bars on a shared scale.
function reignStrip(holders, a, b) {
  const W = 600, H = 22, x = y => ((Math.max(a, Math.min(b + 1, y)) - a) / (b + 1 - a)) * W;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "strip", role: "img", "aria-label": holders.map(t => `${S.db.byId[t.entity_id]?.name} ${reignSpan(t)}`).join("; ") });
  el("rect", { x: 0, y: 4, width: W, height: H - 8, class: "strip-bg" }, svg);
  holders.forEach((t, i) => {
    const p = S.db.byId[t.entity_id];
    const x0 = x(t.start_year), x1 = x((t.end_year ?? b) + 1), w = Math.max(2, x1 - x0);
    const r = el("rect", { x: x0, y: 4, width: w, height: H - 8, class: "strip-bar" + (i % 2 ? " alt" : "") + (t.disputed ? " disputed" : "") }, svg);
    el("title", {}, r).textContent = `${p?.name}: ${reignSpan(t)}`;
    if (p && w > p.name.length * 6.5 + 8) el("text", { x: x0 + 5, y: H / 2 + 4, class: "strip-label" }, svg).textContent = p.name;
  });
  return svg;
}

/* ------------------------------------------------------------------ wiring */

function setGroup(g) {
  S.group = g; store.set("group", g);
  $("group-family").setAttribute("aria-pressed", g === "family");
  $("group-type").setAttribute("aria-pressed", g === "type");
  render(); updateOverviewWindow();
}

// The group buttons under the title. Counts are people in the database; the choice is remembered per browser.
function renderCats() {
  // The same buttons appear in both views: under the timeline's search box, and between the Year form and the year.
  const db = S.db, groups = [...CATS, { key: "other", label: "Other", color: "var(--muted)" }];
  document.querySelectorAll(".cats").forEach(box => {
    box.innerHTML = "";
    box.append(h("span", { class: "lbl", text: "Show" }));
    groups.forEach(c => {
      const n = db.people.filter(p => catsOf(p).includes(c.key)).length;
      if (!n) return;
      const on = !S.catsOff.has(c.key);
      box.append(h("button", { type: "button", class: "chip cat-chip", style: `--c:${c.color}`, "aria-pressed": on,
        title: on ? `Hide ${c.label.toLowerCase()}` : `Show ${c.label.toLowerCase()}`,
        onclick: () => { on ? S.catsOff.add(c.key) : S.catsOff.delete(c.key); applyCats(); } },
        h("i", { class: "dot", "aria-hidden": "true" }), `${c.label} `, h("b", { text: n })));
    });
    if (S.catsOff.size) box.append(h("button", { type: "button", class: "plink", onclick: () => { S.catsOff.clear(); applyCats(); }, text: "Show everyone" }));
  });
}
function applyCats() {
  store.set("catsOff", [...S.catsOff]);
  renderCats();
  S.view = computeView(S.db, S.filter);
  render(); updateOverviewWindow();
  if (S.viewMode === "year") renderYear();
}

function wire() {
  $("ask-form").addEventListener("submit", e => { e.preventDefault(); run($("q").value.trim(), { pushTrail: true }); });
  $("show-all").addEventListener("click", () => run("", { pushTrail: true }));
  // Only the timeline's examples carry data-q; the Year view's (data-from) are wired below.
  document.querySelectorAll(".examples button[data-q]").forEach(b => b.addEventListener("click", () => run(b.dataset.q, { pushTrail: true })));
  $("group-family").addEventListener("click", () => setGroup("family"));
  $("group-type").addEventListener("click", () => setGroup("type"));
  $("layer-spouses").checked = S.layers.spouses;
  $("layer-events").checked = S.layers.events;
  $("layer-spouses").addEventListener("change", e => { S.layers.spouses = e.target.checked; store.set("spouses", S.layers.spouses); render(); updateOverviewWindow(); });
  $("layer-events").addEventListener("change", e => { S.layers.events = e.target.checked; store.set("events", S.layers.events); render(); updateOverviewWindow(); });
  $("zoom-in").addEventListener("click", () => setZoom(S.zoom + 1));
  $("zoom-out").addEventListener("click", () => setZoom(S.zoom - 1));
  $("view-timeline").addEventListener("click", () => showView("timeline"));
  $("view-year").addEventListener("click", () => { showView("year"); renderYear(); });
  $("year-form").addEventListener("submit", e => {
    e.preventDefault();
    const r = readYearForm();
    Y.error = r.error || null;
    if (!r.error) { Y.from = r.from; Y.to = r.to; if (r.realm) Y.realm = r.realm; }
    syncYearUrl(); renderYear();
  });
  document.querySelectorAll("#year-form .examples button").forEach(b => b.addEventListener("click", () => {
    $("year-from").value = b.dataset.from; $("year-to").value = b.dataset.to || "";
    $("year-form").requestSubmit();
  }));
  $("map-selected").addEventListener("click", () => setMapMode("selected"));
  $("map-everyone").addEventListener("click", () => setMapMode("everyone"));

  const chart = $("chart");
  chart.addEventListener("scroll", updateOverviewWindow, { passive: true });
  let wheelAcc = 0;
  chart.addEventListener("wheel", e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) < 80) return;
    const r = chart.getBoundingClientRect();
    setZoom(S.zoom + (wheelAcc < 0 ? 1 : -1), { x: e.clientX - r.left, y: e.clientY - r.top });
    wheelAcc = 0;
  }, { passive: false });
  chart.addEventListener("keydown", e => {
    if (e.target !== chart) return;
    if (e.key === "+" || e.key === "=") setZoom(S.zoom + 1);
    if (e.key === "-") setZoom(S.zoom - 1);
  });

  const ov = $("overview");
  let dragging = false;
  ov.addEventListener("pointerdown", e => { dragging = true; ov.setPointerCapture(e.pointerId); overviewJump(e); });
  ov.addEventListener("pointermove", e => { if (dragging) overviewJump(e); });
  ov.addEventListener("pointerup", () => { dragging = false; });
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { renderOverview(); }, 150); });
}

async function init() {
  wire();
  const { source, raw, error } = await loadData();
  S.db = indexData(raw); S.source = source;
  const src = $("source");
  src.className = source === "live" ? "live" : "";
  src.innerHTML = "";
  src.append(h("i", { class: "dot" }), source === "live" ? "Live from Supabase" : "Snapshot of 5 Oct 2026");
  if (error) src.title = `Live data unavailable: ${error}`;
  let params = new URLSearchParams();
  try { params = new URLSearchParams(location.search); } catch (e) {}
  // The timeline is always drawn first (while visible, so it can measure itself); ?view=year then switches over.
  S.viewMode = "timeline";
  renderCats();
  run(params.get("q") || "");
  if (params.get("view") === "year") {
    $("year-from").value = params.get("y") || ""; $("year-to").value = params.get("to") || "";
    Y.realm = params.get("realm") || null;
    showView("year");
    if ($("year-from").value) $("year-form").requestSubmit(); else renderYear();
  }
}

init();
})();
