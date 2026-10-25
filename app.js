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
      [raw.titles, raw.realms, raw.sources, raw.source_links, raw.artworks, raw.artwork_people, raw.artwork_places, raw.artwork_events, raw.external_links, raw.event_places, raw.museums, raw.realm_countries] = await Promise.all(
        ["titles", "realms", "sources", "source_links", "artworks", "artwork_people", "artwork_places", "artwork_events", "external_links", "event_places", "museums", "realm_countries"].map(optional));
      return { source: "live", raw };
    } catch (e) {
      return { source: "snapshot", raw: window.HISTORY_SNAPSHOT || {}, error: e.message };
    }
  }
  return { source: "snapshot", raw: window.HISTORY_SNAPSHOT || {}, error: c.supabaseUrl ? "no publishable key in config.js" : null };
}

function indexData(raw) {
  // Films (artworks of kind "film") join the events: on the timeline's events lane, in the Year view and on every
  // place they were filmed at (artwork_places role "filmed"). Their ids are "f" + the artwork id, so they never
  // clash with an event's, and their directors (role "creator") take part in them like people in an event.
  // What a film shows (role "depicts": the places it is set in, the events it portrays) is kept apart, in
  // shownIds and shownEventIds, so "Filmed at" and "Films shot here" stay about where it was shot.
  const filmed = raw.artwork_places || [], filmEvents = raw.artwork_events || [];
  const films = (raw.artworks || []).filter(w => w.kind === "film" && Number.isFinite(w.start_year)).map(w => {
    const at = filmed.filter(x => x.artwork_id === w.id && x.role === "filmed").map(x => x.place_id);
    const shownIds = filmed.filter(x => x.artwork_id === w.id && x.role === "depicts").map(x => x.place_id);
    const shownEventIds = filmEvents.filter(x => x.artwork_id === w.id && x.role === "depicts").map(x => x.event_id);
    const portrayedIds = (raw.artwork_people || []).filter(x => x.artwork_id === w.id && x.role === "subject").map(x => x.entity_id);
    return { id: "f" + w.id, artId: w.id, key: w.key, name: w.name, type: "Film", film: true, start_year: w.start_year, end_year: null,
      estimated: w.estimated, prominence: w.prominence, note: w.note, obsidian_link: w.obsidian_link, place_id: at[0] ?? null, placeIds: at,
      shownIds, shownEventIds, portrayedIds };
  });
  const filmIds = new Set(films.map(f => f.id));
  const directors = (raw.artwork_people || []).filter(x => x.role === "creator" && filmIds.has("f" + x.artwork_id))
    .map(x => ({ event_id: "f" + x.artwork_id, entity_id: x.entity_id, role: "director" }));
  // An event's other places (sql/016: the venues of an Olympics), each with a role and a note; placeIds lists them all.
  const venuesOf = {};
  (raw.event_places || []).forEach(x => (venuesOf[x.event_id] ||= []).push(x));
  (raw.events || []).forEach(e => {
    e.venues = venuesOf[e.id] || [];
    if (e.venues.length) e.placeIds = [...new Set([e.place_id, ...e.venues.map(v => v.place_id)].filter(v => v != null))];
  });
  const people = raw.entities || [], byIdEarly = Object.fromEntries(people.map(p => [p.id, p])), rels = raw.relationships || [], events = [...(raw.events || []), ...films];
  const ep = [...(raw.event_people || []), ...directors], places = raw.places || [], pp = raw.person_places || [], allTitles = raw.titles || [];
  // Military titles (commands held for a time: Eisenhower's wartime posts) belong to their holder's life, not to who ruled where,
  // so db.titles keeps reigns and offices only and titlesOf gives a person both.
  const titles = allTitles.filter(t => t.kind !== "military");
  allTitles.forEach(t => { if (t.kind === "military" && byIdEarly[t.entity_id]) byIdEarly[t.entity_id].served = true; });
  const byId = byIdEarly;
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
  // sql/021: a parent link tradition claims but no record proves; doubtOf gives it (with its note) or null.
  const doubtOf = (parentId, childId) => parentLinks.find(r => r.source_id === parentId && r.target_id === childId && r.uncertain) || null;
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
  const eventsAt = id => events.filter(e => e.place_id === id || e.placeIds?.includes(id));
  const momentsAt = id => pp.filter(x => x.place_id === id).map(x => ({ person: byId[x.entity_id], role: x.role, year: x.year })).filter(x => x.person);
  // Films set at a place, and films about an event (role "depicts"), oldest first.
  const filmsSetAt = id => films.filter(f => f.shownIds.includes(id)).sort((a, b) => byYear(a.start_year, b.start_year));
  const filmsAbout = id => films.filter(f => f.shownEventIds.includes(id)).sort((a, b) => byYear(a.start_year, b.start_year));
  // Films that portray a real person (role "subject"), and the people a film portrays.
  const filmsPortraying = id => films.filter(f => f.portrayedIds.includes(id)).sort((a, b) => byYear(a.start_year, b.start_year));
  const portrayedIn = f => (f.portrayedIds || []).map(id => byId[id]).filter(Boolean);
  return { people, rels, events, ep, places, pp, byId, eventById, placeById, parentLinks, spouseLinks,
    parentsOf, childrenOf, spousesOf, doubtOf, marriedIn, marriageYear, startOf, endOf, eventsOf, peopleInEvent, placesOfPerson, neighbours,
    eventsAt, momentsAt, titles, filmsSetAt, filmsAbout, filmsPortraying, portrayedIn,
    regionOf: Object.fromEntries((raw.realms || []).map(r => [r.name, r.region])),
    countryOf: Object.fromEntries((raw.realms || []).map(r => [r.name, r.modern_country])),
    // When each realm existed, and the countries it covers today (sql/017), each with its own years when they differ.
    // A realm with no rows yet counts as covering its main country for its whole span.
    realmInfo: Object.fromEntries((raw.realms || []).map(r => [r.name, { start: r.start_year, end: r.end_year,
      countries: (raw.realm_countries || []).filter(c => c.realm_id === r.id).map(c => ({ country: c.modern_country, start: c.start_year, end: c.end_year, note: c.note })) }])),
    // Every realm a title names (England, Byzantine Empire, Kievan Rus'), for searching and focusing.
    realmNames: [...new Set([...titles.map(t => t.realm), ...(raw.realms || []).map(r => r.name)])].filter(Boolean),
    titlesOf: id => allTitles.filter(t => t.entity_id === id).sort((a, b) => byYear(a.start_year, b.start_year)),
    // Who held each of a person's titles just before and after them: that title's holders in date order, as the
    // Year view lists them. A ruler with two spells (Æthelred) gets the one before the first and the one after the last.
    // Military commands are left out.
    successionOf: id => [...new Set(titles.filter(t => t.entity_id === id).sort((a, b) => byYear(a.start_year, b.start_year)).map(t => t.title))]
      .map(name => {
        const line = titles.filter(t => t.title === name)
          .sort((x, y) => byYear(x.start_year, y.start_year) || (x.start_date || "").localeCompare(y.start_date || ""));
        const first = line.findIndex(t => t.entity_id === id), last = line.findLastIndex(t => t.entity_id === id);
        const prev = line.slice(0, first).reverse().find(t => t.entity_id !== id), next = line.slice(last + 1).find(t => t.entity_id !== id);
        return { title: name, prev: prev && byId[prev.entity_id], next: next && byId[next.entity_id] };
      }),
    // Artworks a person made (artwork_people role "creator").
    worksBy: id => {
      const byId = Object.fromEntries((raw.artworks || []).map(w => [w.id, w]));
      return (raw.artwork_people || []).filter(x => x.entity_id === id && x.role === "creator").map(x => byId[x.artwork_id]).filter(Boolean);
    },
    // Paintings and other works with a picture, for the person panel: a person's own works (creator) and works that show them (subject),
    // best first. Pictures are links to a museum's open collection (see sql/011, sql/014), never copied.
    museumById: Object.fromEntries((raw.museums || []).map(m => [m.id, m])),
    picturedWorks: (id, role) => {
      const byWork = Object.fromEntries((raw.artworks || []).map(w => [w.id, w]));
      return (raw.artwork_people || []).filter(x => x.entity_id === id && x.role === role).map(x => byWork[x.artwork_id])
        .filter(w => w && w.kind !== "film" && w.image_thumb).sort((a, b) => (b.prominence ?? 3) - (a.prominence ?? 3) || byYear(a.start_year, b.start_year));
    },
    // Where a record's facts come from (usually its Wikipedia article): record type + key -> sources.
    sourcesFor: (type, key) => {
      const byId = Object.fromEntries((raw.sources || []).map(s => [s.id, s]));
      return (raw.source_links || []).filter(l => l.record_type === type && l.record_key === key).map(l => byId[l.source_id]).filter(Boolean);
    },
    // Where a record has an entry in another database (sql/015): the entertainment database for a film, and so on.
    externalFor: (type, key) => (raw.external_links || []).filter(l => l.record_type === type && l.record_key === key),
    // Raw artwork tables for the Explore page's Work card. Films are events on the timeline (above), but in Explore
    // they are works: filmArtworks are added to the Work card's index there.
    artworks: (raw.artworks || []).filter(w => w.kind !== "film"), filmArtworks: (raw.artworks || []).filter(w => w.kind === "film"),
    artworkPeople: raw.artwork_people || [],
    artworkPlaces: raw.artwork_places || [], museums: raw.museums || [] };
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
  [/\b(mayors?|governors?|presidents?|politicians?|government)\b/gi, "Government"],
  [/\b(patrons?|benefactors?|philanthropists?)\b/gi, "Patron"],
  [/\b(notables?|notable people)\b/gi, "Notable"],
  [/\b(military|soldiers?|generals?|admirals?|commanders?|marshals?)\b/gi, "Military"],
];
const TYPE_LABEL = { Royalty: "royalty", Nobility: "nobility", Clergy: "popes and clergy", Artist: "painters and artists", Writer: "writers", Composer: "composers", Scholar: "scholars and inventors", Government: "mayors and officials", Patron: "patrons and benefactors", Notable: "notable people", Military: "soldiers and commanders" };
// Who to show: the groups behind the buttons under the title. A person shows if any group they belong to is on.
// Architects are a role, not a type (Wren is typed Artist), so groups match roles as well as types.
const hasRole = (p, re) => (p.roles || []).some(r => re.test(r));
// Artists are those with an artistic role (an Artist-typed astronomer-architect like Wren is an architect, not an artist).
const ARCHITECT = /architect/i, ART_ROLE = /paint|miniatur|engrav|etch|sculpt|carv|goldsmith|illustrat|draughts|print|(?<!landscape )designer|film|actor|actress|animat|cinematograph/i;
const CATS = [
  // Each group has a colour: its button and the lifespan bars of its people share it, so the buttons are the colour key.
  { key: "royalty", label: "Royalty", color: "var(--woad)", test: p => p.type === "Royalty" },
  { key: "nobility", label: "Nobility", color: "var(--weld)", test: p => p.type === "Nobility" },
  { key: "clergy", label: "Clergy", color: "var(--stitch)", test: p => p.type === "Clergy" },
  { key: "government", label: "Government", color: "var(--verdigris)", test: p => p.type === "Government" },
  { key: "artists", label: "Artists", color: "var(--ochre)", test: p => p.type === "Artist" && (!(p.roles || []).length || hasRole(p, ART_ROLE)) },
  { key: "architects", label: "Architects", color: "var(--walnut)", test: p => hasRole(p, ARCHITECT) },
  { key: "writers", label: "Writers", color: "var(--lichen)", test: p => p.type === "Writer" },
  { key: "composers", label: "Composers", color: "var(--rose)", test: p => p.type === "Composer" },
  { key: "scholars", label: "Scholars", color: "var(--slate)", test: p => p.type === "Scholar" },
  { key: "patrons", label: "Patrons", color: "var(--indigo)", test: p => p.type === "Patron" },
  // Soldiers, and anyone who held a military title: Eisenhower is Government by type, and shows here too for his commands.
  { key: "military", label: "Military", color: "var(--iron)", test: p => p.type === "Military" || !!p.served },
  // Real people known for one story rather than an office or a body of work: Schindler, Desmond Doss, Al Capone.
  { key: "notable", label: "Notable people", color: "var(--sage)", test: p => p.type === "Notable" },
];
const catsOf = p => { const ks = CATS.filter(c => c.test(p)).map(c => c.key); return ks.length ? ks : ["other"]; };
// Fame: artists, writers, composers, scholars and notable people are ranked by how many Wikipedia language editions cover them (sitelinks).
// The cut-off hides the long tail by default; rulers and officials are never hidden by it. Whoever you searched for or selected always shows.
const FAME = [
  { key: "icons", label: "Icons", min: 150 },
  { key: "famous", label: "Famous", min: 100 },
  { key: "known", label: "Well known", min: 60 },
  { key: "all", label: "Everyone", min: 0 },
];
const FAME_TYPES = ["Artist", "Writer", "Composer", "Scholar", "Notable"];
const fameMin = () => (FAME.find(f => f.key === S.fame) || FAME[2]).min;
const fameFiltering = () => fameMin() > 0;
const fameOn = p => !p || !FAME_TYPES.includes(p.type) || fameMin() === 0 || p.sitelinks == null || p.sitelinks >= fameMin() || p.id === S.selected || p.id === S.filter?.focus;
const catsFiltering = () => S.catsOff.size > 0 || fameFiltering();
const catOn = p => !!p && catsOf(p).some(k => !S.catsOff.has(k)) && fameOn(p);
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
  const vals = [place.name, place.historical_name, place.city, place.region, place.modern_country].filter(Boolean).map(v => v.toLowerCase());
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
    const ruled = p => db.titlesOf(p.id).some(t => t.kind !== "military" && f.realms.includes(t.realm) && (f.from == null || overlaps(t.start_year, t.end_year, f.from, f.to)));
    const hit = new Set(people.filter(p => (f.regions.length && db.placesOfPerson(p.id).some(pl => placeMatches(pl, f.regions))) || (f.realms.length && ruled(p))).map(p => p.id));
    // Include close family of matched people, so sparse place data doesn't hide relatives.
    [...hit].forEach(id => db.neighbours(id).forEach(n => { if (pool.has(n.id)) hit.add(n.id); }));
    people = people.filter(p => hit.has(p.id));
  }
  if (catsFiltering()) people = people.filter(catOn);
  const shown = new Set(people.map(p => p.id));
  let events = db.events.filter(e => Number.isFinite(e.start_year));
  // A film's only person is its director, who is rarely in view: it stays unless the director's group is switched off.
  if (catsFiltering()) events = events.filter(e => { const ppl = db.peopleInEvent(e.id); return !ppl.length
    || ppl.some(x => e.film ? catsOf(x.person).some(k => !S.catsOff.has(k)) : shown.has(x.person.id)); });
  if (f.from != null) events = events.filter(e => e.start_year <= f.to && (e.end_year ?? e.start_year) >= f.from);
  // An event (or film) stays if it happened in a searched region, or in a searched realm's own city or country
  // (so "Los Angeles" keeps the films shot there, and "Scotland" the films set there), or if someone in view took part.
  const where = [...f.regions, ...f.realms];
  if (f.regions.length || f.missingRegions.length || f.realms.length) events = events.filter(e =>
    [...(e.placeIds || [e.place_id]), ...(e.shownIds || [])].some(id => placeMatches(db.placeById[id], where)) || db.peopleInEvent(e.id).some(x => shown.has(x.person.id)));
  if (f.focus != null || f.types.size) events = events.filter(e => db.peopleInEvent(e.id).some(x => shown.has(x.person.id)));
  return { people, events, warnings };
}

/* ------------------------------------------------------------------ lanes */

const TYPE_ORDER = ["Royalty", "Nobility", "Clergy", "Government", "Artist", "Writer", "Composer", "Scholar", "Patron", "Military", "Notable"];

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
  fame: store.get("fame", "known"),
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
// Who heads a realm for the Explore page (its ruler fallback and "part of" line): sovereigns, and elected heads of state.
// Modern heads of state: presidents, the Führer, party leaders, chairmen of a government. "President of" a chamber, council
// or society (the Reichstag, the Privy Council) is neither a head of state nor of government.
const NOT_HEAD = /\b(reichstag|privy council|house of peers|legislative yuan|executive yuan|red cross|war college|imperial rule)\b/i;
const MODERN_HEAD = t => !NOT_HEAD.test(t) && /^(president of|führer of|chief of the .*state|general secretary of|chairman of the (nationalist|central people's|provisional) government|chairman of the people's republic)\b/i.test(t);
// Heads of government, and leaders of a movement or a government in exile (de Gaulle's Free France), who rank below a
// sitting head of state (Pétain, 1940-1944).
const HEAD_OF_GOVERNMENT = t => /^(prime minister|premier|chancellor|leader) of\b/i.test(t);
const HEAD_OF_STATE = t => SOVEREIGN.test(t) || MODERN_HEAD(t);
// 0 = sovereign, 1 = co-ruler of one (Byzantine co-emperor, co-king), 2 = a modern head of state, 3 = a head of
// government (prime minister, premier, chancellor), 4 = everything else (dukes, regents, offices, commands).
const titleRank = t => /\bco-/i.test(t) ? 1 : SOVEREIGN.test(t) ? 0 : MODERN_HEAD(t) ? 2 : HEAD_OF_GOVERNMENT(t) ? 3 : 4;
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
// Offices (a column, not a crown): officials, and the roles notable people hold, such as First Lady.
const isOffice = p => p?.type === "Government" || p?.type === "Notable" || p?.type === "Military";
// A military title: a command held for a time (sql/018), shown as "Commands" rather than among titles and offices.
const isCommand = t => t?.kind === "military";
function columnPath(x, y, w = 12) {
  const h = w * .75, X = f => x + w * f, Y = f => y + h * f;
  return `M${X(.08)},${y} H${X(.92)} V${Y(.2)} H${X(.74)} V${Y(.8)} H${x + w} V${y + h} H${x} V${Y(.8)} H${X(.26)} V${Y(.2)} H${X(.08)} Z`;
}
const titleMarkPath = (p, x, y, w) => (isOffice(p) ? columnPath : crownPath)(x, y, w);
// The same mark as a standalone inline icon for HTML text (Year view, side panel).
function crownIcon(label = "Held a title", p = null) {
  const svg = el("svg", { viewBox: "0 0 12 10", width: 13, height: 11, class: "crown-icon", role: "img", "aria-label": label });
  el("path", { d: titleMarkPath(p, 0, .5, 12) }, svg);
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
        el("path", { d: e.film ? `M${LANEW - 23},${yy - 4} h10 v8 h-10 Z M${LANEW - 21},${yy - 2} v4 M${LANEW - 15},${yy - 2} v4` : `M${LANEW - 18},${yy - 5} l5,5 l-5,5 l-5,-5 Z`,
          fill: "var(--madder)", class: (e.film ? "film-mark " : "") + (Z.names === "none" ? "" : "event-mark") }, g);
        // Beside labels, the marker's click area is just the marker so it can't cover a label.
        if (Z.names === "none") el("rect", { x: 2, y: yy - 9, width: LANEW - 6, height: 18, class: "hit" }, g);
        else el("rect", { x: LANEW - 28, y: yy - 9, width: 20, height: 18, class: "hit" }, g);
      } else {
        if (ly !== yy) el("path", { d: `M${LANEW - 10},${ly - 4} L${LANEW - 6},${yy}`, class: "event-line" }, svg);
        const name = Z.names === "short" && e.name.length > 16 ? e.name.slice(0, 15) + "…" : e.name;
        el("text", { x: LANEW - 12, y: ly - 4, "text-anchor": "end", class: "event-label" }, g).textContent = name;
        if (Z.names === "full") el("text", { x: LANEW - 12, y: ly + 9, "text-anchor": "end", class: "event-sub" }, g).textContent =
          (e.film ? "Film · " : "") + (e.start_date ? fmtDate(e.start_date) : fmtYear(e.start_year)) + (e.visitable_today ? " · ◆ visitable" : "");
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
    el("title", {}, g).textContent = `${p.name} (${fmtSpan(p.birth_year, p.death_year)})` + titles.map(t => `\n${isOffice(p) ? "▪" : "♛"} ${t.title}, ${reignSpan(t)}`).join("");
    // A crown sits above the name of anyone who held a title (in the requested years, if the request names some).
    const head = headlineTitle(p.id, S.filter?.from, S.filter?.to);
    const crown = (cy, w) => el("path", { d: titleMarkPath(p, cx - w / 2, cy, w), class: "crown" + (head.title.disputed ? " disputed" : "") }, g);
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
      el("rect", { x: cx + Z.bar / 2 + 2 + k * 5, y: ry, width: 3, height: rh, rx: 1.5, class: "reign" + (t.disputed ? " disputed" : "") + (t.kind === "military" ? " military" : "") }, g);
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
// "(traditional, unproven)" after a parent or child whose link no record proves, with the reason on hover.
const doubtTag = rel => rel ? h("span", { class: "doubt", title: rel.note || "Claimed by tradition; no record proves it", text: " (traditional, unproven)" }) : null;
const joinNodes = (nodes, empty = "None recorded") => nodes.length ? nodes.flatMap((n, i) => i ? [", ", n] : [n]) : [empty];

// A person's family as labelled rows, shared by the side panel and the Explore Person card; `link` draws a person.
// Children split into Sons and Daughters by `sex` (sql/020); those without it stay Children. Empty child rows are
// left out, but a person with no children recorded at all says so.
function familyRows(id, link) {
  const db = S.db, kids = db.childrenOf(id);
  const kid = k => h("span", {}, link(k, k.birth_year != null || k.death_year != null ? ` (${fmtSpan(k.birth_year, k.death_year)})` : ""), doubtTag(db.doubtOf(id, k.id)));
  const split = [["Sons", kids.filter(k => k.sex === "male")], ["Daughters", kids.filter(k => k.sex === "female")], ["Children", kids.filter(k => !k.sex)]]
    .filter(([, ks]) => ks.length).map(([label, ks]) => [label, joinNodes(ks.map(kid))]);
  return [
    ["Parents", joinNodes(db.parentsOf(id).map(x => h("span", {}, link(x), doubtTag(db.doubtOf(x.id, id)))))],
    ["Spouses", joinNodes(db.spousesOf(id).map(s => link(s.person, s.year != null ? ` (m. ${fmtYear(s.year)})` : "")))],
    ...(split.length ? split : [["Children", joinNodes([])]]),
  ];
}
// One line per title: "King of England" over "← Henry VII · Edward VI →".
const successionLine = (s, link) => h("span", { class: "succ" }, h("span", { class: "succ-t", text: s.title }),
  h("span", {}, ...(s.prev ? ["← ", link(s.prev)] : ["none recorded"]), " · ", ...(s.next ? [link(s.next), " →"] : ["none recorded"])));

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
    // Reigns and offices first, then military commands in a row of their own (iron, like their strip on the timeline).
    ...[db.titlesOf(id).filter(t => !isCommand(t)), db.titlesOf(id).filter(isCommand)].filter(ts => ts.length).map(ts => [
      isCommand(ts[0]) ? h("span", {}, h("i", { class: "sw cmd-sw", "aria-hidden": "true" }), " Commands")
        : h("span", {}, crownIcon(isOffice(p) ? "Held an office" : "Held a title", p), isOffice(p) ? " Offices" : " Titles"),
      joinNodes(ts.map(t => h("button", { type: "button", class: "plink",
        title: isCommand(t) ? `What happened during ${reignSpan(t)}` : `Who else ruled during ${reignSpan(t)}`, onclick: () => openYear(t.start_year, t.end_year ?? t.start_year),
        text: `${t.title}${t.disputed ? " (disputed)" : ""}, ${reignSpan(t)}` })))]),
    ...(db.successionOf(id).length ? [["Succession", db.successionOf(id).map(s => successionLine(s, personLink))]] : []),
    ...familyRows(id, personLink),
    ["Events", joinNodes(db.eventsOf(id).map(x => eventLink(x.event, x.role ? ` (${x.role})` : "")), "None linked")],
    ...(db.filmsPortraying(id).length ? [["Portrayed in", joinNodes(db.filmsPortraying(id).map(f => eventLink(f, ` (${fmtYear(f.start_year)})`)))]] : []),
    ...externalRow("person", p.key),
    ["Sources", sourceLinks(db.sourcesFor("person", p.key))],
    ["Obsidian note", obsidianLink(p.obsidian_link)],
  ];
  const dl = h("dl");
  rows.forEach(([k, v]) => dl.append(h("dt", {}, k), h("dd", {}, ...(Array.isArray(v) ? v : [v]))));
  box.append(
    h("div", { class: "kind", style: `color:${colorFor(p)}`, text: (p.type || "Person") + (db.marriedIn.has(id) ? " · married in" : "") }),
    h("h2", { text: p.name }), ...(personPicture(p) || []), dl,
    ...workGallery(db.picturedWorks(id, "creator"), "Works in open museum collections", db),
    ...workGallery(db.picturedWorks(id, "subject"), "Shown in", db),
    h("button", { type: "button", class: "btn ghost", onclick: () => run(p.name, { pushTrail: true }), text: `Show ${p.name}'s family` })
  );
  drawMap();
}

// Pictures are links to Wikimedia Commons or a museum's open collection, never copies; each carries its credit and a link back.
// A picture that fails to load is dropped so the panel never shows a broken image.
function picture(src, alt, className) {
  const img = h("img", { src, alt, loading: "lazy", decoding: "async", referrerpolicy: "no-referrer", class: className || "" });
  img.addEventListener("error", () => { (img.closest("figure") || img).remove(); });
  return img;
}
function personPicture(p) {
  if (!p.image_thumb) return null;
  const credit = ["Wikimedia Commons", p.image_license].filter(Boolean).join(", ");
  return [h("figure", { class: "portrait" }, picture(p.image_thumb, `Picture from the Wikipedia article on ${p.name}`),
    h("figcaption", {}, p.image_page ? h("a", { class: "ext", href: p.image_page, target: "_blank", rel: "noopener", text: credit }) : credit))];
}
function workGallery(works, heading, db) {
  if (!works.length) return [];
  const shown = works.slice(0, 12);
  const grid = h("div", { class: "works" }, ...shown.map(w => {
    const m = db.museumById[w.museum_id], href = w.museum_url || w.image_page;
    const cap = [w.name, fmtYear(w.start_year)].filter(Boolean).join(", ");
    const fig = h("figure", {}, picture(w.image_thumb, w.name),
      h("figcaption", {}, cap, m ? h("span", { class: "where", text: m.name }) : ""));
    if (w.image_credit) fig.title = w.image_credit;
    return href ? h("a", { href, target: "_blank", rel: "noopener", class: "work", title: `${w.name}${m ? ` at ${m.name}` : ""} (opens the museum's page)` }, fig) : fig;
  }));
  return [h("h3", { class: "works-h", text: heading }), grid,
    ...(works.length > shown.length ? [h("p", { class: "hint", text: `${works.length - shown.length} more recorded.` })] : []),
    h("p", { class: "hint", text: "Pictures load from the museums' open collections (CC0 or public domain); each links to the museum's own page." })];
}

function selectEvent(id) {
  S.selected = { kind: "event", id };
  clearSel(); eventGroups[id]?.classList.add("sel");
  const db = S.db, e = db.eventById[id], place = db.placeById[e.place_id];
  const box = $("detail"); box.innerHTML = "";
  if (e.film) {
    const dl = h("dl");
    [["Released", (e.estimated ? "c. " : "") + fmtYear(e.start_year)],
     ["Directed by", joinNodes(db.peopleInEvent(id).map(x => personLink(x.person)), "Unknown")],
     ...(db.portrayedIn(e).length ? [["Portrays", joinNodes(db.portrayedIn(e).map(p => personLink(p)))]] : []),
     ...(e.shownIds.length ? [["Set in", joinNodes(e.shownIds.map(pid => db.placeById[pid]).filter(Boolean).map(pl => placeLink(pl)))]] : []),
     ...(e.shownEventIds.length ? [["Shows", joinNodes(e.shownEventIds.map(eid => db.eventById[eid]).filter(Boolean)
       .map(ev => eventLink(ev, ev.start_year != null ? ` (${fmtYear(ev.start_year)})` : "")))]] : []),
     ...(e.placeIds.length || !e.shownIds.length ? [["Filmed at", joinNodes(e.placeIds.map(pid => db.placeById[pid]).filter(Boolean).map(pl => placeLink(pl)), "None linked")]] : []),
     ...(e.note ? [["Note", e.note]] : []),
     ...externalRow("artwork", e.key),
     ["Sources", sourceLinks(db.sourcesFor("artwork", e.key))]]
      .forEach(([k, v]) => dl.append(h("dt", { text: k }), h("dd", {}, ...(Array.isArray(v) ? v : [v]))));
    box.append(h("div", { class: "kind", style: "color:var(--madder)", text: "Film" }), h("h2", { text: e.name }), dl);
    drawMap();
    return;
  }
  const dl = h("dl");
  [["Date", fmtDate(e.start_date) || fmtYear(e.start_year) || "Unknown"],
   ...(e.end_year != null && e.end_year !== e.start_year ? [["Ended", fmtYear(e.end_year)]] : []),
   ["Where", place ? placeLink(place, place.historical_name ? ` (then ${place.historical_name})` : "") : (e.location || "Unknown")],
   ...(e.venues?.length ? [[`Venues (${e.venues.length})`, joinNodes(e.venues.map(v => db.placeById[v.place_id]).map((pl, i) => pl && placeLink(pl, ` (${e.venues[i].note || e.venues[i].role})`)).filter(Boolean))]] : []),
   ["People", joinNodes(db.peopleInEvent(id).map(x => personLink(x.person, x.role ? ` (${x.role})` : "")), "None linked")],
   ...(db.filmsAbout(id).length ? [["Films about it", joinNodes(db.filmsAbout(id).map(f => eventLink(f, ` (${fmtYear(f.start_year)})`)))]] : []),
   ["Visit today", e.visitable_today ? (e.visit_site || "Yes") : "No"],
   ...externalRow("event", e.key),
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
  const here = db.eventsAt(id).sort((a, b) => byYear(a.start_year, b.start_year) || (a.start_date || "").localeCompare(b.start_date || ""));
  const events = here.filter(e => !e.film), films = here.filter(e => e.film);
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
    // At a venue, say what the event held here ("2028 Summer Olympics (2028: Swimming)").
    ["Events here", joinNodes(events.map(e => {
      const v = (e.venues || []).filter(x => x.place_id === id).map(x => x.note || x.role).join("; ");
      return eventLink(e, e.start_year != null || v ? ` (${[fmtYear(e.start_year), v].filter(Boolean).join(": ")})` : "");
    }), "None linked")],
    // Each film with who it portrays; films are split by semicolons, since the people are split by commas.
    ...(db.filmsSetAt(id).length ? [["Films set here", db.filmsSetAt(id).flatMap((e, i) => [i ? "; " : "", eventLink(e, ` (${fmtYear(e.start_year)})`),
      ...(db.portrayedIn(e).length ? [" · ", ...joinNodes(db.portrayedIn(e).map(p => personLink(p)))] : [])])]] : []),
    ...(films.length ? [["Films shot here", joinNodes(films.map(e => eventLink(e, ` (${fmtYear(e.start_year)})`)))]] : []),
    ["People", joinNodes(people.map(p => personLink(p)), "None linked")],
    ...nearbyRows(pl),
    ...(pl.note ? [["Note", pl.note]] : []),
    ...externalRow("place", pl.key),
    ["Sources", sourceLinks(db.sourcesFor("place", pl.key))],
    ["Obsidian note", obsidianLink(pl.obsidian_link)],
  ];
  const dl = h("dl");
  rows.forEach(([k, v]) => dl.append(h("dt", {}, k), h("dd", {}, ...(Array.isArray(v) ? v : [v]))));
  box.append(h("div", { class: "kind", style: "color:var(--ink)", text: cap(pl.kind) || "Place" }), h("h2", { text: pl.name }), dl,
    h("p", { class: "hint", text: "Everything that happened here is listed in date order under the map." }));
  drawMap();
  diningNearby(pl, dl);
}

// "Eat and drink nearby": asked live of the dining database (RouteWeaver's public nearby_dining API), never
// stored here. Only when config.js names it (HISTORY_CONFIG.dining = { url, key }) and the place has coordinates.
const diningOn = pl => { const c = (window.HISTORY_CONFIG || {}).dining; return !!(c?.url && c?.key && pl.lat != null && pl.lng != null); };
// One request per place per visit: the Explore page redraws its Place card often.
const diningCache = {};
function fetchDining(pl) {
  return diningCache[pl.id] ??= (async () => {
    const c = window.HISTORY_CONFIG.dining;
    const headers = { apikey: c.key, "Content-Type": "application/json" };
    if (!c.key.startsWith("sb_")) headers.Authorization = `Bearer ${c.key}`;
    const ask = () => fetch(`${c.url}/rest/v1/rpc/nearby_dining`, { method: "POST", headers,
      body: JSON.stringify({ lat: Number(pl.lat), lng: Number(pl.lng), radius_m: NEARBY_KM * 1000, max_results: 8 }) });
    // One retry: a dropped request shouldn't leave the row saying the database is down.
    let r = await ask().catch(() => null);
    if (!r?.ok) r = await new Promise(ok => setTimeout(ok, 800)).then(ask);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    // The place itself (Musso & Frank, linked with `external: {system: dining}`) isn't "nearby" itself.
    const self = new Set(S.db.externalFor("place", pl.key).filter(l => l.system === "dining").map(l => l.external_id));
    return (await r.json()).filter(x => !self.has(x.id));
  })().catch(e => { delete diningCache[pl.id]; throw e; });
}
const diningLabel = x => {
  const m = d => d < 950 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`;
  const label = `${x.name}${x.type ? ` · ${x.type}` : ""}${x.price_level ? ` · ${"$".repeat(x.price_level)}` : ""} (${m(x.distance_m)})`;
  return x.website ? h("a", { class: "ext", href: x.website, target: "_blank", rel: "noopener", text: label + " ↗" }) : label;
};
async function diningNearby(pl, dl) {
  if (!diningOn(pl)) return;
  const dd = h("dd", { text: "Looking…" });
  dl.append(h("dt", { text: "Eat and drink nearby" }), dd);
  try {
    const rows = await fetchDining(pl);
    if (S.selected?.kind !== "place" || S.selected.id !== pl.id) return;   // another place was picked meanwhile
    try { diningPins(rows); } catch (e) { console.warn("dining pins:", e); }   // the list still shows if the map can't
    dd.replaceChildren(...joinNodes(rows.map(diningLabel), `No Metro Advisor picks within ${NEARBY_KM} km`));
  } catch (e) {
    dd.textContent = "Couldn't reach the dining database just now.";
  }
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

// Links out to a record's entries in other databases, as one panel row ("Elsewhere"), or no row when there are none.
const SYSTEM_LABEL = { entertainment: "Entertainment database", imdb: "IMDb", tmdb: "TMDB", wikidata: "Wikidata", restaurants: "Restaurants and bars" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function externalRow(type, key) {
  const links = S.db.externalFor(type, key);
  if (!links.length) return [];
  return [["Elsewhere", joinNodes(links.map(l => {
    const label = l.label || (SYSTEM_LABEL[l.system] || cap(l.system)) + (l.external_id && !l.url && !UUID.test(l.external_id) ? `: ${l.external_id}` : "");
    return l.url ? h("a", { class: "ext", href: l.url, target: "_blank", rel: "noopener", text: label + " ↗" }) : label;
  }))]];
}

// Places within walking distance of a place (straight-line km), nearest first, and the important things
// that happened at them: so a venue panel shows what else is around it.
const NEARBY_KM = 5;
function kmBetween(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
}
function nearbyRows(pl) {
  if (pl.lat == null || pl.lng == null) return [];
  const db = S.db;
  // Areas (a city, a district, an island) have a centre point, not a spot, so they don't count as "nearby".
  const AREA = /^(city|town|village|hamlet|township|borough|district|neighbourhood|county|region|island|strait|country)$/i;
  const near = db.places.filter(o => o.id !== pl.id && o.lat != null && o.lng != null && !AREA.test(o.kind || ""))
    .map(o => ({ o, km: kmBetween(pl, o) })).filter(x => x.km <= NEARBY_KM).sort((a, b) => a.km - b.km);
  if (!near.length) return [];
  const fmtKm = km => km < .95 ? `${Math.round(km * 10) * 100} m` : `${km.toFixed(1)} km`;
  const here = new Set(db.eventsAt(pl.id).map(e => e.id));   // already listed under "Events here"
  const big = near.flatMap(x => db.eventsAt(x.o.id).filter(e => (e.prominence ?? 3) >= 4 && !e.film && !here.has(e.id)).map(e => ({ e, pl: x.o })))
    .filter((v, i, a) => a.findIndex(w => w.e.id === v.e.id) === i)
    .sort((a, b) => (b.e.prominence ?? 3) - (a.e.prominence ?? 3) || byYear(a.e.start_year, b.e.start_year)).slice(0, 6);
  return [
    ["Nearby", joinNodes(near.slice(0, 8).map(x => placeLink(x.o, ` (${fmtKm(x.km)})`)))],
    ...(big.length ? [["Big events nearby", joinNodes(big.map(x => eventLink(x.e, ` (${fmtYear(x.e.start_year)}, ${x.pl.name})`)))]] : []),
  ];
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

// Where a stop falls inside its year: the month from a full date or the event's month (sql/019), else 0 (start of
// the year). Deaths and burials go after everything else that year; births before.
const monthOf = e => e.start_date ? Number(e.start_date.slice(5, 7)) : e.start_month || 0;
const momentMonth = role => role === "born" ? -1 : role === "died" || role === "buried" ? 13 : 0;
const byStop = (a, b) => byYear(a.year, b.year) || (a.month ?? 0) - (b.month ?? 0) || a.rank - b.rank
  || (a.date || "").localeCompare(b.date || "") || (a.order ?? 0) - (b.order ?? 0);
function stopsForPerson(id) {
  const db = S.db, stops = [];
  db.pp.filter(x => x.entity_id === id).forEach(x => {
    const place = db.placeById[x.place_id];
    if (place) stops.push({ year: x.year, month: momentMonth(x.role), date: null, what: cap(x.role), place, rank: ROLE_ORDER[x.role] ?? 5 });
  });
  db.eventsOf(id).forEach(({ event: e, role }) => {
    const place = db.placeById[e.place_id];
    if (place) stops.push({ year: e.start_year, month: monthOf(e), date: e.start_date, what: e.name + (role ? ` (${role})` : ""), place, rank: 2, order: e.id });
  });
  return stops.sort(byStop);
}
function stopsForEvent(id) {
  const e = S.db.eventById[id];
  const at = (e?.placeIds || [e?.place_id]).map(pid => S.db.placeById[pid]).filter(Boolean);
  const what = place => { const v = (e.venues || []).filter(x => x.place_id === place.id).map(x => x.note || x.role); return v.length ? `${e.name}: ${v.join("; ")}` : e.name; };
  return at.map(place => ({ year: e.start_year, date: e.start_date, what: what(place), place, rank: 2 }));
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

// Street map (Leaflet + OpenStreetMap tiles) for anything that fits in a city or county: the coastline map
// is blank at that scale. Wider views (a king's travels, a war) keep the coastline map.
const STREET_SPAN = 1.5;   // degrees of latitude or longitude: about 150 km
let streetMap = null;
function drawStreetMap(host, routes, numbered, placeMode, fit) {
  const box = h("div", { class: "street-map", role: "region", "aria-label": "Street map of places" });
  host.append(box);
  streetMap = L.map(box, { scrollWheelZoom: false, zoomControl: true, attributionControl: true });
  streetMap.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(streetMap);
  const css = getComputedStyle(document.documentElement);
  const colorOf = c => c.startsWith("var(") ? css.getPropertyValue(c.slice(4, -1)).trim() : c;
  const bounds = [];
  let n = 0;
  routes.forEach(r => {
    const ll = r.stops.map(s => [Number(s.place.lat), Number(s.place.lng)]);
    if (S.mapMode !== "everyone" && r.person && ll.length > 1) L.polyline(ll, { color: colorOf(r.color), weight: 2, opacity: .6, dashArray: "4 4" }).addTo(streetMap);
    const byPlace = new Map();
    r.stops.forEach(s => { s.n = ++n; if (!byPlace.has(s.place.id)) byPlace.set(s.place.id, []); byPlace.get(s.place.id).push(s); });
    byPlace.forEach(items => {
      const pl = items[0].place, at = [Number(pl.lat), Number(pl.lng)];
      const label = !numbered ? "" : placeMode ? (items[0].what ? String(items.length) : "") : items.map(s => s.n).join(",");
      const icon = L.divIcon({ className: "street-pin-wrap", iconSize: null,
        html: `<span class="street-pin${label.length > 1 ? " wide" : ""}" style="background:${r.color}">${label}</span>` });
      const m = L.marker(at, { icon, keyboard: true, title: `Show ${pl.name}`, alt: pl.name }).addTo(streetMap);
      m.bindTooltip(pl.name, { direction: "top", offset: [0, -8] });
      m.on("click", () => selectPlace(pl.id));
      bounds.push(at);
    });
  });
  const view = fit?.length ? fit : bounds;
  if (new Set(view.map(String)).size === 1) streetMap.setView(view[0], 15);
  else streetMap.fitBounds(view, { padding: [24, 24], maxZoom: 16 });
}

// The dining picks also go on the street map, as small square pins under the place's own, so the map shows
// where to eat around it. Only when the street map is showing (a place is selected).
function diningPins(rows, map = streetMap, refit = true) {
  if (!map) return;
  const diningLayer = L.layerGroup().addTo(map);
  rows.forEach(x => {
    if (x.latitude == null || x.longitude == null) return;
    const icon = L.divIcon({ className: "street-pin-wrap", iconSize: null, html: '<span class="dining-pin" aria-hidden="true"></span>' });
    const m = L.marker([x.latitude, x.longitude], { icon, keyboard: true, title: x.name, alt: x.name, zIndexOffset: -100 }).addTo(diningLayer);
    m.bindTooltip(`${x.name}${x.type ? ` · ${x.type}` : ""}`, { direction: "top", offset: [0, -6] });
    if (x.website) m.on("click", () => window.open(x.website, "_blank", "noopener"));
  });
  // Widen the view so the picks are in it too (they reach out to the search radius).
  const all = [...rows.filter(x => x.latitude != null).map(x => [x.latitude, x.longitude]),
               ...Object.values(map._layers).filter(l => l.getLatLng && !diningLayer.hasLayer(l)).map(l => l.getLatLng())];
  if (refit && all.length > 1) map.fitBounds(all, { padding: [24, 24], maxZoom: 16 });
}

function drawMap() {
  const host = $("map"), list = $("stops");
  if (streetMap) { streetMap.remove(); streetMap = null; }
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
  // A person with two or more places gets a full-screen journey through their life.
  const jBox = $("map-journey");
  if (jBox) {
    jBox.innerHTML = "";
    const who = S.selected?.kind === "person" && S.mapMode !== "everyone" ? db.byId[S.selected.id] : null;
    if (who && new Set(routes[0]?.stops.map(s => s.place.id)).size >= 2)
      jBox.append(h("button", { type: "button", class: "xexp", id: "journey-open", title: `Follow ${who.name}'s life stop by stop, full screen`,
        onclick: () => openJourney(who.id), text: "Journey ⤢" }));
  }

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
  // Street map when the pins fit in a city or county, or when most of them do (the 2028 Games: 30 venues in
  // Southern California and two in Oklahoma City): it then fits that cluster, and the few far pins sit off-screen.
  const median = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const mLon = pts.length ? median(pts.map(p => p[0])) : 0, mLat = pts.length ? median(pts.map(p => p[1])) : 0;
  const cluster = pts.filter(p => Math.abs(p[0] - mLon) <= STREET_SPAN / 2 && Math.abs(p[1] - mLat) <= STREET_SPAN / 2);
  const street = window.L && pts.length && cluster.length >= pts.length * .75;
  if (street) drawStreetMap(host, routes, S.mapMode !== "everyone", placeMode, cluster.map(p => [p[1], p[0]]));
  const svg = street ? null : el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Map of places" }, host);
  if (!street && window.d3 && window.HISTORY_LAND) {
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

/* ------------------------------------------------------------------ journey */
// A person's life as a journey: every event they took part in and every place moment, in date order, on a full-
// screen map beside the list of stops. Picking a stop moves the map to it and shows that event and its people.
// The map is the border snapshot nearest the stop's year (data/maps, GPL-3.0), or today's street map for a
// traveller. "Shrink ✕" or Esc closes it; reopening for the same person returns to the stop you were on.
const J = { person: null, i: 0, stops: [], el: null, map: null, zoom: null, k: null, back: null, base: store.get("journeyBase", "borders") };

function journeyStops(id) {
  const db = S.db;
  const stops = [
    ...db.eventsOf(id).filter(x => !x.event.film).map(({ event: e, role }) => ({ year: e.start_year, month: monthOf(e), date: e.start_date,
      event: e, role, what: e.name, place: db.placeById[e.place_id] || null, rank: 2, order: e.id })),
    ...db.pp.filter(x => x.entity_id === id && db.placeById[x.place_id]).map(x => ({ year: x.year, month: momentMonth(x.role), date: null,
      moment: x, what: `${cap(x.role)} at ${db.placeById[x.place_id].name}`, place: db.placeById[x.place_id], rank: ROLE_ORDER[x.role] ?? 5 })),
  ];
  const ok = pl => pl && pl.lat != null && pl.lng != null;
  return stops.filter(s => s.year != null).sort(byStop).map(s => ({ ...s, place: ok(s.place) ? s.place : null }));
}
// The person's age in a stop's year ("age 19"), or "" if unknown. An approximate birth year is noted once, above the list.
const ageAt = (p, y) => {
  if (p?.birth_year == null || y == null) return "";
  const a = yearsBetween(p.birth_year, y);
  return a <= 0 || (p.death_year != null && y > p.death_year) ? "" : `age ${a}`;
};
const stopWhen = s => s.date ? fmtDate(s.date) : s.event?.start_month ? `${MONTHS[s.event.start_month - 1]} ${fmtYear(s.year)}` : fmtYear(s.year);

// from: "explore" when opened from the Explore page's Person card, so links inside go to its cards, not the timeline.
function openJourney(id, from = "timeline") {
  const stops = journeyStops(id);
  if (!stops.some(s => s.place)) return;
  if (J.person !== id) { J.i = Math.max(0, stops.findIndex(s => s.place)); J.k = null; }
  J.person = id; J.stops = stops; J.i = Math.min(J.i, stops.length - 1);
  closeJourney(false);
  J.back = document.activeElement; J.from = from;
  J.locked = document.body.classList.contains("x-full");   // an expanded Explore card already locks the page
  const p = S.db.byId[id];
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Map shows" });
  const shell = J.el = h("div", { class: "journey", role: "dialog", "aria-modal": "true", "aria-label": `Journey: ${p.name}` },
    h("div", { class: "jhead" },
      h("div", {}, h("div", { class: "xkind", text: "Journey" }), h("h2", { text: p.name })),
      h("div", { class: "jtools" }, seg,
        h("button", { type: "button", class: "xmove", "aria-label": "Previous stop", title: "Previous stop (←)", text: "◀", onclick: () => journeyGo(J.i - 1) }),
        h("button", { type: "button", class: "xmove", "aria-label": "Next stop", title: "Next stop (→)", text: "▶", onclick: () => journeyGo(J.i + 1) }),
        h("button", { type: "button", class: "xexp", id: "journey-close", title: "Back to the panel (Esc)", text: "Shrink ✕", onclick: () => closeJourney() }))),
    h("div", { class: "jbody" },
      h("div", { class: "jmapcol" }, h("div", { class: "jmap", id: "jmap" }), h("p", { class: "hint map-credit", id: "jcredit" })),
      h("div", { class: "jside" }, h("div", { class: "jstop", id: "jstop", "aria-live": "polite" }), p.birth_estimated && p.birth_year != null ? h("p", { class: "hint", text: `Born about ${fmtYear(p.birth_year)}, so the ages are approximate.` }) : null, h("ol", { class: "stops jlist", id: "jlist" }))));
  [["borders", "Borders then"], ["street", "Street map today"]].forEach(([b, label]) => seg.append(h("button", { type: "button", "aria-pressed": J.base === b, text: label,
    onclick: () => { J.base = b; store.set("journeyBase", b); seg.querySelectorAll("button").forEach((x, i) => x.setAttribute("aria-pressed", (i === 0) === (b === "borders"))); J.k = null; drawJourneyMap(true); } })));
  document.body.append(shell);
  document.body.classList.add("x-full");
  // The list, numbered like the side panel's map (only stops with a place get a number).
  const list = $("jlist");
  let n = 0;
  let lastYear = null;
  J.stops.forEach((s, i) => {
    s.n = s.place ? ++n : null;
    // The age shows on the first stop of each new year.
    const age = s.year !== lastYear ? ageAt(p, s.year) : "";
    lastYear = s.year;
    const li = h("li", {},
      h("span", { class: "n" + (s.place ? "" : " none"), text: s.n ?? "–" }),
      h("button", { type: "button", class: "jpick", onclick: () => journeyGo(i) },
        h("span", { class: "yrs", text: stopWhen(s) + (age ? ` (${age})` : "") + "  " }), h("span", { class: "what", text: s.what }),
        h("span", { class: "where", text: s.place ? ` · ${s.place.name}` : " · no place recorded" })));
    list.append(li);
  });
  journeyGo(J.i, true);
  $("journey-close").focus();
}

function closeJourney(restore = true) {
  if (J.map) { J.map.remove(); J.map = null; }
  if (!J.el) return;
  J.el.remove(); J.el = null;
  if (!J.locked) document.body.classList.remove("x-full");
  if (restore && J.back?.isConnected) J.back.focus();
}

function journeyGo(i, first = false) {
  if (!J.el || i < 0 || i >= J.stops.length) return;
  const prevYear = J.stops[J.i]?.year;
  J.i = i;
  const s = J.stops[i], db = S.db;
  // Links inside the journey close it first, then go to the record in the panel.
  const go = fn => () => { closeJourney(false); fn(); };
  const ex = J.from === "explore";
  const pLink = (p, extra = "") => h("button", { type: "button", class: "plink", title: `Show ${p.name}`, onclick: go(() => ex ? xGo("person", p.id) : reveal(p.id)), text: p.name + extra });
  const plLink = pl => h("button", { type: "button", class: "plink", title: `Show ${pl.name}`, onclick: go(() => ex ? xGo("place", pl.id) : selectPlace(pl.id)), text: pl.name });
  const card = $("jstop"), dl = h("dl");
  const rows = [];
  if (s.event) {
    const e = s.event;
    const age = ageAt(db.byId[J.person], s.year);
    rows.push(["Date", stopWhen(s) + (age ? ` (${age})` : "") + (e.estimated ? " (approximate)" : "") + (e.end_year != null && e.end_year !== e.start_year ? ` to ${fmtYear(e.end_year)}` : "")]);
    rows.push(["Where", s.place ? [plLink(s.place), s.place.historical_name ? ` (then ${s.place.historical_name})` : ""] : "No place recorded"]);
    if (e.venues?.length) rows.push(["Also at", joinNodes(e.venues.map(v => db.placeById[v.place_id] && [plLink(db.placeById[v.place_id]), ` (${v.note || v.role})`]).filter(Boolean))]);
    rows.push(["People", joinNodes(db.peopleInEvent(e.id).map(x => pLink(x.person, x.role ? ` (${x.role})` : "")), "None linked")]);
    rows.push(["Sources", sourceLinks(db.sourcesFor("event", e.key))]);
  } else {
    const age = ageAt(db.byId[J.person], s.year);
    rows.push(["Date", fmtYear(s.year) + (age ? ` (${age})` : "")], ["Where", [plLink(s.place), s.place.historical_name ? ` (then ${s.place.historical_name})` : ""]]);
    if (s.place.note) rows.push(["About", s.place.note]);
  }
  rows.forEach(([k, v]) => dl.append(h("dt", { text: k }), h("dd", {}, ...(Array.isArray(v) ? v : [v]))));
  const stars = s.event?.prominence ? "★".repeat(s.event.prominence) + "☆".repeat(5 - s.event.prominence) : null;
  card.replaceChildren(...[
    h("div", { class: "jcount", text: `Stop ${i + 1} of ${J.stops.length}` }),
    h("div", { class: "kind", style: "color:var(--madder)", text: s.event ? (s.event.type || "Event") + (s.role ? ` · ${s.role}` : "") : "Life" }),
    h("h3", {}, s.event ? s.event.name : s.what, stars ? h("span", { class: "yrs", title: `Prominence ${s.event.prominence} of 5`, text: ` ${stars}` }) : null),
    s.event?.note ? h("p", { class: "jnote", text: s.event.note }) : null,
    dl,
    s.event ? h("button", { type: "button", class: "plink", onclick: go(() => ex ? xGoEvent(s.event.id) : revealEvent(s.event.id)), text: ex ? "Open this event in its card" : "Open this event in the panel" }) : null].filter(Boolean));
  $("jlist").querySelectorAll("li").forEach((li, k) => li.classList.toggle("cur", k === i));
  // Side by side, the list scrolls to the stop; on a phone (map, stop, list stacked) the page goes back up to the map.
  const smooth = first || matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  if (matchMedia("(max-width: 760px)").matches) { if (!first) J.el.scrollTo({ top: 0, behavior: smooth }); }
  else $("jlist").children[i]?.scrollIntoView({ block: "nearest", behavior: smooth });
  // Borders: a new snapshot only when the year's nearest snapshot changes; otherwise just move the highlight.
  drawJourneyMap(first || J.base === "borders" && nearestSnapshot(prevYear) !== nearestSnapshot(s.year));
}

let J_YEARS = null;
const nearestSnapshot = y => !J_YEARS || y == null ? null
  : J_YEARS.reduce((best, x) => Math.abs(x - y) < Math.abs(best - y) ? x : best, J_YEARS[0]);

async function drawJourneyMap(rebuild) {
  const host = $("jmap"), credit = $("jcredit");
  if (!host) return;
  const placed = J.stops.filter(s => s.place), cur = J.stops[J.i];
  const ll = s => [Number(s.place.lat), Number(s.place.lng)];
  if (J.base === "street" && window.L) {
    if (rebuild || !J.map) {
      if (J.map) { J.map.remove(); J.map = null; }
      host.replaceChildren();
      const box = h("div", { class: "street-map" }); host.append(box);
      const map = J.map = L.map(box, { zoomControl: true, attributionControl: true });
      map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(map);
      L.polyline(placed.map(ll), { color: getComputedStyle(document.documentElement).getPropertyValue("--madder").trim(), weight: 2, opacity: .7, dashArray: "4 4" }).addTo(map);
      J.pins = new Map();
      placed.forEach(s => {
        const label = placed.filter(x => x.place.id === s.place.id).map(x => x.n).join(",");
        if (J.pins.has(s.place.id)) return;
        const icon = L.divIcon({ className: "street-pin-wrap", iconSize: null, html: `<span class="street-pin jpin${label.length > 2 ? " wide" : ""}" data-place="${s.place.id}" style="background:var(--madder)">${label}</span>` });
        const m = L.marker(ll(s), { icon, keyboard: true, title: s.place.name, alt: s.place.name }).addTo(map);
        m.bindTooltip(s.place.name, { direction: "top", offset: [0, -8] });
        m.on("click", () => journeyGo(J.stops.indexOf(s)));
        J.pins.set(s.place.id, m);
      });
      map.fitBounds(placed.map(ll), { padding: [30, 30] });
      credit.replaceChildren("Today's streets. Numbers follow the list; the dashed line joins the stops in order, not the roads taken.");
    }
    host.querySelectorAll(".jpin").forEach(el => el.classList.toggle("cur", cur.place && Number(el.dataset.place) === cur.place.id));
    if (cur.place) J.map.flyTo(ll(cur), Math.max(J.map.getZoom(), 10), { duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : .8 });
    return;
  }
  // Borders then: the snapshot nearest the stop's year, Mercator fitted to every stop.
  const idx = await mapIndex();
  if (!idx || !window.d3 || !J.el) return;
  J_YEARS = Object.keys(idx.years).map(Number).sort((a, b) => a - b);
  const shownYear = nearestSnapshot(cur.year);
  const svgOld = host.querySelector("svg.jborders");
  if (!rebuild && svgOld && Number(svgOld.dataset.year) === shownYear) return markJourney(svgOld);
  const geo = await mapGeo(idx.years[shownYear]);
  if (!J.el || J.base !== "borders") return;
  if (J.map) { J.map.remove(); J.map = null; }
  const W = 900, H = 640;
  const pts = placed.map(s => [Number(s.place.lng), Number(s.place.lat)]);
  let [x0, y0] = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1]))], [x1, y1] = [Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
  if (x1 - x0 < 4) { const c = (x0 + x1) / 2; x0 = c - 2; x1 = c + 2; }
  if (y1 - y0 < 3) { const c = (y0 + y1) / 2; y0 = c - 1.5; y1 = c + 1.5; }
  const px = (x1 - x0) * .12, py = (y1 - y0) * .12;
  const proj = d3.geoMercator().fitExtent([[10, 10], [W - 10, H - 10]], { type: "MultiPoint", coordinates: [[x0 - px, y0 - py], [x1 + px, y1 + py]] });
  const path = d3.geoPath(proj);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "histmap jborders", "data-year": shownYear, role: "img", "aria-label": `Borders around ${fmtYear(shownYear)} with the journey's stops` });
  const g = el("g", {}, svg);
  el("rect", { x: -W * 4, y: -H * 4, width: W * 9, height: H * 9, class: "hm-sea" }, g);
  const land = el("g", {}, g), lab = el("g", { class: "jlabels" }, g);
  const inView = ([x, y]) => x > 20 && x < W - 20 && y > 20 && y < H - 20;
  const labels = [];
  geo.features.forEach(f => {
    const d = path(f); if (!d) return;
    const p = el("path", { d, class: "hm-land" }, land);
    p.__f = f;
    const name = f.properties?.NAME;
    el("title", {}, p).textContent = name || "";
    const c = path.centroid(f), a = path.area(f);
    if (name && inView(c) && a > 1500) labels.push({ name, c, a });
  });
  labels.sort((p, q) => q.a - p.a).slice(0, 12).forEach(l => el("text", { x: l.c[0], y: l.c[1], class: "jrealm", "text-anchor": "middle" }, lab).textContent = l.name);
  const xy = placed.map(s => proj([Number(s.place.lng), Number(s.place.lat)]));
  el("path", { d: "M" + xy.map(p => p.join(",")).join("L"), class: "jroute" }, g);
  el("path", { d: "", class: "jroute done" }, g);
  const pins = el("g", {}, g), seen = new Map();
  placed.forEach((s, k) => {
    const key = s.place.id;
    if (seen.has(key)) { seen.get(key).nums.push(s.n); return; }
    const pg = el("g", { class: "jpt", transform: `translate(${xy[k].join(",")})`, tabindex: 0, role: "button", "data-place": key, "aria-label": s.place.name }, pins);
    el("circle", { r: 9 }, pg);
    const t = el("text", { y: 3.5, "text-anchor": "middle" }, pg);
    el("title", {}, pg).textContent = s.place.name;
    const pick = () => { const at = J.stops.findIndex((x, j) => j > J.i && x.place?.id === key); journeyGo(at >= 0 ? at : J.stops.findIndex(x => x.place?.id === key)); };
    pg.addEventListener("click", pick);
    pg.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    seen.set(key, { t, nums: [s.n] });
  });
  seen.forEach(({ t, nums }) => t.textContent = nums.length > 2 ? `${nums[0]}…` : nums.join(","));
  svg.__xy = new Map(placed.map((s, k) => [s, xy[k]]));
  host.replaceChildren(svg);
  // Pan and zoom; the zoom carries over between stops and snapshots.
  const zoom = J.zoom = d3.zoom().scaleExtent([1, 16]).translateExtent([[-W, -H], [2 * W, 2 * H]]).on("zoom", ev => {
    g.setAttribute("transform", ev.transform); J.k = ev.transform;
    g.querySelectorAll(".jpt").forEach(n => n.setAttribute("transform", n.getAttribute("transform").replace(/ scale\([^)]*\)/, "") + ` scale(${1 / ev.transform.k})`));
    lab.setAttribute("font-size", 13 / ev.transform.k);
  });
  const sel = d3.select(svg).call(zoom);
  if (J.k) sel.call(zoom.transform, J.k);
  host.append(h("div", { class: "map-zoom" },
    h("button", { type: "button", "aria-label": "Zoom in", text: "+", onclick: () => sel.transition().call(zoom.scaleBy, 1.8) }),
    h("button", { type: "button", "aria-label": "Zoom out", text: "−", onclick: () => sel.transition().call(zoom.scaleBy, 1 / 1.8) }),
    h("button", { type: "button", "aria-label": "Show every stop", text: "⟲", onclick: () => sel.transition().call(zoom.transform, d3.zoomIdentity) })));
  credit.replaceChildren(`Borders around ${fmtYear(shownYear)}, approximate (the snapshot nearest this stop's year; it changes as the journey moves through time). The shaded land is the realm the stop is in. Map data: `,
    h("a", { class: "ext", href: idx.source, target: "_blank", rel: "noopener", text: "historical-basemaps" }), " by André Ourednik, ",
    h("a", { class: "ext", href: "data/maps/LICENSE", target: "_blank", rel: "noopener", text: "GPL-3.0" }), ".");
  markJourney(svg);
}

// Highlights the current stop, the route walked so far, and the realm the stop lies in.
function markJourney(svg) {
  const cur = J.stops[J.i], xy = svg.__xy;
  svg.querySelectorAll(".jpt").forEach(n => n.classList.toggle("cur", !!cur.place && Number(n.dataset.place) === cur.place.id));
  const walked = J.stops.slice(0, J.i + 1).filter(s => s.place).map(s => xy.get(s)).filter(Boolean);
  svg.querySelector(".jroute.done").setAttribute("d", walked.length > 1 ? "M" + walked.map(p => p.join(",")).join("L") : "");
  svg.querySelectorAll(".hm-land").forEach(p => p.classList.toggle("here", !!cur.place && d3.geoContains(p.__f, [Number(cur.place.lng), Number(cur.place.lat)])));
  // Bring the stop into view when zoomed in and it is off-screen.
  if (cur.place && J.k && J.k.k > 1 && J.zoom) {
    const [x, y] = xy.get(cur), [sx, sy] = J.k.apply([x, y]);
    if (sx < 40 || sx > 860 || sy < 40 || sy > 600) d3.select(svg).transition().call(J.zoom.translateTo, x, y);
  }
}

addEventListener("keydown", e => {
  if (!J.el) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeJourney(); }   // not also the expanded card behind it
  else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")
    && !document.activeElement?.closest(".leaflet-container, .jborders")) {
    e.preventDefault(); journeyGo(J.i + (e.key === "ArrowRight" ? 1 : -1));
  }
});

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
  $("timeline-view").style.cssText = "";
  $("explore-view").hidden = v !== "explore";
  $("timeline-view").hidden = v !== "timeline";
  $("year-view").hidden = v !== "year";
  ["explore", "timeline", "year"].forEach(k => $("view-" + k).setAttribute("aria-pressed", v === k));
  // Leaving the Explore page puts an expanded card back.
  if (v !== "explore" && X.open) { X.open = null; X.pushed = false; document.body.classList.remove("x-full"); }
  S.viewMode = v;
  if (v === "timeline") {
    try { history.replaceState(null, "", S.query ? "?q=" + encodeURIComponent(S.query) : "?view=timeline"); } catch (e) {}
    renderOverview(); updateOverviewWindow();
  } else if (v === "year") {
    syncYearUrl();
    $("year-from").focus({ preventScroll: true });
  } else {
    renderExplore([]);
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
    rulers.append(h("p", { class: "hint", text: "Rulers are hidden by the Show buttons above (Royalty, Nobility, Clergy, Government)." }));
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
        list.append(h("li", { class: t.disputed ? "disputed" : "" }, crownIcon(t.disputed ? "Disputed claim" : "Held this title", p), " ", yPerson(p),
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
// The index changes when snapshots are added, so it is revalidated each visit; snapshot files never change.
const mapIndex = () => MAPS.index ??= fetch("data/maps/index.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null);
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

function yearMap(a, b, realmsInView, onRealm = focusRealm) {
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
          const go = () => onRealm(realms[0]);
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
        c.addEventListener("click", () => onRealm(realm));
        c.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRealm(realm); } });
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

/* ------------------------------------------------------------------ explore: four linked cards */
// The front page: one search box and four cards (Year, Place, Person, Work). A search fills all four with its best
// match and what goes with it; a link in any card changes only the card it matches. Each card expands to fill the
// screen and shrinks back to its spot. The address records the cards (by key), so a view can be shared.
// The Show and Fame buttons belong to the timeline and Year views; the cards show everyone.

const X = { hint: {}, year: null, event: null, place: null, person: null, work: null, open: null, country: store.get("country", ""), pushed: false, lift: [] };
const CARDS = ["year", "world", "event", "place", "person", "work"];
const CARD_LABEL = { year: "Year", world: "World", event: "Event", place: "Place", person: "Person", work: "Work" };
// The reader can put the cards in their own order (drag a card by its header, or its ← → buttons), kept per browser.
// A card added later joins at the end of a saved order.
const cardOrder = () => { const saved = store.get("cardOrder", []).filter(k => CARDS.includes(k)); return [...new Set([...saved, ...CARDS])]; };
// A search lifts the cards it matched to the top, for that search only: the year first, then the person, event, work
// or place ("1850 Michelangelo" gives Year, Person). The rest follow the saved order, which the search leaves alone.
const shownOrder = () => [...new Set([...X.lift, ...cardOrder()])];
// After a search: lift its cards, and blank any card it couldn't fill, so nothing from an earlier search lingers
// and no far-off suggestions crowd in. A link in another card fills it in place.
function afterSearch(kind, year) {
  X.lift = [...new Set([year != null ? "year" : null, kind].filter(k => CARDS.includes(k)))];
  X.hint = {};
  ["year", "event", "place", "person", "work"].forEach(k => { if (X[k] == null) X.hint[k] = { text: "Nothing for this search. Pick a link in another card to fill this one.", links: [] }; });
}
// One name per modern country: places say England, Scotland or Wales; realms say United Kingdom. Vatican City counts
// under Italy (Ty, 2026-10-13), so picking Italy includes the Sistine Chapel and the Vatican Museums.
const COUNTRY_ALIAS = { England: "United Kingdom", Scotland: "United Kingdom", Wales: "United Kingdom", "Northern Ireland": "United Kingdom", "Great Britain": "United Kingdom", Czechia: "Czech Republic", "Vatican City": "Italy" };
const normCountry = c => c ? COUNTRY_ALIAS[c] || c : null;
// How well known someone is: Wikipedia language editions (sitelinks), else their star rating.
const fame = p => p.sitelinks ?? (p.prominence ?? 3) * 15;
const nextYear = y => y === -1 ? 1 : y + 1, prevYear = y => y === 1 ? -1 : y - 1;
const aliveIn = (p, a, b = a) => (p.birth_year != null || p.death_year != null)
  && overlaps(p.birth_year ?? p.death_year - 60, p.death_year ?? p.birth_year + 60, a, b);
const ageIn = (p, y) => p.birth_year != null && y >= p.birth_year ? yearsBetween(p.birth_year, y) : null;
const workYear = w => w.end_year ?? w.start_year;
const workSpan = w => w.start_year == null ? null : (w.estimated ? "c. " : "") + (w.end_year != null && w.end_year !== w.start_year ? fmtSpan(w.start_year, w.end_year) : fmtYear(w.start_year));

// Lookups the cards need, built once.
let XI = null;
function exploreIndex() {
  if (XI) return XI;
  const db = S.db;
  const workById = Object.fromEntries([...db.artworks, ...db.filmArtworks].map(w => [w.id, w]));
  const placeByKey = Object.fromEntries(db.places.map(p => [p.key, p]));
  const worksBy = new Map(), creatorOf = new Map(), subjectsOf = new Map(), placesOf = new Map(), worksAt = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  db.artworkPeople.forEach(x => {
    const w = workById[x.artwork_id];
    if (!w || !db.byId[x.entity_id]) return;
    if (x.role === "creator") { push(worksBy, x.entity_id, w); if (!creatorOf.has(w.id)) creatorOf.set(w.id, x.entity_id); }
    if (x.role === "subject") push(subjectsOf, w.id, x.entity_id);
  });
  const workOrder = (a, b) => byYear(a.start_year, b.start_year) || byYear(a.end_year, b.end_year) || a.name.localeCompare(b.name);
  worksBy.forEach(ws => ws.sort(workOrder));
  // Where a work is: the places it's linked to (made, held, displayed), then its museum's place.
  const ROLE_RANK = { made: 0, "made-for": 1, displayed: 2, held: 3, depicts: 4 };
  db.artworkPlaces.forEach(x => {
    const w = workById[x.artwork_id], pl = db.placeById[x.place_id];
    if (!w || !pl) return;
    push(placesOf, w.id, { place: pl, role: x.role });
    if (w.kind !== "film") push(worksAt, pl.id, { work: w, role: x.role });
  });
  placesOf.forEach(xs => xs.sort((a, b) => (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9)));
  const museumById = db.museumById;
  db.artworks.forEach(w => {
    const m = museumById[w.museum_id], pl = m?.place_key && placeByKey[m.place_key];
    if (pl && !(placesOf.get(w.id) || []).some(x => x.place.id === pl.id)) { push(placesOf, w.id, { place: pl, role: "held" }); push(worksAt, pl.id, { work: w, role: "held" }); }
  });
  // A person's modern countries: their titles' realms, their recorded places and their works' places.
  const countries = new Map();
  const countriesOf = id => {
    if (countries.has(id)) return countries.get(id);
    const c = new Set([
      ...db.titlesOf(id).flatMap(t => realmCountries(t.realm)),
      ...db.placesOfPerson(id).map(pl => normCountry(pl.modern_country)),
      ...(worksBy.get(id) || []).flatMap(w => (placesOf.get(w.id) || []).filter(x => x.role !== "held").map(x => normCountry(x.place.modern_country))),
    ].filter(Boolean));
    countries.set(id, c);
    return c;
  };
  // A person's home country: where they were born, else the realm of their first title, else where they turn up most.
  const homes = new Map();
  const homeOf = id => {
    if (homes.has(id)) return homes.get(id);
    const born = db.pp.find(x => x.entity_id === id && x.role === "born"), t = db.titlesOf(id)[0];
    let c = normCountry(db.placeById[born?.place_id]?.modern_country) || (t && normCountry(db.countryOf[t.realm]));
    if (!c) { const n = {}; db.placesOfPerson(id).forEach(pl => { const k = normCountry(pl.modern_country); if (k) n[k] = (n[k] || 0) + 1; }); c = Object.keys(n).sort((a, b) => n[b] - n[a])[0] || null; }
    homes.set(id, c);
    return c;
  };
  // In a country in a given year: at home, or recorded there (a life moment, an event, a title) within a few years of it.
  const inCountryAt = (id, C, y) => homeOf(id) === C
    || db.pp.some(x => x.entity_id === id && x.year != null && Math.abs(x.year - y) <= 3 && normCountry(db.placeById[x.place_id]?.modern_country) === C)
    || db.eventsOf(id).some(x => Math.abs((x.event.start_year ?? -1e9) - y) <= 3 && normCountry(db.placeById[x.event.place_id]?.modern_country) === C)
    || db.titlesOf(id).some(t => overlaps(t.start_year, t.end_year, y, y) && realmIn(t.realm, C, y));
  // Every country a record names, for the picker: most-used first is less useful than A-Z for finding one.
  const countryList = [...new Set([...Object.values(db.countryOf), ...Object.values(db.realmInfo).flatMap(r => r.countries.map(c => c.country)),
    ...db.places.map(p => p.modern_country)].map(normCountry).filter(Boolean))].sort();
  return XI = { workById, placeByKey, worksBy, creatorOf, subjectsOf, placesOf, worksAt, countriesOf, homeOf, inCountryAt, countryList };
}
// Does a realm cover today's country C in year y (any year when y is null)? Uses realm_countries, else the main country.
function realmIn(realm, C, y = null) {
  const db = S.db, info = db.realmInfo[realm] || {};
  const rows = info.countries?.length ? info.countries : db.countryOf[realm] ? [{ country: db.countryOf[realm] }] : [];
  return rows.some(c => normCountry(c.country) === C && (y == null || overlaps(c.start ?? info.start ?? -1e9, c.end ?? info.end, y, y)));
}
const realmCountries = realm => {
  const info = S.db.realmInfo[realm];
  return [...new Set((info?.countries?.length ? info.countries.map(c => c.country) : [S.db.countryOf[realm]]).map(normCountry).filter(Boolean))];
};
// The realms a place was part of in a year: those covering its country then that existed (or had a ruler) that year.
// "Near" a place: within 50 km, so a city's events and people count but the rest of a big country doesn't.
const NEAR_PLACE_KM = 50;
const hasPoint = p => p && p.lat != null && p.lng != null;
const kmApart = (a, b) => kmBetween({ lat: Number(a.lat), lng: Number(a.lng) }, { lat: Number(b.lat), lng: Number(b.lng) });
const placeNear = (o, pl) => hasPoint(o) && hasPoint(pl) && kmApart(o, pl) <= NEAR_PLACE_KM;
const eventNear = (e, pl) => (e.placeIds || [e.place_id]).some(id => placeNear(S.db.placeById[id], pl));
// A realm that is a city (Los Angeles, whose mayors are its rulers) belongs to places near that city, not to its
// whole country: New York in 1932 isn't ruled by the Mayor of Los Angeles.
let cityRealms = null;
const cityOfRealm = r => (cityRealms ??= Object.fromEntries(S.db.realmNames.map(n => [n,
  S.db.places.find(p => p.name === n && /^(city|town)$/i.test(p.kind || "") && hasPoint(p)) || null])))[r];
const realmFits = (r, pl) => !cityOfRealm(r) || placeNear(cityOfRealm(r), pl);
function realmsAt(pl, y) {
  const db = S.db, C = placeCountry(pl);
  if (!C || y == null) return [];
  return db.realmNames.filter(r => {
    if (!realmIn(r, C, y) || !realmFits(r, pl)) return false;
    const info = db.realmInfo[r] || {};
    if (info.start != null || info.end != null) return overlaps(info.start ?? -1e9, info.end, y, y);
    return db.titles.some(t => t.realm === r && overlaps(t.start_year, t.end_year, y, y));
  });
}
const workPlace = w => (exploreIndex().placesOf.get(w.id) || [])[0]?.place || null;
const workCountry = w => {
  const I = exploreIndex(), made = (I.placesOf.get(w.id) || []).find(x => x.role !== "held" && x.role !== "displayed");
  return normCountry(made?.place.modern_country) || (I.creatorOf.has(w.id) ? I.homeOf(I.creatorOf.get(w.id)) : null);
};
const placeCountry = pl => normCountry(pl?.modern_country);
const eventCountries = e => new Set([...(e.placeIds || [e.place_id])].map(id => placeCountry(S.db.placeById[id])).filter(Boolean));
const inCountryEvent = (e, C) => {
  const cs = eventCountries(e);
  if (cs.size) return cs.has(C);
  // No place recorded: an event belongs to the country of a ruler who took part in it.
  return S.db.peopleInEvent(e.id).some(x => S.db.titlesOf(x.person.id).some(t => realmIn(t.realm, C, e.start_year)));
};
const evOrder = (x, y) => (y.prominence ?? 3) - (x.prominence ?? 3) || byYear(x.start_year, y.start_year) || !x.start_date - !y.start_date || (x.start_date || "").localeCompare(y.start_date || "");

/* --- links: each changes the card it matches */
const xBtn = (text, title, go) => h("button", { type: "button", class: "plink", title, onclick: go, text });
const xYear = (y, text) => y == null ? null : xBtn(text ?? fmtYear(y), `${fmtYear(y)} in the Year card`, () => xGo("year", y));
const xPerson = (p, extra = "") => xBtn(p.name + extra, `${p.name} in the Person card`, () => xGo("person", p.id));
const xPlace = (pl, extra = "") => xBtn(pl.name + extra, `${pl.name} in the Place card`, () => xGo("place", pl.id));
const xWork = (w, extra = "") => xBtn(w.name + extra, `${w.name} in the Work card`, () => xGo("work", w.id));
// An event opens the Event card and brings its main person into the Person card ("William Wallace executed").
const xEvent = (e, extra = "") => xBtn(e.name + extra, `${e.name} in the Event card`, () => xGoEvent(e.id));
// A film (the timeline's film event) opens the Work card.
const xFilm = (f, extra = "") => xBtn(f.name + extra, `${f.name} in the Work card`, () => xGo("work", f.artId));
// The person an event is about: one whose name the event's own name contains, else the best known taking part.
function mainPersonOf(e) {
  const ppl = S.db.peopleInEvent(e.id).map(x => x.person), n = fold(e.name);
  const named = ppl.filter(p => n.includes(fold(p.name)) || fold(p.name).split(" ").some(w => w.length > 3 && n.split(" ").includes(w)));
  return (named.length ? named : ppl).sort((a, b) => fame(b) - fame(a))[0] || null;
}

// The person a film is about: one it portrays whose name its title shares, else the first it portrays.
function mainSubjectOf(f) {
  const ppl = S.db.portrayedIn(f), t = fold(f.name).split(" ");
  return ppl.find(p => fold(p.name).split(" ").some(w => w.length > 3 && t.includes(w))) || ppl[0] || null;
}
// The film to show for a person with no works of their own: one about them (named after them first), else the latest.
function filmAbout(p) {
  const fs = S.db.filmsPortraying(p.id);
  return fs.find(f => mainSubjectOf(f) === p) || fs[fs.length - 1] || null;
}

// What goes with a record, for filling the other cards after a search.
function bestWorkOf(id) {
  const ws = exploreIndex().worksBy.get(id) || [];
  // Star rating first, then the works the database knows most about (linked to places or people), then ones with a picture.
  const links = w => (exploreIndex().placesOf.get(w.id) || []).length + (exploreIndex().subjectsOf.get(w.id) || []).length;
  return ws.slice().sort((a, b) => (b.prominence ?? 3) - (a.prominence ?? 3) || links(b) - links(a) || !!b.image_thumb - !!a.image_thumb
    || (a.start_year == null) - (b.start_year == null))[0] || null;
}
function mainPlaceOf(id) {
  const db = S.db, n = new Map();
  stopsForPerson(id).forEach(s => n.set(s.place.id, (n.get(s.place.id) || 0) + (s.what === "Born" ? 0.5 : 1)));
  const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? db.placeById[best[0]] : null;
}
function peopleAt(id) {
  const db = S.db;
  return [...new Map([...db.momentsAt(id).map(m => m.person), ...db.eventsAt(id).flatMap(e => db.peopleInEvent(e.id).map(x => x.person)),
    ...(exploreIndex().worksAt.get(id) || []).map(x => db.byId[exploreIndex().creatorOf.get(x.work.id)]).filter(Boolean)]
    .map(p => [p.id, p])).values()];
}
function fill(kind, id) {
  const db = S.db, I = exploreIndex();
  X.hint = {};
  const set = { year: X.year, event: X.event, place: X.place, person: X.person, work: X.work };
  set[kind] = id;
  if (kind === "event") {
    const e = db.eventById[id], p = mainPersonOf(e);
    set.person = p?.id ?? null; set.year = e.start_year ?? null; set.place = e.place_id ?? null;
    const w = p && (I.worksBy.get(p.id) || []).filter(w => w.start_year != null).sort((a, b) => Math.abs(a.start_year - e.start_year) - Math.abs(b.start_year - e.start_year))[0];
    set.work = w?.id ?? null;
  } else if (kind === "person") {
    const p = db.byId[id], w = bestWorkOf(id), t = db.titlesOf(id)[0];
    // Someone known from a film (no works of their own) is shown at the first event the film portrays in their lifetime.
    const film = w ? null : filmAbout(p);
    const shown = film && !t ? film.shownEventIds.map(x => db.eventById[x]).filter(e => e?.start_year != null && aliveIn(p, e.start_year))
      .sort((a, b) => byYear(a.start_year, b.start_year))[0] : null;
    set.work = w?.id ?? film?.artId ?? null;
    set.year = (w && workYear(w)) ?? t?.start_year ?? shown?.start_year ?? (p.birth_year != null ? Math.min(p.birth_year + 35, p.death_year ?? Infinity) : p.death_year);
    set.place = (w && workPlace(w)?.id) ?? shown?.place_id ?? mainPlaceOf(id)?.id ?? film?.shownIds[0] ?? null;
  } else if (kind === "work" && db.eventById["f" + id]) {
    // A film fills the cards with what it shows: the person it is about, the place it is set in, and the first
    // event it portrays (and that event's year); its director is a click away.
    const f = db.eventById["f" + id];
    const first = f.shownEventIds.map(x => db.eventById[x]).filter(x => x?.start_year != null).sort((a, b) => byYear(a.start_year, b.start_year))[0];
    set.person = mainSubjectOf(f)?.id ?? I.creatorOf.get(id) ?? null;
    set.year = first?.start_year ?? f.start_year ?? null;
    set.place = f.shownIds[0] ?? first?.place_id ?? f.place_id ?? null;
    set.event = first?.id ?? null;
  } else if (kind === "work") {
    const w = I.workById[id];
    set.person = I.creatorOf.get(id) ?? null; set.year = workYear(w) ?? null;
    set.place = workPlace(w)?.id ?? (set.person != null ? mainPlaceOf(set.person)?.id : null) ?? null;
  } else if (kind === "place") {
    const ev = db.eventsAt(id).filter(e => !e.film).sort(evOrder)[0];
    const p = peopleAt(id).sort((a, b) => fame(b) - fame(a))[0];
    const w = (I.worksAt.get(id) || []).map(x => x.work).sort((a, b) => !!b.image_thumb - !!a.image_thumb)[0] || (p && bestWorkOf(p.id));
    // With no artwork here, a film set (or shot) here fills the Work card.
    const film = w ? null : db.filmsSetAt(id)[0] || db.eventsAt(id).find(e => e.film);
    set.person = p?.id ?? null; set.work = w?.id ?? film?.artId ?? null;
    set.year = ev?.start_year ?? (w && workYear(w)) ?? db.placeById[id].start_year ?? null;
  } else if (kind === "year") {
    const y = id;
    // The chosen country first; when it has nothing that year, the whole world (a country left from an earlier
    // search shouldn't empty the cards).
    const pick = C => {
      const ws = db.artworks.filter(w => w.start_year != null && overlaps(w.start_year, w.end_year ?? w.start_year, y, y) && I.creatorOf.has(w.id))
        .filter(w => !C || workCountry(w) === C)
        .sort((a, b) => !!b.image_thumb - !!a.image_thumb || fame(db.byId[I.creatorOf.get(b.id)]) - fame(db.byId[I.creatorOf.get(a.id)]));
      const ev = db.events.filter(e => !e.film && overlaps(e.start_year, e.end_year ?? e.start_year, y, y) && (!C || inCountryEvent(e, C)) && db.placeById[e.place_id]).sort(evOrder)[0];
      // Grown-ups only: the best-known person alive in 1812 shouldn't be a three-year-old Lincoln.
      const p = db.people.filter(p => aliveIn(p, y) && (p.birth_year == null || yearsBetween(p.birth_year, y) >= 18) && (!C || I.inCountryAt(p.id, C, y)))
        .sort((a, b) => fame(b) - fame(a))[0];
      return { ws, ev, p };
    };
    let { ws, ev, p } = pick(X.country || null);
    if (X.country && !ws.length && !ev && !p) ({ ws, ev, p } = pick(null));
    else if (X.country && !ws.length) {
      // Nothing made in the country that year: the Work card stays empty and offers the year's best work elsewhere.
      const other = pick(null).ws[0];
      X.hint.work = { text: `No work recorded in ${X.country} in ${fmtYear(y)}.`,
        links: other ? [{ kind: "work", id: other.id, label: `Elsewhere that year: ${other.name}, ${db.byId[I.creatorOf.get(other.id)]?.name}` }] : [] };
    }
    set.work = ws[0]?.id ?? null;
    set.person = ws[0] ? I.creatorOf.get(ws[0].id) : p?.id ?? null;
    // Where the work was made, or its artist's main place: not the museum that holds it now.
    const made = ws[0] && (I.placesOf.get(ws[0].id) || []).find(x => x.role !== "held" && x.role !== "displayed")?.place;
    set.place = ev ? ev.place_id : ws[0] ? (made ?? mainPlaceOf(I.creatorOf.get(ws[0].id)) ?? workPlace(ws[0]))?.id ?? null : null;
  }
  // A film already chose its event (the first one it portrays); everything else picks one for the year and place.
  const filmEvent = kind === "work" && db.eventById["f" + id] && set.event != null;
  if (kind !== "event" && !filmEvent) { const r = pickEvent(set, kind); set.event = r.id; if (r.hint) X.hint.event = r.hint; }
  // A year search: a big event (4-5 stars) brings its main person, as clicking it would ("1963" gives Kennedy).
  if (kind === "year" && set.event != null) {
    const e = db.eventById[set.event], p = (e.prominence ?? 3) >= 4 ? mainPersonOf(e) : null;
    if (p) { set.person = p.id; set.place = e.place_id ?? set.place; }
  }
  if (set.place == null && set.event != null) set.place = db.eventById[set.event]?.place_id ?? null;   // no place yet: the event's
  Object.assign(X, set);
}
// The event that goes with the other cards: the person's biggest event nearest the year, else the place's, else the year's.
function pickEvent(set, kind) {
  const db = S.db, y = set.year, near = e => y == null || e.start_year == null ? 0 : Math.abs(e.start_year - y);
  const best = es => es.filter(e => !e.film).sort((a, b) => near(a) - near(b) || evOrder(a, b))[0];
  const ofPerson = set.person != null ? best(db.eventsOf(set.person).map(x => x.event).filter(e => near(e) <= 10)) : null;
  const atPlace = set.place != null ? best(db.eventsAt(set.place).filter(e => near(e) <= 10)) : null;
  const thatYear = y != null ? db.events.filter(e => !e.film && overlaps(e.start_year, e.end_year ?? e.start_year, y, y)).sort(evOrder) : [];
  const inYear = thatYear.find(e => !X.country || inCountryEvent(e, X.country)), anywhere = thatYear[0];
  const nearInCountry = y != null && X.country ? best(db.events.filter(e => e.start_year != null && near(e) <= 10 && inCountryEvent(e, X.country))) : null;
  const sameYear = e => e && near(e) === 0 ? e : null;
  const here = set.place != null ? db.placeById[set.place] : null;
  const nearHere = hasPoint(here) ? thatYear.find(e => eventNear(e, here)) : null;
  // What really belongs with the other cards: for a year on its own, any event that year (the country's first);
  // otherwise the person's or the place's own event that year, or one that year within 50 km of the place.
  const fits = kind === "year" ? [inYear, anywhere] : (kind === "place" ? [atPlace, ofPerson] : [ofPerson, atPlace]).map(sameYear).concat(nearHere);
  const found = fits.find(Boolean);
  if (found || y == null) return { id: (found || ofPerson || atPlace)?.id ?? null };
  // Nothing fits: leave the card empty and offer the nearest things as links.
  const links = [];
  const add = (e, label) => e && !links.some(l => l.id === e.id) && links.push({ kind: "event", id: e.id, label });
  const pl = e => db.placeById[e.place_id]?.name;
  add(inYear || anywhere, e => `Elsewhere that year: ${e.name}${pl(e) ? `, ${pl(e)}` : ""}`);
  add(atPlace || ofPerson, e => `Nearest ${atPlace ? "here" : `for ${db.byId[set.person]?.name}`}: ${e.name} (${fmtYear(e.start_year)})`);
  add(nearInCountry, e => `Nearest in ${X.country}: ${e.name} (${fmtYear(e.start_year)})`);
  const where = kind === "year" ? (X.country ? ` in ${X.country}` : "") : hasPoint(here) ? ` near ${here.name}` : set.person != null ? ` for ${db.byId[set.person]?.name}` : "";
  return { id: null, hint: { text: `Nothing recorded${where} in ${fmtYear(y)}.`, links: links.map(l => ({ ...l, label: l.label(db.eventById[l.id]) })) } };
}

/* --- search */
// A search can hold a year and a name in either order ("London 1850", "1850 Michelangelo"). Names forgive
// small spelling slips ("Michaleanglo"): when nothing contains the words, the closest name within a few letters wins.
const YEAR_IN = /(?:^|\s)((?:AD\s*)?\d{1,4}\s*(?:BCE|BC|AD|CE)\b|AD\s*\d{1,4}|\d{3,4})(?=\s|$)/i;
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j), prev2 = null;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);   // swapped letters
    }
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}
const fold = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
function exploreSearch(text) {
  const db = S.db, I = exploreIndex();
  let t = text.trim(), year = null;
  if (!t) return { error: "Type a name, a place, a work or a year." };
  const m = t.match(YEAR_IN);
  if (m) {
    const f = parseQuery(m[1], db);
    if (f.from != null) { year = f.from; t = (t.slice(0, m.index) + " " + t.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim(); }
  }
  if (!t) return year != null ? { best: { kind: "year", id: year }, year } : { error: "Type a name, a place, a work or a year." };
  const q = fold(t.replace(/[,;:!?()"]+/g, " "));
  const score = name => {
    const n = fold(name);
    return !n ? 0 : n === q ? 3 : n.startsWith(q) ? 2 : (" " + n).includes(" " + q) ? 1 : n.includes(q) ? .5 : 0;
  };
  const country = I.countryList.find(c => fold(c) === q || Object.keys(COUNTRY_ALIAS).some(a => fold(a) === q && COUNTRY_ALIAS[a] === c));
  const records = [
    ...db.people.map(p => ({ kind: "person", id: p.id, name: p.name, names: [p.name], f: fame(p) })),
    ...Object.values(I.workById).filter(w => I.creatorOf.has(w.id)).map(w => ({ kind: "work", id: w.id, name: w.name, names: [w.name], f: (w.image_thumb ? 30 : 0) + fame(db.byId[I.creatorOf.get(w.id)]) })),
    ...db.places.map(pl => ({ kind: "place", id: pl.id, name: pl.name, names: [pl.name, pl.historical_name].filter(Boolean), f: db.eventsAt(pl.id).length * 5 + db.momentsAt(pl.id).length })),
    ...db.events.filter(e => !e.film).map(e => ({ kind: "event", id: e.id, name: e.name, names: [e.name], f: (e.prominence ?? 3) * 20 })),
  ];
  // A city, region or country whose name starts with the words beats a painting or event named after it, but not a
  // person whose whole name was typed ("Saint Peter" is the apostle, not Saint Petersburg).
  const AREA_KIND = /^(city|town|village|borough|district|county|region|state|province|country|island)$/i;
  let hits = records.map(r => ({ ...r, s: Math.max(...r.names.map(score)) })).filter(r => r.s);
  const exactPerson = hits.some(r => r.kind === "person" && r.s === 3);
  hits = hits.map(r => r.kind === "place" && r.s >= 2 && !(exactPerson && r.s < 3) && AREA_KIND.test(db.placeById[r.id]?.kind || "") ? { ...r, s: r.s + 1.5 } : r);
  // Words in any order, with endings ignored: "william wallace executed" finds "Execution of William Wallace".
  if (!hits.length) {
    const stem = w => w.slice(0, Math.max(4, Math.min(w.length, 6) - 1));
    const qw = q.split(" ").filter(w => w.length > 2 && !STOP.has(w)).map(stem);
    if (qw.length > 1) hits = records.map(r => {
      const nw = r.names.map(n => fold(n).split(/[^\p{L}\p{N}']+/u).filter(Boolean)).flat();
      const all = qw.every(q1 => nw.some(w => w.startsWith(q1) || q1.startsWith(w) && w.length > 3));
      return { ...r, s: all ? .8 : 0 };
    }).filter(r => r.s);
  }
  let fuzzy = false;
  if (!hits.length && q.length >= 4) {
    // Compare the words typed with every run of as many words in each name ("michaleanglo" ~ "michelangelo").
    const nq = q.split(" ").length, limit = Math.max(1, Math.min(3, Math.floor(q.length / 4)));
    hits = records.map(r => {
      let d = 99;
      r.names.forEach(name => { const w = fold(name).split(" "); for (let i = 0; i + nq <= w.length; i++) d = Math.min(d, editDistance(q, w.slice(i, i + nq).join(" "))); });
      return { ...r, s: d <= limit ? 1 - d / 10 : 0 };
    }).filter(r => r.s);
    fuzzy = hits.length > 0;
  }
  // Equal matches: a person, then a place, then an event, then a work ("New York" is the city, not "New York Movie").
  const KIND_RANK = { person: 0, place: 1, event: 2, work: 3 };
  hits.sort((a, b) => b.s - a.s || KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.f - a.f);
  // A film named after someone it portrays ("Oppenheimer"): the person leads, and the film fills the Work card.
  const film = hits[0]?.kind === "work" && db.eventById["f" + hits[0].id];
  if (film) {
    const p = hits.find(r => r.kind === "person" && film.portrayedIds.includes(r.id));
    if (p) hits = [p, ...hits.filter(r => r !== p)];
  }
  if (country && !(hits[0]?.s === 3 && hits[0].kind !== "place")) {
    // "Italy": pick the country, and open its busiest place.
    const pl = db.places.filter(p => placeCountry(p) === country).sort((a, b) => db.eventsAt(b.id).length - db.eventsAt(a.id).length)[0];
    return { country, year, best: pl ? { kind: "place", id: pl.id } : year != null ? { kind: "year", id: year } : null, also: hits.slice(0, 6) };
  }
  if (!hits.length) return { error: `Nothing called "${t}" yet. Try a person, a painting, a place or a year.` };
  return { best: hits[0], year, fuzzy, typed: t, also: hits.slice(1, 7) };
}
// Fill the cards from a record and a year together: the record keeps its card, the year its own, and every other
// card is chosen for that record at that time (the Event card too).
function fillAt(kind, id, y) {
  const db = S.db, I = exploreIndex(), near = (a, b) => Math.abs(a - b);
  fill(kind, id);
  X.year = y;
  const workNear = pid => (I.worksBy.get(pid) || []).filter(w => w.start_year != null).sort((a, b) => near(a.start_year, y) - near(b.start_year, y))[0];
  const placeNear = pid => stopsForPerson(pid).filter(s => s.year != null).sort((a, b) => near(a.year, y) - near(b.year, y))[0]?.place;
  if (kind === "work" || kind === "event") {
    // The work or event stays; its person's work and whereabouts closest to the year fill the rest.
    if (X.person != null) {
      if (kind === "event") { const w = workNear(X.person); if (w) X.work = w.id; }
      if (kind === "work") { const pl = placeNear(X.person); if (pl && !workPlace(I.workById[id])) X.place = pl.id; }
    }
  } else if (kind === "person") {
    const ws = (I.worksBy.get(id) || []).filter(w => w.start_year != null);
    const w = ws.sort((a, b) => near(a.start_year, y) - near(b.start_year, y))[0];
    if (w) X.work = w.id;
    const stop = stopsForPerson(id).filter(s => s.year != null).sort((a, b) => near(a.year, y) - near(b.year, y))[0];
    if (stop) X.place = stop.place.id;
  } else if (kind === "place") {
    const C = placeCountry(db.placeById[id]);
    // Someone recorded at the place near that year; else the best-known person in its country then.
    // Grown-ups only (a child born there that year isn't who you'd want), scored by how big and how close the event was.
    const adult = o => aliveIn(o, y) && (o.birth_year == null || yearsBetween(o.birth_year, y) >= 18);
    const score = new Map(), add = (o, v) => adult(o) && score.set(o.id, Math.max(score.get(o.id) ?? -1e9, v + fame(o) / 1000));
    db.momentsAt(id).forEach(m => m.year != null && near(m.year, y) <= 15 && add(m.person, 20 - near(m.year, y)));
    db.eventsAt(id).forEach(e => e.start_year != null && near(e.start_year, y) <= 15 &&
      db.peopleInEvent(e.id).forEach(x => add(x.person, (e.prominence ?? 3) * 10 - near(e.start_year, y))));
    const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
    const ruler = realmsAt(db.placeById[id], y).flatMap(r => db.titles.filter(t => t.realm === r && overlaps(t.start_year, t.end_year, y, y) && HEAD_OF_STATE(t.title)))
      .map(t => db.byId[t.entity_id]).filter(Boolean).sort((a, b) => fame(b) - fame(a))[0];
    const p = (best && db.byId[best[0]]) || ruler;
    const elsewhere = p ? null : db.people.filter(o => adult(o) && (!C || I.inCountryAt(o.id, C, y))).sort((a, b) => fame(b) - fame(a))[0];
    X.person = p?.id ?? null;
    X.hint.person = p ? null : { text: `Nobody recorded at ${db.placeById[id].name} around ${fmtYear(y)}.`,
      links: elsewhere ? [{ kind: "person", id: elsewhere.id, label: `Best known in ${C} then: ${elsewhere.name}` }] : [] };
    const ws = db.artworks.filter(w => w.start_year != null && near(workYear(w), y) <= 10 && I.creatorOf.has(w.id));
    // A work made here (or within 50 km) near then; one from elsewhere in the country is only offered as a link.
    const w = ws.filter(w => (I.placesOf.get(w.id) || []).some(x => x.role !== "held" && x.role !== "displayed" && (x.place.id === id || placeNear(x.place, db.placeById[id]))))
      .sort((a, b) => near(workYear(a), y) - near(workYear(b), y))[0];
    const inCountry = w ? null : ws.filter(w => C && workCountry(w) === C).sort((a, b) => !!b.image_thumb - !!a.image_thumb || fame(db.byId[I.creatorOf.get(b.id)]) - fame(db.byId[I.creatorOf.get(a.id)]))[0];
    X.work = w?.id ?? null;
    X.hint.work = w ? null : { text: `No work recorded as made at ${db.placeById[id].name} around ${fmtYear(y)}.`,
      links: inCountry ? [{ kind: "work", id: inCountry.id, label: `Elsewhere in ${C}: ${inCountry.name}, ${db.byId[I.creatorOf.get(inCountry.id)]?.name}` }] : [] };
  }
  if (kind !== "event") { const r = pickEvent(X, kind); X.event = r.id; X.hint.event = r.hint; }
  if (X.place == null && X.event != null) X.place = db.eventById[X.event]?.place_id ?? null;
}
function runExplore(text) {
  if (!S.db) { $("x-msg").textContent = "Still loading the history; try again in a moment."; return; }
  const r = exploreSearch(text), msg = $("x-msg"), db = S.db;
  msg.replaceChildren();
  if (r.error) { msg.textContent = r.error; return; }
  if (r.country) setCountry(r.country, false);
  if (r.best) {
    // What was searched sets the country first, so the Year and Event cards start there: a place's country, a
    // person's home, where a work was made, where an event happened.
    const I = exploreIndex(), b = r.best;
    const pc = b.kind === "place" ? placeCountry(db.placeById[b.id]) : b.kind === "person" ? I.homeOf(b.id)
      : b.kind === "work" ? workCountry(I.workById[b.id]) : b.kind === "event" ? [...eventCountries(db.eventById[b.id])][0] : null;
    if (pc && I_hasCountry(pc)) setCountry(pc, false);
    if (r.year != null && r.best.kind !== "year") fillAt(r.best.kind, r.best.id, r.year); else fill(r.best.kind, r.best.id);
    afterSearch(r.best.kind, r.year);
  }
  if (r.fuzzy) msg.append(`Showing ${r.best.name} (nothing is called "${r.typed}"). `);
  // A person searched with a year outside their life: say how far off it is.
  const p = r.best?.kind === "person" && r.year != null ? db.byId[r.best.id] : null;
  if (p && p.death_year != null && r.year > p.death_year) msg.append(`${p.name} died in ${fmtYear(p.death_year)}, ${yearsBetween(p.death_year, r.year)} years before ${fmtYear(r.year)}. `);
  if (p && p.birth_year != null && r.year < p.birth_year) msg.append(`${p.name} was born in ${fmtYear(p.birth_year)}, ${yearsBetween(r.year, p.birth_year)} years after ${fmtYear(r.year)}. `);
  const short = t => t.length > 40 ? t.slice(0, 38).trimEnd() + "…" : t;
  if (r.also?.length) msg.append("Also: ", ...joinNodes(r.also.slice(0, 5).map(x => h("span", {}, xBtn(short(x.name), `Show ${x.name}`, () => {
    if (r.year != null) fillAt(x.kind, x.id, r.year); else fill(x.kind, x.id);
    afterSearch(x.kind, r.year);
    msg.replaceChildren(); renderExplore(CARDS);
  }), h("span", { class: "yrs", text: ` ${x.kind}` })))));
  renderExplore(CARDS);
}
const I_hasCountry = c => exploreIndex().countryList.includes(c);

/* --- changing cards */
function xGo(kind, id) {
  X[kind] = id;
  if (X.hint) X.hint[kind] = null;
  renderExplore([kind]);
}
function xGoEvent(id) {
  if (X.hint) X.hint.event = null;
  const p = mainPersonOf(S.db.eventById[id]);
  X.event = id;
  if (p) X.person = p.id;
  renderExplore(p ? ["event", "person"] : ["event"]);
}
function setCountry(c, render = true) {
  X.country = c || ""; store.set("country", X.country);
  $("x-country").value = X.country;
  if (render) renderExplore(["year"]);
}
function syncExploreUrl() {
  if (S.viewMode !== "explore") return;
  const db = S.db, p = new URLSearchParams();
  if (X.year != null) p.set("y", yearQuery(X.year));
  if (X.place != null) p.set("place", db.placeById[X.place]?.key);
  if (X.person != null) p.set("person", db.byId[X.person]?.key);
  if (X.work != null) p.set("work", exploreIndex().workById[X.work]?.key);
  if (X.event != null && db.eventById[X.event]?.key) p.set("event", db.eventById[X.event].key);
  if (X.open) p.set("open", X.open);
  const qs = p.toString();
  try { history.replaceState(history.state, "", qs ? "?" + qs : location.pathname); } catch (e) {}
}
function readExploreUrl(params) {
  const db = S.db, I = exploreIndex();
  if (params.get("y")) { const f = parseQuery(params.get("y"), db); if (f.from != null) X.year = f.from; }
  const byKey = (list, k) => k ? list.find(r => r.key === k)?.id ?? null : null;
  X.place = byKey(db.places, params.get("place"));
  X.person = byKey(db.people, params.get("person"));
  X.work = params.get("work") ? Object.values(I.workById).find(w => w.key === params.get("work"))?.id ?? null : null;
  X.event = byKey(db.events, params.get("event"));
  if (db.eventById[X.event]?.film) { X.work = db.eventById[X.event].artId; X.event = null; }
  return CARDS.includes(params.get("open")) ? params.get("open") : null;
}
function expandCard(kind) {
  if (!X.open) { try { history.pushState({ xopen: kind }, ""); X.pushed = true; } catch (e) {} }
  X.open = kind;
  renderExplore([]);
  window.scrollTo(0, 0);
}
function shrinkCard(fromHistory = false) {
  const was = X.open;
  if (!was) return;
  X.open = null;
  if (X.pushed && !fromHistory) { X.pushed = false; history.back(); }   // the popstate that follows finds nothing open
  X.pushed = false;
  renderExplore([]);
  $("x-" + was)?.scrollIntoView({ block: "start" });
}

let xMap = null, xNoteTimer = null;
function renderExplore(changed = []) {
  if (changed.includes("year") && !changed.includes("world")) changed = [...changed, "world"];
  const box = $("x-cards");
  if (xMap) { xMap.remove(); xMap = null; }
  if (thenMap) { thenMap.remove(); thenMap = null; }
  cardSizer.disconnect();
  box.replaceChildren(...shownOrder().map(kind => {
    const full = X.open === kind;
    const hint = X[kind] == null && X.hint?.[kind];
    const body = hint ? hintCard(kind, hint) : { year: yearCard, world: worldCard, event: eventCard, place: placeCard, person: personCard, work: workCard }[kind]();
    const move = (d, sym, where) => h("button", { type: "button", class: "xmove", "data-d": d, onclick: () => moveCard(kind, d),
      title: `Move the ${CARD_LABEL[kind]} card ${where}`, "aria-label": `Move the ${CARD_LABEL[kind]} card ${where}`, text: sym });
    return h("section", { class: "xcard" + (full ? " full" : ""), id: "x-" + kind, "data-kind": kind, "aria-label": `${CARD_LABEL[kind]} card`, hidden: X.open && !full ? "" : null },
      h("div", { class: "xhead" + (full ? "" : " grab"), title: full ? null : "Drag to move this card" },
        h("span", { class: "xkind" }, full ? null : h("span", { class: "xgrip", "aria-hidden": "true", text: "⠿" }), CARD_LABEL[kind]),
        h("span", { class: "xtools" }, ...(full ? [] : [move(-1, "←", "earlier"), move(1, "→", "later")]),
          h("button", { type: "button", class: "xexp", "aria-expanded": full, onclick: () => full ? shrinkCard() : expandCard(kind),
            title: full ? "Back to the cards (Esc)" : `Fill the screen with the ${CARD_LABEL[kind]} card`, text: full ? "Shrink ✕" : "Expand ⤢" }))),
      ...body);
  }));
  markMoveEnds();
  box.querySelectorAll(".xcard").forEach(c => { sizeCard(c); cardSizer.observe(c); });
  document.body.classList.toggle("x-full", !!X.open);
  if (S.viewMode === "explore") {
    placeMap();
    placeBorderMap();
    syncExploreUrl();
  }
  // A card that changed lights up. Behind an expanded card, a note says what changed and opens it.
  changed.forEach(kind => {
    const c = $("x-" + kind);
    if (!c || c.hidden) return;
    c.classList.remove("hit"); void c.offsetWidth; c.classList.add("hit");
  });
  const behind = changed.filter(k => X.open && k !== X.open);
  if (behind.length) {
    const k = behind[0], card = $("x-" + X.open);
    const what = { year: () => fmtYear(X.year), event: () => S.db.eventById[X.event]?.name, place: () => S.db.placeById[X.place]?.name, person: () => S.db.byId[X.person]?.name, work: () => exploreIndex().workById[X.work]?.name }[k]();
    card.append(h("div", { class: "xnote", role: "status" }, `${CARD_LABEL[k]}: ${what ?? "cleared"} `,
      h("button", { type: "button", class: "btn", onclick: () => { X.open = k; renderExplore([]); window.scrollTo(0, 0); }, text: "Open" })));
  } else if (!X.open && changed.length === 1) {
    // On a phone the cards are stacked: bring the one that changed into view.
    const c = $("x-" + changed[0]), r = c.getBoundingClientRect();
    if (r.top < 0 || r.top > innerHeight * .6) c.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
}

// Reordering moves the card elements themselves rather than redrawing, so the maps inside keep their place.
function setCardOrder(order) {
  store.set("cardOrder", order); X.lift = [];
  const box = $("x-cards");
  order.forEach(k => { const c = $("x-" + k); if (c) box.append(c); });
  markMoveEnds();
  xMap?.invalidateSize();
  thenMap?.resize();
}
function moveCard(kind, d) {
  const order = shownOrder(), i = order.indexOf(kind), j = i + d;
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  setCardOrder(order);
  // Moving an element drops its focus: keep it on the same button (or the other one, at an end) so presses can repeat.
  const c = $("x-" + kind), b = c.querySelector(`.xmove[data-d="${d}"]`);
  (b.disabled ? c.querySelector(`.xmove[data-d="${-d}"]`) : b).focus();
  c.classList.remove("hit"); void c.offsetWidth; c.classList.add("hit");
}
function markMoveEnds() {
  const order = shownOrder();
  order.forEach((k, i) => $("x-" + k)?.querySelectorAll(".xmove").forEach(b => { b.disabled = b.dataset.d < 0 ? i === 0 : i === order.length - 1; }));
}
// Cards differ in height. The grid is cut into 2px rows and each card spans as many as it needs (plus the 14px gap),
// so the next card moves up into the space under a short one: cards fill up and to the left, still in order.
// Sized once when drawn, then again whenever a card changes height (a picture loads, a list opens).
const sizeCard = c => { const ht = c.getBoundingClientRect().height; if (ht) c.style.gridRowEnd = `span ${Math.ceil((ht + 14) / 2)}`; };
const cardSizer = new ResizeObserver(es => es.forEach(e => sizeCard(e.target)));
// Dragging, with pointer events so a mouse, a pen and a finger all work: the header is the handle (on a touch
// screen, its name and grip, so the rest of the header still scrolls the page). The card follows the pointer;
// letting go over another card puts it before or after that card, by which half of it the pointer is over.
function wireCardDrag() {
  const box = $("x-cards");
  let drag = null;
  const clear = () => box.querySelectorAll(".drop-before, .drop-after").forEach(c => c.classList.remove("drop-before", "drop-after"));
  // Which side of the target: side by side cards split left and right, a card filling the row splits top and bottom.
  const side = (c, e) => { const r = c.getBoundingClientRect(), wide = r.width > box.clientWidth * .75;
    return (wide ? e.clientY - r.top < r.height / 2 : e.clientX - r.left < r.width / 2) ? "before" : "after"; };
  // The card under the pointer, looking through the dragged card itself.
  const targetAt = e => document.elementsFromPoint(e.clientX, e.clientY).map(el => el.closest(".xcard")).find(c => c && c !== drag.card && box.contains(c)) || null;
  box.addEventListener("pointerdown", e => {
    const head = e.target.closest(".xhead.grab");
    if (!head || e.target.closest("button") || e.button !== 0) return;
    if (e.pointerType !== "mouse" && !e.target.closest(".xkind")) return;
    drag = { card: head.parentElement, x: e.pageX, y: e.pageY, on: false };
    try { head.setPointerCapture(e.pointerId); } catch (err) {}   // the pointer may already be gone
    e.preventDefault();   // no text selection
  });
  box.addEventListener("pointermove", e => {
    if (!drag) return;
    if (!drag.on) {
      if (Math.hypot(e.pageX - drag.x, e.pageY - drag.y) < 6) return;
      drag.on = true; drag.card.classList.add("dragging");
    }
    // Near the top or bottom of the window, scroll so a card can travel the whole stack on a phone.
    if (e.clientY < 60) scrollBy(0, -16); else if (e.clientY > innerHeight - 60) scrollBy(0, 16);
    drag.card.style.transform = `translate(${e.pageX - drag.x}px, ${e.pageY - drag.y}px)`;
    const c = targetAt(e), s = c && "drop-" + side(c, e);
    if (!c || !c.classList.contains(s)) { clear(); c?.classList.add(s); }
  });
  const end = (e, drop) => {
    if (!drag) return;
    const { card, on } = drag, c = on && drop ? targetAt(e) : null;
    card.classList.remove("dragging"); card.style.transform = "";
    clear(); drag = null;
    if (!c) return;
    const order = shownOrder().filter(k => k !== card.dataset.kind);
    order.splice(order.indexOf(c.dataset.kind) + (side(c, e) === "after" ? 1 : 0), 0, card.dataset.kind);
    setCardOrder(order);
    card.classList.remove("hit"); void card.offsetWidth; card.classList.add("hit");
  };
  box.addEventListener("pointerup", e => end(e, true));
  box.addEventListener("pointercancel", e => end(e, false));
  addEventListener("keydown", e => { if (e.key === "Escape" && drag) end(e, false); });
}

// A list that shows a few rows on the small card and everything when the card is expanded.
function xList(kind, items, n, row, empty) {
  if (!items.length) return empty ? h("p", { class: "hint", text: empty }) : null;
  const full = X.open === kind, shown = full ? items : items.slice(0, n);
  return [h("ul", { class: "xrows" }, ...shown.map(row)),
    shown.length < items.length ? h("button", { type: "button", class: "plink xmore", onclick: () => expandCard(kind), text: `${items.length - shown.length} more…` }) : null];
}
const xChips = (kind, people, n, label) => {
  if (!people.length) return null;
  const full = X.open === kind, shown = full ? people : people.slice(0, n);
  return h("div", { class: "xchips" }, ...shown.map(label),
    shown.length < people.length ? h("button", { type: "button", class: "plink xmore", onclick: () => expandCard(kind), text: `${people.length - shown.length} more…` }) : null);
};
const xSec = (title, ...kids) => { const k = kids.flat().filter(Boolean); return k.length ? h("div", { class: "xsec" }, h("h3", { text: title }), ...k) : null; };
const row2 = (left, right) => h("li", {}, h("span", {}, ...[left].flat()), h("span", { class: "yrs" }, ...[right].flat().filter(x => x != null)));

/* --- Year card */
function yearCard() {
  const y = X.year, db = S.db, I = exploreIndex(), C = X.country || null;
  if (y == null) return [h("p", { class: "hint", text: "Search a year (1504, 1066, 384 BC), or click one in another card." })];
  const head = h("div", { class: "xyear" }, xYear(prevYear(y), `← ${fmtYear(prevYear(y))}`), h("h2", { text: fmtYear(y) }), xYear(nextYear(y), `${fmtYear(nextYear(y))} →`));
  const titles = db.titles.filter(t => overlaps(t.start_year, t.end_year, y, y) && db.byId[t.entity_id]);
  const realmCountry = r => normCountry(db.countryOf[r]);
  const rulersRows = realms => realms.map(r => {
    const ts = titles.filter(t => t.realm === r).sort((a, b) => byYear(a.start_year, b.start_year));
    return h("li", {}, h("span", {}, h("b", { text: r }), " ", ...joinNodes(ts.map(t => xPerson(db.byId[t.entity_id], t.disputed ? " (disputed)" : "")))),
      h("span", { class: "yrs" }, C && !realmIn(r, C, y) && realmCountry(r) ? xBtn(realmCountry(r), `Put ${realmCountry(r)} first`, () => setCountry(realmCountry(r))) : null));
  });
  const realmsAll = [...new Set(titles.map(t => t.realm))].sort();
  const evs = db.events.filter(e => overlaps(e.start_year, e.end_year ?? e.start_year, y, y));
  const works = db.artworks.filter(w => w.start_year != null && overlaps(w.start_year, w.end_year ?? w.start_year, y, y) && I.creatorOf.has(w.id));
  const evRow = e => row2([xEvent(e), db.placeById[e.place_id] ? [" · ", xPlace(db.placeById[e.place_id])] : null], e.start_date ? fmtDate(e.start_date).replace(/ -?\d+$/, "") : null);
  const workRow = w => row2([xWork(w), " · ", xPerson(db.byId[I.creatorOf.get(w.id)])], workYear(w) === y ? "finished" : "in progress");
  const byFame = (a, b) => fame(b) - fame(a);
  const workFame = (a, b) => !!b.image_thumb - !!a.image_thumb || fame(db.byId[I.creatorOf.get(b.id)]) - fame(db.byId[I.creatorOf.get(a.id)]);
  const alive = db.people.filter(p => aliveIn(p, y)).sort(byFame);
  const personChip = p => h("span", { class: "xchip" }, xPerson(p), ageIn(p, y) != null ? h("span", { class: "yrs", text: ` ${ageIn(p, y)}` }) : null);
  const out = [head];
  if (C) {
    const here = db.placeById[X.place], herePl = here && placeCountry(here) === C ? here : null;
    const home = realmsAll.filter(r => realmIn(r, C, y) && realmFits(r, herePl));
    // Near the Place card's place first: that year's events within 50 km, works made there, people recorded there.
    if (hasPoint(here)) {
      const nearEv = evs.filter(e => eventNear(e, here)).sort(evOrder);
      const nearWorks = works.filter(w => (I.placesOf.get(w.id) || []).some(x => x.role !== "held" && x.role !== "displayed" && placeNear(x.place, here))).sort(workFame);
      const nearPeople = alive.filter(p => db.pp.some(m => m.entity_id === p.id && m.year != null && Math.abs(m.year - y) <= 3 && placeNear(db.placeById[m.place_id], here))
        || db.eventsOf(p.id).some(x => x.event.start_year != null && Math.abs(x.event.start_year - y) <= 3 && eventNear(x.event, here)));
      out.push(h("div", { class: "xband near" }, h("h3", { class: "xband-h", text: `Near ${here.name}` }),
        nearEv.length || nearWorks.length || nearPeople.length ? null : h("p", { class: "hint", text: `Nothing recorded within ${NEAR_PLACE_KM} km in ${fmtYear(y)} yet.` }),
        nearEv.length ? xSec("What happened", xList("year", nearEv, 5, evRow)) : null,
        nearWorks.length ? xSec("Works made", xList("year", nearWorks, 4, workRow)) : null,
        nearPeople.length ? xSec("Who was there", xChips("year", nearPeople, 8, personChip)) : null));
    }
    const hereEv = evs.filter(e => inCountryEvent(e, C)).sort(evOrder);
    const hereWorks = works.filter(w => workCountry(w) === C).sort(workFame);
    const makers = alive.filter(p => MAKER_TYPES.includes(p.type) && I.inCountryAt(p.id, C, y));
    out.push(h("div", { class: "xband" }, h("h3", { class: "xband-h", text: `In ${C}` }),
      xSec("Who ruled", xList("year", home, 6, r => rulersRows([r])[0], `No ruler in ${C} recorded for ${fmtYear(y)}.`)),
      xSec("What happened", xList("year", hereEv, 6, evRow, "No events recorded here this year.")),
      xSec("Works made", xList("year", hereWorks, 4, workRow)),
      xSec("Artists, writers and thinkers at work", xChips("year", makers, 8, personChip))));
  } else {
    // Without a country the Year card keeps what happened; who ruled where is on the World card.
    out.push(xSec("What happened", xList("year", evs.sort(evOrder), 6, evRow, "No events recorded this year.")),
      xSec("Works made", xList("year", works.sort(workFame), 4, workRow)),
      h("p", { class: "hint", text: "Pick a country above to see it first; the World card shows who ruled everywhere." }));
  }
  out.push(xSec("Influential people alive", xChips("year", alive, 10, personChip)));
  out.push(h("div", { class: "xfoot" }, h("button", { type: "button", class: "plink", onclick: () => openYear(y, y), text: "Open the Year view" }), " · ",
    h("button", { type: "button", class: "plink", onclick: toTimeline(() => run(rangeQuery(y - 10, y + 10), { pushTrail: true })), text: "See it on the timeline" })));
  return out;
}

// A card left empty on purpose: what's missing, and the nearest things as links.
function hintCard(kind, hint) {
  const go = l => l.kind === "event" ? xGoEvent(l.id) : xGo(l.kind, l.id);
  return [h("p", { class: "xempty", text: hint.text }),
    hint.links.length ? h("ul", { class: "xrows" }, ...hint.links.map(l => h("li", {}, h("span", {}, h("button", { type: "button", class: "plink", onclick: () => go(l), text: l.label }))))) : null];
}

/* --- World card: the world in the Year card's year, beside it */
// The border map for the year, who led each realm (grouped by region; outside the chosen country when there is one),
// and the year's big events elsewhere. A realm on the map or in the list puts its country first.
function worldCard() {
  const y = X.year, db = S.db, C = X.country || null, full = X.open === "world";
  if (y == null) return [h("p", { class: "hint", text: "Search a year, and the world in that year shows here: its borders and who led each realm." })];
  const titles = db.titles.filter(t => overlaps(t.start_year, t.end_year, y, y) && db.byId[t.entity_id]);
  const realmCountry = r => normCountry(db.countryOf[r]);
  const realmsAll = [...new Set(titles.map(t => t.realm))];
  const here = db.placeById[X.place], herePl = C && here && placeCountry(here) === C ? here : null;
  const away = realmsAll.filter(r => !C || !(realmIn(r, C, y) && realmFits(r, herePl)));
  const regionOf = r => db.regionOf[r] || "Other";
  away.sort((a, b) => REGIONS.indexOf(regionOf(a)) - REGIONS.indexOf(regionOf(b)) || a.localeCompare(b));
  // A realm's leaders that year: its sovereign or president first.
  const leaderRow = (r, withRegion) => {
    const ts = titles.filter(t => t.realm === r).sort((a, b) => !HEAD_OF_STATE(a.title) - !HEAD_OF_STATE(b.title) || byYear(a.start_year, b.start_year));
    const realmBtn = xBtn(r, `Put ${realmCountry(r) || r} first`, () => realmCountry(r) && setCountry(realmCountry(r)));
    realmBtn.classList.add("xrealm");
    return h("li", {}, h("span", {}, realmBtn, " ",
        ...joinNodes(ts.map(t => xPerson(db.byId[t.entity_id], t.disputed ? " (disputed)" : "")))),
      h("span", { class: "yrs", text: withRegion ? regionOf(r) : realmCountry(r) || "" }));
  };
  const byRegion = REGIONS.flatMap(g => {
    const rs = away.filter(r => regionOf(r) === g);
    return rs.length ? [h("li", { class: "xregion", text: g }), ...rs.map(r => leaderRow(r, false))] : [];
  });
  const big = db.events.filter(e => !e.film && overlaps(e.start_year, e.end_year ?? e.start_year, y, y) && (e.prominence ?? 3) >= 4 && (!C || !inCountryEvent(e, C))).sort(evOrder);
  const evRow = e => row2([xEvent(e), db.placeById[e.place_id] ? [" · ", xPlace(db.placeById[e.place_id])] : null], [...eventCountries(e)][0] || null);
  return [
    h("h2", { text: `The world in ${fmtYear(y)}` }),
    C ? h("div", { class: "xsub", text: `Outside ${C}` }) : null,
    yearMap(y, y, realmsAll, r => realmCountry(r) && setCountry(realmCountry(r))),
    xSec(C ? "Who led elsewhere" : "Who led", full ? h("ul", { class: "xrows" }, ...byRegion)
      : xList("world", away, 8, r => leaderRow(r, true), `No rulers recorded for ${fmtYear(y)}${C ? ` outside ${C}` : ""}.`)),
    big.length ? xSec("Big events elsewhere", xList("world", big, 4, evRow)) : null,
    h("div", { class: "xfoot" }, h("button", { type: "button", class: "plink", onclick: () => openYear(y, y), text: "Open the Year view" })),
  ];
}

/* --- Event card */
function eventCard() {
  const db = S.db, e = db.eventById[X.event];
  if (!e) return [h("p", { class: "hint", text: "Search an event (Battle of Hastings, William Wallace executed), or click one in another card." })];
  const pl = db.placeById[e.place_id], ppl = db.peopleInEvent(e.id), main = mainPersonOf(e);
  const when = e.start_date ? fmtDate(e.start_date) : fmtYear(e.start_year);
  const stars = e.prominence ? "★".repeat(e.prominence) + "☆".repeat(5 - e.prominence) : null;
  // Around it: other events with the same people or at the same place, within ten years, in date order.
  const ids = new Set(ppl.map(x => x.person.id));
  const around = e.start_year == null ? [] : db.events.filter(o => o.id !== e.id && !o.film && o.start_year != null && Math.abs(o.start_year - e.start_year) <= 10
    && ((o.place_id != null && o.place_id === e.place_id) || db.peopleInEvent(o.id).some(x => ids.has(x.person.id))))
    .sort((a, b) => byYear(a.start_year, b.start_year) || (a.start_date || "").localeCompare(b.start_date || ""));
  const venues = (e.venues || []).map(v => ({ v, pl: db.placeById[v.place_id] })).filter(x => x.pl);
  const films = db.filmsAbout(e.id);
  return [
    h("h2", { text: e.name }),
    h("div", { class: "xsub" }, [e.type, null].filter(Boolean).join(""), e.type ? " · " : "",
      e.start_year != null ? xYear(e.start_year, (e.estimated ? "c. " : "") + when) : "date unknown",
      e.end_year != null && e.end_year !== e.start_year ? ["–", xYear(e.end_year)] : null,
      pl ? [" · ", xPlace(pl, pl.historical_name ? ` (then ${pl.historical_name})` : "")] : e.location ? ` · ${e.location}` : null,
      stars ? h("span", { class: "yrs", title: `Prominence ${e.prominence} of 5`, text: ` ${stars}` }) : null),
    e.note ? h("p", { class: "xnote-text", text: e.note }) : null,
    xSec("Who took part", ppl.length ? xChips("event", ppl.sort((a, b) => (b.person === main) - (a.person === main) || fame(b.person) - fame(a.person)), 8,
      x => h("span", { class: "xchip" }, xPerson(x.person), x.role ? h("span", { class: "yrs", text: ` ${x.role}` }) : null)) : h("p", { class: "hint", text: "Nobody linked yet." })),
    venues.length ? xSec(`Places (${venues.length})`, xList("event", venues, 4, x => row2(xPlace(x.pl), x.v.note || x.v.role))) : null,
    films.length ? xSec(`Films about it (${films.length})`, xList("event", films, 3, f => row2(xFilm(f), xYear(f.start_year)))) : null,
    around.length ? xSec("Around it", xList("event", around, 5, o => row2(xEvent(o), xYear(o.start_year)))) : null,
    e.visitable_today ? xSec("Visit today", h("p", { class: "xnote-text", text: e.visit_site || (pl ? pl.name : "Yes") })) : null,
    h("div", { class: "xfoot" }, "Sources: ", ...sourceLinks(db.sourcesFor("event", e.key)), " · ",
      h("button", { type: "button", class: "plink", onclick: toTimeline(() => revealEvent(e.id)), text: "See it on the timeline" })),
  ];
}

// A film in the Work card: who made it, the places and events it shows, where it was shot, and its entries in
// the entertainment database and TMDB.
function filmCard(e) {
  const db = S.db;
  const set = e.shownIds.map(id => db.placeById[id]).filter(Boolean);
  const shows = e.shownEventIds.map(id => db.eventById[id]).filter(Boolean).sort((a, b) => byYear(a.start_year, b.start_year));
  const shot = e.placeIds.map(id => db.placeById[id]).filter(Boolean);
  const ext = externalRow("artwork", e.key)[0];
  return [
    h("h2", { text: e.name }),
    h("div", { class: "xsub" }, "Film · ", xYear(e.start_year, (e.estimated ? "c. " : "") + fmtYear(e.start_year))),
    e.note ? h("p", { class: "xnote-text", text: e.note }) : null,
    xSec("Directed by", xChips("event", db.peopleInEvent(e.id), 4, x => h("span", { class: "xchip" }, xPerson(x.person)))),
    xSec("Portrays", xChips("event", db.portrayedIn(e).sort((a, b) => fame(b) - fame(a)), 8, p => h("span", { class: "xchip" }, xPerson(p)))),
    shows.length ? xSec("Shows", xList("event", shows, 5, o => row2(xEvent(o), xYear(o.start_year)))) : null,
    set.length ? xSec("Set in", xList("event", set, 5, pl => row2(xPlace(pl), cap(pl.kind || "")))) : null,
    shot.length ? xSec("Filmed at", xList("event", shot, 5, pl => row2(xPlace(pl), cap(pl.kind || "")))) : null,
    ext ? xSec("Elsewhere", h("p", { class: "xnote-text" }, ...ext[1])) : null,
    h("div", { class: "xfoot" }, "Sources: ", ...sourceLinks(db.sourcesFor("artwork", e.key)), " · ",
      h("button", { type: "button", class: "plink", onclick: toTimeline(() => revealEvent(e.id)), text: "See it on the timeline" })),
  ];
}

/* --- Place card (the map is drawn after the card is in the page) */
function placeCard() {
  const db = S.db, I = exploreIndex(), pl = db.placeById[X.place];
  if (!pl) return [h("p", { class: "hint", text: "Search a place (Florence, Westminster Abbey), tap Near me, or click one in another card." }), h("div", { class: "xmap", id: "x-map" })];
  const where = [...new Set([pl.city, pl.region, pl.modern_country].filter(Boolean))].filter(v => v !== pl.name).join(", ");
  const here = db.eventsAt(pl.id).sort((a, b) => byYear(a.start_year, b.start_year) || (a.start_date || "").localeCompare(b.start_date || ""));
  const events = here.filter(e => !e.film), films = here.filter(e => e.film), setHere = db.filmsSetAt(pl.id);
  const moments = db.momentsAt(pl.id).sort((a, b) => byYear(a.year, b.year));
  const happened = [...events.map(e => ({ y: e.start_year, node: [xEvent(e)] })),
    ...moments.map(m => ({ y: m.year, node: [xPerson(m.person), ` ${m.role}`] }))].sort((a, b) => byYear(a.y, b.y));
  const works = I.worksAt.get(pl.id) || [];
  const near = nearbyList(pl);
  const fmtKm = km => km < .95 ? `${Math.round(km * 10) * 100} m` : `${km.toFixed(1)} km`;
  const dining = diningOn(pl) ? h("div", { class: "xsec" }, h("h3", { text: "Eat and drink nearby" }), h("p", { class: "hint", id: "x-dining", text: "Looking…" })) : null;
  return [
    h("h2", { text: pl.name }),
    h("div", { class: "xsub", text: [cap(pl.kind), where, pl.historical_name ? `then ${pl.historical_name}` : null].filter(Boolean).join(" · ") }),
    partOf(pl),
    h("div", { class: "xmap", id: "x-map" }),
    h("div", { class: "xborder", id: "x-border", hidden: "" }),
    xSec("What happened here", xList("place", happened, 6, x => row2(x.node, xYear(x.y)), "Nothing recorded here yet.")),
    setHere.length ? xSec(`Films set here (${setHere.length})`, xList("place", setHere, 3, e => row2([xFilm(e),
      ...(db.portrayedIn(e).length ? [" · ", ...joinNodes(db.portrayedIn(e).slice(0, 3).map(p => xPerson(p)))] : [])], xYear(e.start_year)))) : null,
    films.length ? xSec(`Films shot here (${films.length})`, xList("place", films, 3, e => row2(xFilm(e), xYear(e.start_year)))) : null,
    xSec("Shown in", xList("place", works.filter(x => x.role === "depicts"), 4, x => row2([xWork(x.work), I.creatorOf.has(x.work.id) ? ` · ${db.byId[I.creatorOf.get(x.work.id)]?.name}` : ""],
      workSpan(x.work) ? xYear(workYear(x.work), workSpan(x.work)) : null))),
    xSec("Works made or held here", xList("place", works.filter(x => x.role !== "depicts"), 4, x => row2([xWork(x.work), ` (${x.role})`], workSpan(x.work) ? xYear(workYear(x.work), workSpan(x.work)) : null))),
    xSec("Who was here", xChips("place", peopleAt(pl.id).sort((a, b) => fame(b) - fame(a)), 8, p => h("span", { class: "xchip" }, xPerson(p)))),
    xSec(`Nearby (within ${NEARBY_KM} km)`, xList("place", near, 5, x => row2(xPlace(x.o), fmtKm(x.km)))),
    dining,
    pl.note ? h("p", { class: "xnote-text", text: pl.note }) : null,
    h("div", { class: "xfoot" }, "Sources: ", ...sourceLinks(db.sourcesFor("place", pl.key))),
  ];
}
// Which realm a place was in, in the Year card's year. Where a border map covers the year (data/maps), the place's
// own point decides ("Paris in 1200: Kingdom of France"); elsewhere the realms that covered its country are listed.
async function mapRealmsAt(pl, y) {
  if (!window.d3 || pl.lat == null || pl.lng == null || y == null) return null;
  const idx = await mapIndex();
  if (!idx) return null;
  const snap = Object.keys(idx.years).map(Number).sort((a, b) => a - b).filter(v => v <= y && y - v < 100).pop();
  if (snap == null) return null;
  const geo = await mapGeo(idx.years[snap]), pt = [Number(pl.lng), Number(pl.lat)];
  const hits = geo.features.filter(f => d3.geoContains(f, pt)).map(f => f.properties || {});
  // One map name can stand for several of our realms ("United Kingdom" for Great Britain, then the United Kingdom):
  // keep those that existed in the year, and of those, the ones with a ruler then if any have one.
  const db = S.db, alive = r => { const i = db.realmInfo[r] || {}; return i.start == null && i.end == null || overlaps(i.start ?? -1e9, i.end, y, y); };
  const all = [...new Set(hits.flatMap(pr => Object.entries(idx.realms).filter(([, ns]) => ns.includes(pr.NAME) || ns.includes(pr.SUBJECTO)).map(([r]) => r)))].filter(alive);
  const ruled = all.filter(r => db.titles.some(t => t.realm === r && overlaps(t.start_year, t.end_year, y, y)));
  return { snap, realms: ruled.length ? ruled : all, names: [...new Set(hits.map(pr => pr.NAME).filter(Boolean))] };
}
// The Place card's border map: the place on the border snapshot for the Year card's year (data/maps, GPL-3.0), with
// the realm it lies in shaded. Beside the street map (today), it shows the same spot as it was then.
async function placeBorderMap() {
  const host = $("x-border"), db = S.db, pl = db.placeById[X.place], y = X.year;
  if (!host || !pl || pl.lat == null || pl.lng == null || y == null || !window.d3) return;
  const idx = await mapIndex();
  const snap = idx && Object.keys(idx.years).map(Number).sort((a, b) => a - b).filter(v => v <= y && y - v < 100).pop();
  if (snap == null) return;
  const geo = await mapGeo(idx.years[snap]);
  if (!host.isConnected || X.place !== pl.id || X.year !== y) return;   // the card changed meanwhile
  const pt = [Number(pl.lng), Number(pl.lat)], full = X.open === "place";
  const W = 340, H = full ? 240 : 190, spanLng = full ? 14 : 9, spanLat = spanLng * .62;
  const proj = d3.geoMercator().fitExtent([[0, 0], [W, H]],
    { type: "MultiPoint", coordinates: [[pt[0] - spanLng, pt[1] - spanLat], [pt[0] + spanLng, pt[1] + spanLat]] }).clipExtent([[0, 0], [W, H]]);
  const path = d3.geoPath(proj);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "histmap", role: "img", "aria-label": `${pl.name} on the borders of about ${snap}` });
  el("rect", { width: W, height: H, class: "hm-sea" }, svg);
  const g = el("g", {}, svg);
  const here = geo.features.filter(f => d3.geoContains(f, pt));
  geo.features.forEach(f => {
    const d = path(f);
    if (!d) return;
    const p = el("path", { d, class: "hm-land" + (here.includes(f) ? " ruled" : "") }, g);
    el("title", {}, p).textContent = (f.properties || {}).NAME || "Unnamed";
  });
  const [x, yy] = proj(pt);
  el("circle", { cx: x, cy: yy, r: 4.5, class: "xb-pin" }, g);
  const name = here.map(f => (f.properties || {}).NAME).filter(Boolean)[0];
  if (name) {
    const t = el("text", { x: x + 8, y: yy - 7, class: "xb-label" }, g);
    t.textContent = name;
  }
  host.replaceChildren(
    h("h3", { class: "xb-head", text: `Borders around ${snap}` }),
    h("div", { class: "histmap-box" }, svg),
    h("p", { class: "hint map-credit" }, `Approximate. ${name ? `Shaded: ${name}. ` : ""}Map data: `,
      h("a", { class: "ext", href: idx.source, target: "_blank", rel: "noopener", text: "historical-basemaps" }), " by André Ourednik, ",
      h("a", { class: "ext", href: "data/maps/LICENSE", text: "GPL-3.0" }), "."));
  host.hidden = false;
}
function partOf(pl) {
  const db = S.db, y = X.year;
  if (y == null) return null;
  const sovereign = t => HEAD_OF_STATE(t.title) ? 0 : 1;
  const realmNode = r => {
    const ts = db.titles.filter(t => t.realm === r && overlaps(t.start_year, t.end_year, y, y) && db.byId[t.entity_id]).sort((a, b) => sovereign(a) - sovereign(b));
    const note = (db.realmInfo[r]?.countries || []).find(c => normCountry(c.country) === placeCountry(pl))?.note;
    return h("span", {}, h("b", { text: r }), note ? h("span", { class: "yrs", text: ` (${note})` }) : null, ts.length ? [" · ", xPerson(db.byId[ts[0].entity_id])] : null);
  };
  const box = h("div", { class: "xpartof" });
  // Without a map: realms whose main country it is come first; those that held only part of it (a note says which
  // part) fold into "N more", which opens the full list.
  const C = placeCountry(pl), partial = r => !!(db.realmInfo[r]?.countries || []).find(c => normCountry(c.country) === C)?.note;
  const byCountry = realmsAt(pl, y).sort((a, b) => (normCountry(db.countryOf[b]) === C) - (normCountry(db.countryOf[a]) === C) || partial(a) - partial(b));
  const whole = byCountry.filter(r => !partial(r)).slice(0, 3), shown = whole.length ? whole : byCountry.slice(0, 3);
  const rest = byCountry.filter(r => !shown.includes(r));
  if (byCountry.length) {
    const more = rest.length ? h("button", { type: "button", class: "plink", text: `and ${rest.length} more`, title: rest.join(", "),
      onclick: e => { e.target.previousSibling?.remove(); e.target.replaceWith(", ", ...joinNodes(rest.map(realmNode))); } }) : null;
    box.append(h("span", { class: "lbl", text: `Realms in ${C}, ${fmtYear(y)}` }), " ", ...joinNodes(shown.map(realmNode)), ...(more ? [" ", more] : []));
  }
  mapRealmsAt(pl, y).then(r => {
    if (!r || X.place !== pl.id || X.year !== y || !box.isConnected) return;
    const parts = r.realms.length ? r.realms.map(realmNode) : r.names.map(n => h("b", { text: n }));
    if (!parts.length) return;
    box.replaceChildren(h("span", { class: "lbl", text: `In ${fmtYear(y)}, part of` }), " ", ...joinNodes(parts),
      h("span", { class: "yrs", title: "Borders from historical-basemaps (GPL-3.0), approximate", text: ` · ${r.snap} map` }));
  }).catch(() => {});
  return box;
}
// Spots within walking distance (areas such as cities are left out: they have a centre, not a spot).
function nearbyList(pl) {
  if (pl.lat == null || pl.lng == null) return [];
  const AREA = /^(city|town|village|hamlet|township|borough|district|neighbourhood|county|region|island|strait|country)$/i;
  return S.db.places.filter(o => o.id !== pl.id && o.lat != null && o.lng != null && !AREA.test(o.kind || ""))
    .map(o => ({ o, km: kmBetween(pl, o) })).filter(x => x.km <= NEARBY_KM).sort((a, b) => a.km - b.km);
}
// The Place card's street map ties the cards together: the place and the spots around it, the person's places,
// where the work was made and is now, and the year's events in the chosen country. A pin opens its place.
function placeMap() {
  const host = $("x-map");
  if (!host || !window.L) return;
  const db = S.db, I = exploreIndex(), pl = db.placeById[X.place];
  const css = getComputedStyle(document.documentElement), color = v => css.getPropertyValue(v).trim();
  const layers = [];
  const pt = p => p && p.lat != null && p.lng != null ? [Number(p.lat), Number(p.lng)] : null;
  if (pl && pt(pl)) layers.push({ key: "here", label: "Here and nearby", color: "--ink", places: [pl, ...nearbyList(pl).slice(0, 12).map(x => x.o)] });
  const person = db.byId[X.person];
  if (person) {
    const ps = [...new Map(stopsForPerson(person.id).map(s => [s.place.id, s.place])).values()].filter(pt);
    if (ps.length) layers.push({ key: "person", label: `${person.name}'s places`, color: "--woad", places: ps, route: true });
  }
  const w = I.workById[X.work];
  if (w) { const ps = (I.placesOf.get(w.id) || []).map(x => x.place).filter(pt); if (ps.length) layers.push({ key: "work", label: w.name, color: "--madder", places: ps }); }
  if (X.year != null) {
    const ps = db.events.filter(e => !e.film && overlaps(e.start_year, e.end_year ?? e.start_year, X.year, X.year) && (!X.country || inCountryEvent(e, X.country)))
      .map(e => db.placeById[e.place_id]).filter(pt);
    if (ps.length) layers.push({ key: "year", label: `Events in ${fmtYear(X.year)}`, color: "--ochre", places: [...new Map(ps.map(p => [p.id, p])).values()] });
  }
  if (!layers.length) { host.replaceChildren(h("p", { class: "hint", text: pl ? `No map position recorded for ${pl.name}.` : "" })); host.classList.add("empty"); return; }
  const box = h("div", { class: "street-map" });
  const legend = h("div", { class: "xlegend" });
  // Then / Today: the same spot on OpenHistoricalMap as it was in the Year card's year (streets and buildings that
  // volunteers have mapped with dates), or today's OpenStreetMap.
  const thenBox = h("div", { class: "street-map then-map", hidden: "" });
  const thenNote = h("p", { class: "hint map-credit", hidden: "" });
  const canThen = pl && pt(pl) && X.year != null;
  const seg = canThen ? h("div", { class: "seg xthen", role: "group", "aria-label": "Map shows" },
    h("button", { type: "button", "aria-pressed": !X.mapThen, onclick: () => { X.mapThen = false; showThen(false); }, text: "Today" }),
    h("button", { type: "button", "aria-pressed": !!X.mapThen, onclick: () => { X.mapThen = true; showThen(true); }, text: `Then (${fmtYear(X.year)})` })) : null;
  host.replaceChildren(...[seg, box, thenBox, thenNote, legend].filter(Boolean));
  const showThen = on => {
    seg?.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", i ? on : !on));
    box.hidden = on; legend.hidden = on; thenBox.hidden = !on; thenNote.hidden = !on;
    if (on) drawThenMap(thenBox, thenNote, pl, X.year);
    else xMap?.invalidateSize();
  };
  xMap = L.map(box, { scrollWheelZoom: X.open === "place", zoomControl: true, attributionControl: true });
  xMap.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(xMap);
  const fitTo = ps => { const ll = ps.map(pt); if (new Set(ll.map(String)).size === 1) xMap.setView(ll[0], 15); else xMap.fitBounds(ll, { padding: [24, 24], maxZoom: 16 }); };
  layers.slice().reverse().forEach(layer => {
    if (layer.route && layer.places.length > 1) L.polyline(layer.places.map(pt), { color: color(layer.color), weight: 2, opacity: .6, dashArray: "4 4" }).addTo(xMap);
    layer.places.forEach((p, i) => {
      const main = layer.key === "here" && i === 0;
      const icon = L.divIcon({ className: "street-pin-wrap", iconSize: null,
        html: `<span class="street-pin${main ? "" : " small"}" style="background:var(${layer.color})"></span>` });
      const m = L.marker(pt(p), { icon, keyboard: true, title: p.name, alt: p.name, zIndexOffset: main ? 1000 : 0 }).addTo(xMap);
      m.bindTooltip(p.name, { direction: "top", offset: [0, -8] });
      m.on("click", () => xGo("place", p.id));
    });
    legend.prepend(h("button", { type: "button", class: "xleg", title: `Fit the map to: ${layer.label}`, onclick: () => fitTo(layer.places) },
      h("i", { class: "sw", style: `background:var(${layer.color})` }), `${layer.label}${layer.places.length > 1 ? ` (${layer.places.length})` : ""}`));
  });
  // Start on the place and its neighbourhood; the other layers are a tap away in the legend.
  fitTo(layers[0].places.slice(0, layers[0].key === "here" ? 6 : undefined));
  if (canThen && X.mapThen) showThen(true);
  if (pl && diningOn(pl)) {
    const map = xMap;
    fetchDining(pl).then(rows => {
      const out = $("x-dining");
      if (out) out.replaceChildren(...joinNodes(rows.map(diningLabel), `No Metro Advisor picks within ${NEARBY_KM} km`));
      if (xMap === map) diningPins(rows, map, false);
    }).catch(() => { const out = $("x-dining"); if (out) out.textContent = "Couldn't reach the dining database just now."; });
  }
}

// OpenHistoricalMap (public domain, CC0) needs MapLibre GL and OHM's date filter; both load only when "Then" is first
// picked. The map shows what was there in that year, as far as volunteers have mapped it, so coverage varies.
const loadScript = src => new Promise((ok, fail) => { const t = h("script", { src }); t.onload = ok; t.onerror = fail; document.head.append(t); });
let maplibreReady = null, thenMap = null;
function loadMaplibre() {
  return maplibreReady ??= (async () => {
    document.head.append(h("link", { rel: "stylesheet", href: "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.css" }));
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.js");
    await loadScript("https://cdn.jsdelivr.net/npm/@openhistoricalmap/maplibre-gl-dates@1.3.0/index.js");
  })().catch(e => { maplibreReady = null; throw e; });
}
async function drawThenMap(box, note, pl, y) {
  note.textContent = "Loading the historical map…";
  try { await loadMaplibre(); } catch (e) { note.textContent = "Couldn't load the historical map just now."; return; }
  if (!box.isConnected) return;
  if (thenMap) { thenMap.remove(); thenMap = null; }
  box.replaceChildren();
  const map = thenMap = new maplibregl.Map({ container: box, style: "https://www.openhistoricalmap.org/map-styles/main/main.json",
    // Opens on the whole world in that year (OHM draws the period's borders at low zoom), centred on the place;
    // zooming in reaches its streets.
    center: [Number(pl.lng), Number(pl.lat)], zoom: 1.6, attributionControl: false, cooperativeGestures: X.open !== "place" });
  map.addControl(new maplibregl.AttributionControl({ compact: false,
    customAttribution: '<a href="https://www.openhistoricalmap.org/copyright" target="_blank" rel="noopener">OpenHistoricalMap</a> contributors' }));
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
  new maplibregl.Marker({ color: getComputedStyle(document.documentElement).getPropertyValue("--madder").trim() || undefined })
    .setLngLat([Number(pl.lng), Number(pl.lat)]).addTo(map);
  // The date filter needs the year as an ISO date; BC years are negative ("-0384").
  const iso = (y < 0 ? "-" : "") + String(Math.abs(y)).padStart(4, "0");
  map.once("styledata", () => { try { map.filterByDate(iso); } catch (e) { console.warn("OHM date filter:", e); } });
  note.replaceChildren(`${pl.name} as mapped for ${fmtYear(y)} on `,
    h("a", { class: "ext", href: `https://www.openhistoricalmap.org/#map=15/${Number(pl.lat).toFixed(4)}/${Number(pl.lng).toFixed(4)}&date=${iso}`, target: "_blank", rel: "noopener", text: "OpenHistoricalMap ↗" }),
    ". Zoom in for its streets; volunteers map the past street by street, so some places and years are still blank.");
}

/* --- Person card */
function personCard() {
  const db = S.db, I = exploreIndex(), p = db.byId[X.person];
  if (!p) return [h("p", { class: "hint", text: "Search a person (Michelangelo, Henry VIII), or click one in another card." })];
  const works = I.worksBy.get(p.id) || [], dated = works.filter(w => w.start_year != null), undated = works.filter(w => w.start_year == null);
  const evs = db.eventsOf(p.id).filter(x => !x.event.film).sort((a, b) => byYear(a.event.start_year, b.event.start_year));
  const portrayed = db.filmsPortraying(p.id);
  const titles = db.titlesOf(p.id);
  const roles = (p.roles || []).slice(0, 3).join(", ");
  const countries = [...I.countriesOf(p.id)];
  // Contemporaries: both alive, and grown up, for at least 15 years together.
  const life = o => [o.birth_year ?? o.death_year - 60, o.death_year ?? o.birth_year + 60];
  const together = o => { const [a1, b1] = life(p), [a2, b2] = life(o); return Math.min(b1, b2) - Math.max(a1 + 15, a2 + 15); };
  const contemporaries = p.birth_year != null || p.death_year != null
    ? db.people.filter(o => o.id !== p.id && (o.birth_year != null || o.death_year != null) && together(o) >= 15).sort((a, b) => fame(b) - fame(a)) : [];
  const family = [...db.parentsOf(p.id).map(x => [x, "parent"]), ...db.spousesOf(p.id).map(s => [s.person, "spouse"]), ...db.childrenOf(p.id).map(x => [x, "child"])];
  const wiki = wikiFor(p);
  return [
    h("div", { class: "xperson" }, ...(personPicture(p) || []),
      h("div", {}, h("h2", { text: p.name }),
        h("div", { class: "xsub" }, xYear(p.birth_year, (p.birth_estimated ? "c. " : "") + (fmtYear(p.birth_year) ?? "?")), "–", xYear(p.death_year, fmtYear(p.death_year) ?? "?"),
          ` · ${p.type || "Person"}${roles ? " · " + roles : ""}`),
        countries.length ? h("div", { class: "xsub" }, ...joinNodes(countries.map(c => xBtn(c, `Put ${c} first in the Year card`, () => setCountry(c))))) : null,
        wiki ? h("a", { class: "ext", href: wiki.url, target: "_blank", rel: "noopener", text: "Wikipedia ↗" }) : null)),
    lifeStrip(p, dated, evs, titles),
    xSec(`Works in order${works.length ? ` (${works.length})` : ""}`, xList("person", [...dated, ...undated], 6,
      w => row2([xWork(w), w.kind ? ` (${w.kind})` : ""], workSpan(w) ? xYear(w.start_year, workSpan(w)) : "undated"))),
    ...[["Titles", titles.filter(t => !isCommand(t))], ["Commands", titles.filter(isCommand)]].map(([label, ts]) =>
      ts.length ? xSec(label, xList("person", ts, 4, t => row2(`${t.title}${t.disputed ? " (disputed)" : ""}`, xYear(t.start_year, reignSpan(t))))) : null),
    xSec("Succession", xList("person", db.successionOf(p.id), 3, s => h("li", { class: "xsucc" }, successionLine(s, xPerson)))),
    family.length ? xSec("Family", h("dl", { class: "xfam" }, ...familyRows(p.id, xPerson).flatMap(([k, v]) => [h("dt", { text: k }), h("dd", {}, ...v)]))) : null,
    evs.length ? xSec("Events", xList("person", evs, 5, x => row2([xEvent(x.event), x.role ? ` (${x.role})` : ""], xYear(x.event.start_year)))) : null,
    portrayed.length ? xSec(`Portrayed in (${portrayed.length})`, xList("person", portrayed, 4, f => row2(xFilm(f), xYear(f.start_year)))) : null,
    xSec("Places", new Set(stopsForPerson(p.id).map(s => s.place.id)).size >= 2
      ? h("button", { type: "button", class: "xexp xjourney", title: `Follow ${p.name}'s life stop by stop, full screen`, onclick: () => openJourney(p.id, "explore"), text: "Journey ⤢" }) : null,
      xChips("person", [...new Map(stopsForPerson(p.id).map(s => [s.place.id, s])).values()], 8,
      s => h("span", { class: "xchip" }, xPlace(s.place), s.what && s.what.length < 14 ? h("span", { class: "yrs", text: ` ${s.what.toLowerCase()}` }) : null))),
    xSec("Contemporaries", xChips("person", contemporaries, 8, o => h("span", { class: "xchip" }, xPerson(o)))),
    h("div", { class: "xfoot" }, h("button", { type: "button", class: "plink", onclick: toTimeline(() => reveal(p.id)), text: "See them on the timeline" })),
  ];
}
// A life as a bar: works and events as marks in date order, years held as a gold band.
function lifeStrip(p, works, evs, titles) {
  const a = p.birth_year, b = p.death_year;
  if (a == null || b == null || b <= a) return null;
  const x = y => `${Math.max(0, Math.min(100, (y - a) / (b - a) * 100))}%`;
  const strip = h("div", { class: "xstrip", role: "group", "aria-label": `${p.name}'s life, ${fmtSpan(a, b)}` });
  titles.forEach(t => strip.append(h("span", { class: "xreign" + (t.kind === "military" ? " military" : ""), style: `left:${x(t.start_year ?? a)};width:calc(${x(t.end_year ?? b)} - ${x(t.start_year ?? a)})`, title: `${t.title}, ${reignSpan(t)}` })));
  evs.forEach(({ event: e }) => e.start_year != null && strip.append(h("button", { type: "button", class: "xmark ev", style: `left:${x(e.start_year)}`,
    title: `${fmtYear(e.start_year)}: ${e.name}`, "aria-label": `${fmtYear(e.start_year)}: ${e.name}`, onclick: () => xGo("year", e.start_year) })));
  works.forEach(w => strip.append(h("button", { type: "button", class: "xmark" + (w.id === X.work ? " on" : ""), style: `left:${x(w.start_year)}`,
    title: `${workSpan(w)}: ${w.name}`, "aria-label": `${workSpan(w)}: ${w.name}`, onclick: () => xGo("work", w.id) })));
  if (X.year != null && X.year >= a && X.year <= b) strip.append(h("span", { class: "xnow", style: `left:${x(X.year)}`, title: `${fmtYear(X.year)}, the Year card's year` }));
  return h("div", { class: "xstripwrap" }, strip, h("div", { class: "xstrip-axis" }, h("span", { text: fmtYear(a) }),
    h("span", { class: "hint", text: "Marks: works (filled) and events (hollow)" }), h("span", { text: fmtYear(b) })));
}

// A painting's title with the places it shows as links: "Hampstead Heath, Looking Toward Harrow". A place's name is
// found in the title ignoring case and accents, its full name first, then the part before a comma or bracket
// ("Florence Cathedral (Santa Maria del Fiore)" → "Florence Cathedral").
const GENERIC_PLACE_WORDS = /^(lake|gulf|bay|mount|mont|monte|river|saint|st\.?|san|santa|piazza|place|rue|church|castle|palace|bridge|ponte|the|old|new|great|little|upper|lower|north|south|east|west|port|fort|cape|isle|island)$/i;
function titleWithPlaces(w, places) {
  // Fold accents one character at a time, so positions in `low` stay those in the title.
  const t = w.name, low = Array.from(t, c => (c.normalize("NFD")[0] || c).toLowerCase().slice(0, c.length).padEnd(c.length, " ")).join("");
  const hits = [];
  places.forEach(pl => {
    // Then shorter leading parts of the name ("Harrow on the Hill" → "Harrow"), never a generic word on its own.
    const words = pl.name.split(/[,(]/)[0].trim().split(/\s+/);
    const prefixes = words.map((_, i) => words.slice(0, words.length - 1 - i).join(" ")).filter(x => x.length > 3 && !GENERIC_PLACE_WORDS.test(x));
    // and the part before a hyphen ("Chailly-en-Bière" → "Chailly", "Auvers-sur-Oise" → "Auvers").
    const beforeHyphen = words[0].includes("-") ? words[0].split("-")[0] : null;
    const tries = [pl.name, pl.name.split(/[,(]/)[0].trim(), pl.historical_name, ...prefixes, beforeHyphen && beforeHyphen.length > 3 && !GENERIC_PLACE_WORDS.test(beforeHyphen) ? beforeHyphen : null].filter(n => n && n.length > 2);
    for (const n of tries) {
      const k = n.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const m = new RegExp(`(^|[^\\p{L}])(${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\p{L}])`, "u").exec(low);
      if (m) { const at = m.index + m[1].length; if (!hits.some(x => at < x.end && at + k.length > x.at)) hits.push({ at, end: at + k.length, pl }); break; }
    }
  });
  if (!hits.length) return [t];
  hits.sort((a, b) => a.at - b.at);
  const out = []; let i = 0;
  hits.forEach(x => { out.push(t.slice(i, x.at), xBtn(t.slice(x.at, x.end), `${x.pl.name} in the Place card`, () => xGo("place", x.pl.id))); i = x.end; });
  out.push(t.slice(i));
  return out.filter(x => x !== "");
}

/* --- Work card */
function workCard() {
  const db = S.db, I = exploreIndex(), w = I.workById[X.work];
  if (!w) return [h("p", { class: "hint", text: "Search a painting, building or film (Mona Lisa, David, Braveheart), or click one in another card." })];
  if (w.kind === "film" && db.eventById["f" + w.id]) return filmCard(db.eventById["f" + w.id]);
  const creator = db.byId[I.creatorOf.get(w.id)];
  const seq = creator ? (I.worksBy.get(creator.id) || []).filter(o => o.start_year != null) : [];
  const i = seq.findIndex(o => o.id === w.id), prev = i > 0 ? seq[i - 1] : null, next = i >= 0 && i < seq.length - 1 ? seq[i + 1] : null;
  const m = db.museumById[w.museum_id], places = I.placesOf.get(w.id) || [];
  const subjects = (I.subjectsOf.get(w.id) || []).map(id => db.byId[id]).filter(Boolean);
  const after = w.derived_from_id && I.workById[w.derived_from_id];
  const C = workCountry(w);
  const during = w.start_year == null ? [] : db.events.filter(e => !e.film && overlaps(e.start_year, e.end_year ?? e.start_year, w.start_year, w.end_year ?? w.start_year))
    .sort((x, y) => (C ? inCountryEvent(y, C) - inCountryEvent(x, C) : 0) || evOrder(x, y));
  const credit = [w.image_credit, w.image_license].filter(Boolean).join(" · ");
  const age = creator && w.start_year != null ? ageIn(creator, w.start_year) : null;
  return [
    w.image_thumb ? h("figure", { class: "xpic" }, picture(w.image_thumb, w.name),
      h("figcaption", {}, w.image_page ? h("a", { class: "ext", href: w.image_page, target: "_blank", rel: "noopener", text: credit || "Wikimedia Commons" }) : credit)) : null,
    h("h2", {}, ...titleWithPlaces(w, places.filter(x => x.role === "depicts").map(x => x.place))),
    h("div", { class: "xsub" }, creator ? xPerson(creator) : "Unknown maker", workSpan(w) ? [" · ", xYear(workYear(w), workSpan(w))] : " · undated",
      [w.kind, w.medium].filter(Boolean).length ? ` · ${[w.kind, w.medium].filter(Boolean).join(", ")}` : ""),
    seq.length > 1 && i >= 0 ? h("div", { class: "xseq" },
      h("div", { class: "xseq-h", text: `In ${creator.name}'s work: ${i + 1} of ${seq.length} dated${age != null ? `, begun at ${age}` : ""}` }),
      h("div", { class: "xseq-row" }, h("span", {}, prev ? ["← ", xWork(prev), h("span", { class: "yrs", text: ` ${workSpan(prev)}` })] : h("span", { class: "hint", text: "first" })),
        h("span", { class: "right" }, next ? [xWork(next), h("span", { class: "yrs", text: ` ${workSpan(next)}` }), " →"] : h("span", { class: "hint", text: "last" })))) :
      w.start_year == null && creator ? h("p", { class: "hint", text: "No date recorded, so it can't be placed in the artist's sequence yet." }) : null,
    xSec("Where", places.length ? xList("work", places, 4, x => row2(xPlace(x.place), x.role === "depicts" ? "shown" : x.role)) : null,
      m ? h("p", {}, "Now: ", m.museum_url || w.museum_url || m.website ? h("a", { class: "ext", href: w.museum_url || m.website, target: "_blank", rel: "noopener", text: m.name + " ↗" }) : m.name,
        m.city ? `, ${m.city}` : "", w.accession_number ? h("span", { class: "yrs", text: ` · ${w.accession_number}` }) : null) : null),
    subjects.length ? xSec("Shows", xChips("work", subjects, 6, o => h("span", { class: "xchip" }, xPerson(o)))) : null,
    after ? xSec("A copy of", h("p", {}, xWork(after))) : null,
    during.length ? xSec(`While it was made${C && during.some(e => inCountryEvent(e, C)) ? ` (${C} first)` : ""}`, xList("work", during, 4, e => row2([xEvent(e), db.placeById[e.place_id] ? [" · ", xPlace(db.placeById[e.place_id])] : null], fmtYear(e.start_year)))) : null,
    w.note ? h("p", { class: "xnote-text", text: w.note }) : null,
    h("div", { class: "xfoot" }, "Sources: ", ...sourceLinks(db.sourcesFor("artwork", w.key))),
  ];
}

// "Near me": the browser's location (asked each time, never stored or sent anywhere) opens the nearest place.
function nearMe() {
  const msg = $("x-msg");
  if (!S.db) { msg.textContent = "Still loading the history; try again in a moment."; return; }
  if (!navigator.geolocation) { msg.textContent = "This browser can't share its location."; return; }
  msg.textContent = "Finding where you are…";
  navigator.geolocation.getCurrentPosition(pos => {
    const at = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const near = S.db.places.filter(p => p.lat != null && p.lng != null).map(p => ({ p, km: kmBetween(at, { lat: Number(p.lat), lng: Number(p.lng) }) }))
      .sort((a, b) => a.km - b.km)[0];
    if (!near) { msg.textContent = "No places with a map position yet."; return; }
    msg.textContent = near.km > 50 ? `The nearest place recorded is ${near.p.name}, ${Math.round(near.km)} km away.` : "";
    setCountry(placeCountry(near.p) || "", false);
    fill("place", near.p.id);
    afterSearch("place", null);
    renderExplore(CARDS);
  }, () => { msg.textContent = "Couldn't get your location. Your browser may have blocked it."; }, { timeout: 10000, maximumAge: 60000 });
}

function wireExplore() {
  wireCardDrag();
  $("x-form").addEventListener("submit", e => { e.preventDefault(); runExplore($("x-q").value); });
  $("x-q").addEventListener("input", () => { $("x-msg").textContent = ""; });
  $("x-near").addEventListener("click", nearMe);
  $("x-country").addEventListener("change", e => setCountry(e.target.value));
  document.querySelectorAll("#x-examples button").forEach(b => b.addEventListener("click", () => { $("x-q").value = b.dataset.x; runExplore(b.dataset.x); }));
  addEventListener("keydown", e => { if (e.key === "Escape" && X.open && S.viewMode === "explore") shrinkCard(); });
  addEventListener("popstate", () => { if (X.open) { X.pushed = false; shrinkCard(true); } });
}
function fillCountryPicker() {
  const sel = $("x-country");
  sel.replaceChildren(h("option", { value: "", text: "All countries" }), ...exploreIndex().countryList.map(c => h("option", { value: c, text: c })));
  if (X.country && !exploreIndex().countryList.includes(X.country)) X.country = "";
  sel.value = X.country;
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
    // Fame row: how far down the Wikipedia ranking to show artists, writers, composers and scholars.
    const cultural = db.people.filter(p => FAME_TYPES.includes(p.type));
    if (cultural.some(p => p.sitelinks != null)) {
      const row = h("div", { class: "fame" }, h("span", { class: "lbl", text: "Fame" }));
      FAME.forEach(f => {
        const n = cultural.filter(p => p.sitelinks == null || p.sitelinks >= f.min).length;
        row.append(h("button", { type: "button", class: "chip", "aria-pressed": S.fame === f.key,
          title: f.min ? `Artists, writers, composers and scholars with at least ${f.min} Wikipedia editions` : "Everyone, including the long tail",
          onclick: () => { S.fame = f.key; store.set("fame", f.key); applyCats(); } }, `${f.label} `, h("b", { text: n })));
      });
      box.append(row);
    }
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
  $("view-explore").addEventListener("click", () => showView("explore"));
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
  wireExplore();
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
  // The Explore page is the front page: show it while the data loads. The timeline still draws first (it measures
  // itself), so it waits off-screen at full width until showView brings it back or hides it.
  let early = new URLSearchParams();
  try { early = new URLSearchParams(location.search); } catch (e) {}
  if (!early.has("q") && !["timeline", "year"].includes(early.get("view"))) {
    $("explore-view").hidden = false;
    ["view-explore", "view-timeline"].forEach((k, i) => $(k).setAttribute("aria-pressed", !i));
    const tl = $("timeline-view");
    tl.style.cssText = `position:absolute;left:-99999px;top:0;width:${tl.parentElement.clientWidth - 32}px`;
  }
  const { source, raw, error } = await loadData();
  S.db = indexData(raw); S.source = source;
  const src = $("source");
  src.className = source === "live" ? "live" : "";
  src.innerHTML = "";
  src.append(h("i", { class: "dot" }), source === "live" ? "Live from Supabase" : "Snapshot of 5 Oct 2026");
  if (error) src.title = `Live data unavailable: ${error}`;
  let params = new URLSearchParams();
  try { params = new URLSearchParams(location.search); } catch (e) {}
  // The timeline is always drawn first (while visible, so it can measure itself); then the page switches to the
  // view the address asks for: ?view=year, a timeline request (?q= or ?view=timeline), or else the Explore page.
  S.viewMode = "timeline";
  renderCats();
  run(params.get("q") || "");
  fillCountryPicker();
  if (params.get("view") === "year") {
    $("year-from").value = params.get("y") || ""; $("year-to").value = params.get("to") || "";
    Y.realm = params.get("realm") || null;
    showView("year");
    if ($("year-from").value) $("year-form").requestSubmit(); else renderYear();
  } else if (!params.has("q") && params.get("view") !== "timeline") {
    const open = readExploreUrl(params);
    showView("explore");
    if (open) expandCard(open);
  }
}

init();
})();
