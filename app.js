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
    try {
      const rows = await Promise.all(TABLES.map(t =>
        fetch(`${c.supabaseUrl}/rest/v1/${t}?select=*`, { headers }).then(r => {
          if (!r.ok) throw new Error(`${t}: HTTP ${r.status}`);
          return r.json();
        })));
      const raw = Object.fromEntries(TABLES.map((t, i) => [t, rows[i]]));
      if (!raw.entities.length) throw new Error("no rows returned (check read policies)");
      return { source: "live", raw };
    } catch (e) {
      return { source: "snapshot", raw: window.HISTORY_SNAPSHOT || {}, error: e.message };
    }
  }
  return { source: "snapshot", raw: window.HISTORY_SNAPSHOT || {}, error: c.supabaseUrl ? "no publishable key in config.js" : null };
}

function indexData(raw) {
  const people = raw.entities || [], rels = raw.relationships || [], events = raw.events || [];
  const ep = raw.event_people || [], places = raw.places || [], pp = raw.person_places || [];
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
  return { people, rels, events, ep, places, pp, byId, eventById, placeById, parentLinks, spouseLinks,
    parentsOf, childrenOf, spousesOf, marriedIn, marriageYear, startOf, endOf, eventsOf, peopleInEvent, placesOfPerson, neighbours };
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
const COMMON_REGIONS = ["italy","france","england","spain","germany","scotland","wales","ireland","normandy","flanders","rome","venice","florence","milan","naples","sicily","papal states","portugal","netherlands","austria","burgundy","aquitaine","brittany","london","paris","jerusalem","byzantium","constantinople","holy roman empire"];
const STOP = new Set("a an and or the of in on at to for from with who were was is are during time times all show me see view overlap overlapping between era period age around circa c about people persons".split(" "));

function parseQuery(text, db) {
  const f = { raw: text, from: null, to: null, types: new Set(), regions: [], missingRegions: [], focus: null, ignored: [] };
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

  // Regions: anything the places table knows, plus common region names.
  const known = new Map();
  db.places.forEach(p => [p.name, p.historical_name, p.region, p.modern_country].forEach(v => { if (v && v.length > 2) known.set(v.toLowerCase(), v); }));
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
  return f.from == null && !f.types.size && !f.regions.length && !f.missingRegions.length && f.focus == null;
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
  if (f.regions.length || f.missingRegions.length) {
    const pool = new Set(people.map(p => p.id));
    const hit = new Set(people.filter(p => db.placesOfPerson(p.id).some(pl => placeMatches(pl, f.regions))).map(p => p.id));
    // Include close family of matched people, so sparse place data doesn't hide relatives.
    [...hit].forEach(id => db.neighbours(id).forEach(n => { if (pool.has(n.id)) hit.add(n.id); }));
    people = people.filter(p => hit.has(p.id));
  }
  const shown = new Set(people.map(p => p.id));
  let events = db.events.filter(e => Number.isFinite(e.start_year));
  if (f.from != null) events = events.filter(e => e.start_year <= f.to && (e.end_year ?? e.start_year) >= f.from);
  if (f.regions.length || f.missingRegions.length) events = events.filter(e => placeMatches(db.placeById[e.place_id], f.regions) || db.peopleInEvent(e.id).some(x => shown.has(x.person.id)));
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
  selected: null, mapMode: "selected",
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
  if (f.from != null) box.append(chip("Years", f.from === f.to ? `alive in ${fmtYear(f.from)}` : fmtSpan(f.from, f.to), () => rerun(() => { f.from = f.to = null; })));
  f.types.forEach(t => box.append(chip("Who", TYPE_LABEL[t] || t, () => rerun(() => f.types.delete(t)))));
  f.regions.forEach(r => box.append(chip("Where", r, () => rerun(() => { f.regions = f.regions.filter(x => x !== r); }))));
  f.missingRegions.forEach(r => box.append(chip("Where", r, () => rerun(() => { f.missingRegions = f.missingRegions.filter(x => x !== r); }))));
  if (f.focus != null) box.append(chip("Around", S.db.byId[f.focus].name, () => rerun(() => { f.focus = null; })));
  S.view.warnings.forEach(w => box.append(h("span", { class: "chip warn", text: w })));
  if (f.ignored.length) box.append(h("span", { class: "chip warn", text: `Not understood: ${f.ignored.join(" ")}` }));
}

function describe(f) {
  const parts = [];
  if (f.focus != null) parts.push(S.db.byId[f.focus].name);
  parts.push(...f.regions, ...f.missingRegions);
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

const colorFor = t => t === "Nobility" ? "var(--weld)" : t === "Royalty" ? "var(--woad)" : "var(--ochre)";
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

  const NAMES_H = Z.names === "full" ? 62 : Z.names === "short" ? 30 : 8;
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

  // Events lane
  if (evShown.length) {
    if (Z.names !== "none") el("text", { x: 8, y: TOP - 10, class: "dates" }, svg).textContent = "EVENTS";
    let lastY = -Infinity;
    evShown.forEach(e => {
      const yy = y(e.start_year);
      const gapNeeded = Z.names === "full" ? 30 : 16;
      const ly = Math.max(yy, lastY + gapNeeded); lastY = ly;
      el("line", { x1: LANEW - 6, x2: W - 6, y1: yy, y2: yy, class: "event-line" }, svg);
      const g = el("g", { class: "event", tabindex: 0, role: "button", "aria-label": `${e.name}, ${fmtYear(e.start_year)}` }, svg);
      el("title", {}, g).textContent = `${e.name} (${e.start_date ? fmtDate(e.start_date) : fmtYear(e.start_year)})`;
      if (Z.names === "none") {
        el("path", { d: `M${LANEW - 18},${yy - 5} l5,5 l-5,5 l-5,-5 Z`, fill: "var(--madder)" }, g);
        el("rect", { x: 2, y: yy - 9, width: LANEW - 6, height: 18, class: "hit" }, g);
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
    el("title", {}, g).textContent = `${p.name} (${fmtSpan(p.birth_year, p.death_year)})`;
    if (Z.names === "full") {
      const i = p.name.indexOf(" of ");
      const parts = i > 0 ? [p.name.slice(0, i), p.name.slice(i + 1)] : [p.name];
      parts.forEach((line, k) => el("text", { x: cx, y: TOP - 46 + k * 16 + (parts.length === 1 ? 16 : 0), "text-anchor": "middle", class: "name" }, g).textContent = line);
      el("text", { x: cx, y: TOP - 12, "text-anchor": "middle", class: "dates" }, g).textContent = fmtSpan(p.birth_year, p.death_year);
    } else if (Z.names === "short") {
      const short = p.name.split(" of ")[0];
      el("text", { x: cx, y: TOP - 12, "text-anchor": "middle", class: "name", style: "font-size:11px" }, g).textContent = short.length > 9 ? short.slice(0, 8) + "…" : short;
    }
    const color = colorFor(p.type);
    const top = y(s ?? y0), hgt = Math.max(2, y(d ?? s ?? y0) - top);
    if (inLaw) el("rect", { x: cx - Z.bar / 2 + .75, y: top, width: Z.bar - 1.5, height: hgt, rx: 3, fill: color, "fill-opacity": .22, stroke: color, "stroke-width": 1.5, "stroke-dasharray": p.birth_year == null ? "4 3" : null, class: "bar" }, g);
    else el("rect", { x: cx - Z.bar / 2, y: top, width: Z.bar, height: hgt, rx: 3, fill: color, class: "bar" }, g);
    el("rect", { x: cx - Z.col / 2 + 3, y: LANE_H + 4, width: Z.col - 6, height: Math.max(top + hgt, TOP) - LANE_H + 4, rx: 4, class: "hit" }, g);
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
    el("rect", { x: cx * sx - 1, y: L.y(s) * sy, width: Math.max(2, L.Z.bar * sx), height: Math.max(2, (L.y(d) - L.y(s)) * sy), fill: colorFor(p.type), opacity: S.db.marriedIn.has(p.id) ? .45 : 1 }, svg);
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
    ["Obsidian note", obsidianLink(p.obsidian_link)],
  ];
  const dl = h("dl");
  rows.forEach(([k, v]) => dl.append(h("dt", { text: k }), h("dd", {}, ...(Array.isArray(v) ? v : [v]))));
  box.append(
    h("div", { class: "kind", style: `color:${colorFor(p.type)}`, text: (p.type || "Person") + (db.marriedIn.has(id) ? " · married in" : "") }),
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
   ["Where", place ? place.name + (place.historical_name ? ` (then ${place.historical_name})` : "") : (e.location || "Unknown")],
   ["People", joinNodes(db.peopleInEvent(id).map(x => personLink(x.person, x.role ? ` (${x.role})` : "")), "None linked")],
   ["Visit today", e.visitable_today ? (e.visit_site || "Yes") : "No"],
   ["Obsidian note", obsidianLink(e.obsidian_link)]]
    .forEach(([k, v]) => dl.append(h("dt", { text: k }), h("dd", {}, ...(Array.isArray(v) ? v : [v]))));
  box.append(h("div", { class: "kind", style: "color:var(--madder)", text: e.type || "Event" }), h("h2", { text: e.name }), dl);
  drawMap();
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
    if (s.length) routes = [{ person: p, stops: s, color: colorFor(p.type) }]; else emptyMsg = `No places recorded for ${p.name} yet.`;
  } else emptyMsg = "Select a person or event to see their places.";

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
        const label = numbered ? items.map(s => s.n).join(",") : "";
        const rr = numbered ? (label.length > 1 ? 10 : 8) : 5;
        el("circle", { cx: px, cy: py, r: rr, fill: r.color, stroke: "var(--land)", "stroke-width": 1.5 }, g);
        if (numbered) el("text", { x: px, y: py + 3.5, "text-anchor": "middle", class: "stop-num" }, g).textContent = label;
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
    routes.forEach(r => r.stops.forEach(s => {
      const pl = s.place;
      list.append(h("li", {},
        h("span", { class: "n", style: `background:${r.color}`, text: s.n }),
        h("div", {},
          h("div", {}, h("span", { class: "yrs", text: (s.date ? fmtDate(s.date) : fmtYear(s.year) ?? "") + "  " }), h("span", { class: "what", text: s.what })),
          h("div", { class: "where", text: pl.name + (pl.historical_name ? ` (then ${pl.historical_name})` : "") + (pl.region ? `, ${pl.region}` : "") }),
          pl.visitable_today ? h("div", { class: "visit", text: "◆ Visit: " + (pl.visit_site || pl.name) }) : null)));
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

/* ------------------------------------------------------------------ wiring */

function setGroup(g) {
  S.group = g; store.set("group", g);
  $("group-family").setAttribute("aria-pressed", g === "family");
  $("group-type").setAttribute("aria-pressed", g === "type");
  render(); updateOverviewWindow();
}

function wire() {
  $("ask-form").addEventListener("submit", e => { e.preventDefault(); run($("q").value.trim(), { pushTrail: true }); });
  $("show-all").addEventListener("click", () => run("", { pushTrail: true }));
  document.querySelectorAll(".examples button").forEach(b => b.addEventListener("click", () => run(b.dataset.q, { pushTrail: true })));
  $("group-family").addEventListener("click", () => setGroup("family"));
  $("group-type").addEventListener("click", () => setGroup("type"));
  $("layer-spouses").checked = S.layers.spouses;
  $("layer-events").checked = S.layers.events;
  $("layer-spouses").addEventListener("change", e => { S.layers.spouses = e.target.checked; store.set("spouses", S.layers.spouses); render(); updateOverviewWindow(); });
  $("layer-events").addEventListener("change", e => { S.layers.events = e.target.checked; store.set("events", S.layers.events); render(); updateOverviewWindow(); });
  $("zoom-in").addEventListener("click", () => setZoom(S.zoom + 1));
  $("zoom-out").addEventListener("click", () => setZoom(S.zoom - 1));
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
  let q = "";
  try { q = new URLSearchParams(location.search).get("q") || ""; } catch (e) {}
  run(q);
}

init();
})();
