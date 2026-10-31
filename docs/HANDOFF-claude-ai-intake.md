# Handoff for claude.ai: turning your data into History intake files

Written 2026-10-28 from the live database (Supabase project `alhvzdvabugmkeqmvmiz`, schema `public`) and the repo `schmittyideas/history`. Paste this whole document into the claude.ai chat that holds the data, then ask it to produce intake files.

## 1. What you are being asked to do

You hold data that Ty wants in the History Timeline database. You cannot write to that database. The only way data gets in is an **intake file**: a YAML file, in the format in section 4, that Ty takes to his Claude Code session. There it is previewed (`tools/intake.py plan`), opened as a pull request, merged, and applied to Supabase by a GitHub workflow. Applying only **adds or updates**; it never deletes.

So your output is one or more YAML files, each a complete batch, written exactly to the format below, following the data rules in section 5 and using the vocabularies already in the database (section 6). Put doubts and anything you could not confirm in a `# Notes for the reviewer` comment block at the top of the file, as the real batches do (section 7 shows one).

If this chat has the **"Supabase History"** connector (tools named like `execute_sql`, `list_tables`), use it for read-only `SELECT`s to check whether a person, place or event already exists and what its key is. Never run `INSERT`, `UPDATE`, `DELETE` or DDL through it. Without the connector, write the batch anyway and list in the reviewer notes every record you suspect already exists; the preview catches unknown keys and likely duplicates, and the Claude Code session reconciles them.

Keep a batch to about 150 rows in total (people + places + events + moments + titles …). Split bigger data into several files by topic.

## 2. The project in one paragraph

A static website (https://schmittyideas.github.io/history/) showing history as lanes of lives: people with lifespans, the titles they held and when, the events they took part in, the places where their lives happened, the artworks they made or appear in, and the realms those titles ruled, drawn on historical border maps. Everything is linked by stable **keys** (lowercase, hyphenated, never change). Every fact cites a **source**, by default the English Wikipedia article. The database is read by the public site with a publishable key under row-level security that allows `SELECT` only; the one private area is Ty's learning log.

## 3. The database

Row counts are from 2026-10-28. Every table has `id bigint identity` as primary key and most have `created_at timestamp default now()`; those two are left out below. Tables link to each other by `id` foreign keys, but **intake files never use ids**: they use keys, and the intake tool resolves them. Types are Postgres.

### 3.1 People and their links

**`entities`** (2,246 rows): people.

| Column | Type | Meaning |
|---|---|---|
| `key` | text unique | Stable key: `william-i-of-england` |
| `name` | text | Display name |
| `type` | text | Group: Royalty 749, Artist 733, Clergy 312, Notable 128, Government 128, Nobility 82, Scholar 41, Military 37, Writer 19, Composer 9, Patron 7 (one stray `Other`). Drives colour and the Show buttons |
| `roles` | text[] default `{}` | Extra roles: painter 576, pope 265, film director 108, sculptor 88, printmaker 85, patron 74, architect 50, president 45, draughtsman 45, antipope 42, politician 39, lawyer 30, poet 29, illustrator 25, actor 24, writer 21, physicist 13, photographer 13, playwright 11, composer 10, and about 200 rarer ones. Architects group needs role `architect`; Artists group needs an artistic role |
| `birth_year`, `death_year` | int | Years; BC negative (range in data: −384 to 2026) |
| `birth_date`, `death_date` | date | Full dates when the source gives the day |
| `birth_estimated`, `death_estimated` | bool default false | "c." |
| `house`, `realm` | text | Dynasty and realm, mostly empty |
| `prominence` | smallint 1–5 | 5 = most important. Hand-set for rulers, clergy, officials; derived from `sitelinks` for cultural figures (see 5.6) |
| `sitelinks`, `sitelinks_on` | int, date | Wikipedia language editions with an article (from Wikidata), and when read. 1,708 set, 538 null |
| `coverage`, `coverage_note` | text check `not-read` / `partly` / `complete` | How far the record is built out: partly 1,422, not-read 458, complete 9, null 357 |
| `image_url`, `image_thumb`, `image_page`, `image_license` | text | Links only (Wikimedia Commons). 797 people have one |
| `portrait_artwork_id` | bigint → artworks | The person's picture as an artwork record (1 row uses it) |
| `sex` | text check `male` / `female` | **Undocumented**: exists in the database (138 female, 109 male, 1,999 null) but is in no `sql/` file and the intake tool does not write it. Do not use it in intake files |
| `obsidian_link`, `note` | text | Ty's Obsidian note name (only if seen); one-line summary |

**`relationships`** (1,103): person to person. `source_id`, `target_id` → entities; `rel_type` text: parent 544, teacher 214, spouse 178, patron 167; `start_year`, `end_year` int; `uncertain` bool; `note`. Direction: parent → child, spouse (family member) → the one who married in, patron → artist, teacher → student.

**`person_places`** (3,980): life moments. `entity_id` → entities, `place_id` → places, `role` text (born 1,179, worked 1,168, died 759, buried 730, crowned 78, lived 40, built 6, proclaimed 5, imprisoned, held, lay in state, founded, exiled, heart buried, trained), `year` int (an integer year, never a full date).

**`titles`** (1,403): who held what, when. One row per tenure.

| Column | Meaning |
|---|---|
| `key` | Defaults to `person--title--startyear`, e.g. `william-i-of-england--king-of-england--1066` |
| `entity_id` → entities | Holder |
| `title` | Wording: one wording per realm, e.g. "King of England" for every English king |
| `realm` | Must match `realms.name` exactly |
| `start_year`, `start_date`, `start_estimated`, `end_year`, `end_date`, `end_estimated` | Tenure; `end_*` empty while still held |
| `disputed` bool | Only for contested claims (Empress Matilda, 1141) |
| `kind` | null for a reign or office; `military` for a command or rank (drawn in iron, excluded from the Year view's rulers) |
| `note`, `obsidian_link` | The reign note, e.g. "King William I of England" |

Indexes: `titles(entity_id)`, `titles(realm, start_year, end_year)`.

### 3.2 Places and events

**`places`** (2,227). `key`, `name`, `historical_name`, `kind` (city 566, town 296, village 144, church 126, museum 119, cemetery 84, palace 83, castle 79, battlefield 48, house 48, cathedral 44, abbey 43, district 25, monastery 20, island 17, chapel 14, theatre 11, and about 190 rarer kinds), `city` (the town it is in today; empty when the place is the city), `region` (county or state), `modern_country` (United States 388, France 308, England 302, Italy 275, Germany 170 …; note England, Scotland and Wales are used as countries, not United Kingdom), `lat`, `lng` numeric, `visitable_today` bool, `visit_site` text, `start_year` + `start_estimated` (founded or built), `end_year` (destroyed; empty if standing), `built_by`, `architect` (plain text; names matching a person become links), `obsidian_link`, `note`.

**`events`** (862; years 313 to 2028). `key`, `name`, `type` (Battle 142, Inauguration 69, Coronation 61, Siege 49, Treaty 41, Founding 32, War 30, Council 25, Publication 23, Rebellion 18, Campaign 17, Political 14, Conquest 13, Building 12, Invasion 11, Execution 10, Performance 10, Assassination 10, Invention 9, Crusade 9, Law 8, Succession 8, Coup 8, Death 7, Marriage 7, and about 110 rarer), `start_year`, `start_date` (when the day is known), `start_month` smallint 1–12 (when the source gives month but not day), `end_year`, `location` text, `place_id` → places (the main place), `estimated` bool, `prominence` 1–5, `visitable_today`, `visit_site`, `obsidian_link`, `note`.

**`event_people`** (1,294): `event_id`, `entity_id`, `role` text, free: victor 133, commander 104, inaugurated 69, defeated 67, crowned 65, author 31, founder 30, king 30, signatory 27, killed 21, ordered 17, conqueror 15, died 13, architect 12, and about 400 others. Pick a short noun that reads well after the name.

**`event_places`** (136): an event's other places. `event_id`, `place_id`, `role` (venue 40, memorial 10, landing 10, start 6, deportation 5, finish 4, siege, objective, execution …), `note` (what happened there). The main place stays in `events.place_id`.

### 3.3 Realms

**`realms`** (159): what titles rule and where in the world. `key`, `name` unique (matches `titles.realm`), `region` check in: Western Europe, Northern Europe, Eastern Europe, Middle East and North Africa, Sub-Saharan Africa, Central Asia, South Asia, East Asia, Southeast Asia, Americas, Oceania; `modern_country` (its main country today), `start_year`, `end_year`, `start_estimated`, `end_estimated`, `note`.

**`realm_countries`** (561): every modern country a realm covered. `realm_id`, `modern_country`, `start_year`, `end_year` (only when it differs from the realm's own span), `note` ("northern Italy"). Unique on (realm, country).

The realm names already in use are listed in section 6.5. Reuse them exactly.

### 3.4 Artworks and museums

**`artworks`** (4,630). `key`, `name`, `kind` (painting 4,172; film 122; sculpture 38; fresco 32; altarpiece 15; portrait 11; mural 10; print 6; also drawing, photograph, poster, book …), `medium` ("oil on canvas"), `start_year`, `end_year`, `estimated`, `derived_from_id` → artworks (a copy "after" another), `collection` text, `museum_id` → museums, `accession_number`, `museum_url`, `image_url`, `image_thumb`, `image_page`, `image_license`, `image_credit`, `prominence`, `obsidian_link`, `note`. 3,527 have an image, 3,809 are linked to a museum.

**`artwork_people`** (4,740): `artwork_id`, `entity_id`, `role`: creator 4,637, subject 96, patron 5, after 2 (also allowed: engraver, owner). Unique on (artwork, person, role).

**`artwork_places`** (448): role depicts 166, filmed 140, held 53, made 52, made-for 26, displayed 11.

**`artwork_events`** (22): role depicts (also commemorates, made-during).

**`museums`** (115). `key`, `name`, `kind`, `address`, `city`, `region`, `modern_country`, `lat`, `lng`, `website`, `start_year`, `collection_url`, `collection_url_pattern` (`https://example.org/object/{id}`), `data_access` (website-only 53, unknown 34, open-api 13, open-data-download 11, no-access 4), `data_api_url`, `data_licence`, `data_notes`, `data_checked_on`, `place_key` (if also a place on the map), `obsidian_link`, `note`.

### 3.5 Sources, discrepancies, external links

**`sources`** (3,965). `key` unique, `title`, `url`, `author`, `note`. Key convention: `wp-<article-slug>` for English Wikipedia (3,878 of them, e.g. `wp-enrico-fermi`, `wp-nuclear-fission`), `wd-…` for Wikidata items, `commons-…`, `tmdb-…`, `frwp-…` for French Wikipedia, and named data sets (`met-open-access`, `nga-open-data`).

**`source_links`** (17,523). `source_id` → sources, `record_type` check in: person, place, event, relationship, moment, title, artwork, museum, realm; `record_key` text. Unique on (source, type, key). The intake tool writes these from each record's `sources:` list.

**`discrepancies`** (661; 654 open, 7 resolved). `key`, `question`, `about` jsonb (`[{"person":"voltaire"},{"event":"…"}]`), `field`, `claims` jsonb (`[{"value":"…","sources":["source-key"],"note":"…"}]`), `status` open/resolved, `note`, `resolution`, `updated_at`.

**`external_links`** (49). `record_type` check in: person, place, event, artwork, museum; `record_key`; `system` (entertainment 24, tmdb 24, dining 1); `external_id`; `url`; `label`; `note`. Unique on (type, key, system). Points at Ty's other databases (the entertainment catalogue, the dining database) without copying their data.

### 3.6 Private

**`learning_log`** (3) and **`learning_log_items`** (35): Ty's personal log of where he learned something (medium, source, notes, `links` jsonb, `details` jsonb) and the records each entry touched (`record_type` person/place/event/artwork, `record_key`). Row-level security with no public policy. Intake section `log`.

### 3.7 Access and limits

- Every public table: RLS on, policy `"Public read"` `for select to anon using (true)`. No client write policy anywhere; writes happen only with the secret key in the GitHub Actions workflow.
- Supabase REST returns at most 1,000 rows per request; readers page by `id`.
- Schema changes are numbered files `sql/001` … `sql/019` in the repo, applied by hand or through the connector. If your data needs a column that does not exist, do not invent a field: say so in the reviewer notes and the Claude Code session will decide whether to add `sql/020`.

## 4. The intake file format

One file per batch: `inbox/YYYY-MM-DD-short-title.yaml`. Every section is optional except `batch`. Anything referred to is referred to by key. A key that already exists is an **update** and only the fields given change. Full dates are `YYYY-MM-DD` strings; years are integers; BC years are negative (384 BC = `-384`, no year 0, no BC full dates).

### `batch` (required)
```yaml
batch:
  title: Short title
  requested: "Ty: what was asked"
  date: 2026-10-28
```

### `sources`
```yaml
sources:
  - {key: wp-white-ship, title: "White Ship (Wikipedia)", url: "https://en.wikipedia.org/wiki/White_Ship"}
```
Fields: `key`, `title`, `url`, `author`, `note`.

### `people`
| Field | Meaning |
|---|---|
| `key`, `name` | Required for new people |
| `type` | One of the types in 3.1 |
| `roles` | List, e.g. `[painter, architect]` |
| `born`, `died` | Year or `YYYY-MM-DD` |
| `born_estimated`, `died_estimated` | `true` for "c." |
| `house`, `realm` | Optional |
| `prominence` | 1–5, 5 = most important; rulers, clergy and officials only (see 5.6) |
| `sitelinks`, `sitelinks_on` | Required for every new cultural figure (Artist, Writer, Composer, Scholar, Notable) |
| `coverage`, `coverage_note` | `not-read` / `partly` / `complete`; note says what is captured and missing |
| `image_url`, `image_thumb`, `image_page`, `image_license` | Free Commons images only |
| `portrait` | Key of an artwork that shows them |
| `external` | List of `{system, id, url, label, note}` |
| `obsidian_link`, `note`, `sources` | `sources` is a list of source keys; required for new people |

### `places`
`key`, `name` (required for new), `historical_name`, `kind`, `city`, `region`, `country` (modern), `lat`, `lng` (required: a place without coordinates cannot be mapped), `visitable`, `visit_site`, `founded`, `founded_estimated`, `ended`, `built_by`, `architect`, `external`, `obsidian_link`, `note`, `sources`.

### `events`
`key`, `name`, `type` (required for new), `date` (full) or `year` (+ `month` 1–12 when the source gives month but no day), `end_year`, `estimated`, `place` (main place key), `places` (list of `{place, role, note}`), `people` (list of `{person, role}`), `prominence`, `external`, `obsidian_link`, `note`, `sources`.

### `moments`
```yaml
moments:
  - {person: henry-i-of-england, role: died, place: lyons-la-foret, year: 1135}
```
`year` is an integer year. A moment needs a place; no place in the source, no moment.

### `links`
```yaml
links:
  - {parent: henry-i-of-england, child: william-adelin}
  - {spouse: william-adelin, to: matilda-of-anjou, year: 1119}
  - {patron: lorenzo-de-medici, artist: michelangelo, from: 1489, to: 1492}
  - {teacher: verrocchio, student: leonardo-da-vinci}
```
Both people must exist in the database or in the same file.

### `titles`
```yaml
titles:
  - {person: william-i-of-england, title: King of England, realm: England, from: 1066-12-25, to: 1087-09-09, obsidian_link: King William I of England}
  - {person: dwight-d-eisenhower, title: "Supreme Commander, Allied Expeditionary Force", realm: United States, from: 1943, to: 1945, kind: military}
```
Fields: `person`, `title`, `realm` (required), `from`, `to`, `from_estimated`, `to_estimated`, `disputed`, `kind`, `key` (optional), `note`, `obsidian_link`, `sources`. Every realm named must exist in `realms` or in the file's `realms` section.

### `realms`
```yaml
realms:
  - {name: England, region: Western Europe, country: United Kingdom}
  - name: Holy Roman Empire
    region: Western Europe
    country: Germany
    from: 962
    to: 1806
    countries:
      - {country: Germany}
      - {country: Italy, to: 1648, note: northern Italy}
    sources: [wp-holy-roman-empire]
```
`region` must be one of the eleven in 3.3. `sources` required once a realm has years or countries.

### `artworks`
`key`, `name` (required), `kind`, `medium`, `made`, `made_end`, `estimated`, `after` (key of the original), `collection`, `museum`, `accession`, `museum_url`, `image_url`, `image_thumb`, `image_page`, `image_license`, `image_credit`, `people` (`{person, role}`: creator, subject, patron, after, engraver, owner), `places` (`{place, role}`: made, depicts, held, made-for, displayed, filmed), `events` (`{event, role}`: depicts, commemorates, made-during), `prominence`, `external`, `obsidian_link`, `note`, `sources`. A new artwork needs a `creator` (or `after`). A film is `kind: film` with its director as `creator`, real people it portrays as `subject`, `filmed` and `depicts` places, and `external: [{system: entertainment, id: …}, {system: tmdb, id: …}]`.

### `museums`
`key`, `name` (required), `kind`, `address`, `city`, `region`, `country`, `lat`, `lng`, `website`, `founded`, `collection_url`, `collection_url_pattern`, `data_access`, `data_api_url`, `data_licence`, `data_notes`, `data_checked_on`, `place`, `obsidian_link`, `note`, `sources`.

### `discrepancies`
```yaml
discrepancies:
  - key: coover-1942-employer
    question: Where did Coover work when he found cyanoacrylate in 1942?
    about: [{person: harry-coover}, {event: cyanoacrylate-discovered}]
    field: place
    claims:
      - {value: Eastman Kodak, sources: [wp-harry-coover]}
      - {value: B.F. Goodrich, sources: [wp-cyanoacrylate]}
    note: The record uses Eastman Kodak for now.
```
A discrepancy needs two different claims. `status: resolved` plus `resolution` when settled.

### `log` (private)
`key`, `title` (required), `learned_on`, `medium`, `source_title`, `source_detail`, `url`, `where`, `notes`, `links` (`{title, url}`), `details` (free map), `about` (`{person}` / `{place}` / `{event}` / `{artwork}`). Only for things Ty himself came across.

## 5. Data rules (what the preview and the reviewer check)

1. **Keys** are lowercase-hyphenated ASCII and never change: `otto-iii-holy-roman-emperor`, `st-james-church-bramley`. Before inventing one, check whether the person already exists (rulers often do: a king of England may already be in as Duke of Normandy). Reuse the existing key and send only what is new.
2. **Sources.** Every new person, place, event, title, artwork, museum and realm cites at least one source key from the file's `sources` or the database. A person cites **their own** Wikipedia article (`wp-<their-key>`), not only a relative's. Check facts against the article, not from memory. If your data has no article behind it, say what it is in `sources` (a book, a podcast, Ty's notes) and flag source-less claims in the reviewer notes.
3. **Dates.** Year, or full `YYYY-MM-DD` only when the source gives the day. A month without a day: `year` + `month`, say "early" / "late" in the note. Approximate: `*_estimated: true`. BC negative, no year 0. Impossible dates are rejected (died before born; child born after a parent's death beyond a pregnancy).
4. **Disagreements** between sources go in `discrepancies`, never a silent pick. The record holds the best-supported value and `note` says which.
5. **Types.** Royalty: monarchs and consorts. Nobility: dukes, counts, jarls, doges, emirs under a caliph, non-royal regents. Clergy: popes (`roles: [pope]`) and bishops. Government: mayors, governors, presidents, ministers (titles drawn as a column, not a crown; First Lady belongs here too). Patron: benefactors and founders. Notable: known for one story rather than an office or a body of work (Oskar Schindler, Al Capone). Military: known mainly for service (Patton, Zhukov); commands are titles with `kind: military` and the realm is the country served. A soldier who later led a country (Eisenhower) keeps Government and gets military titles. Cultural figures get Artist, Writer, Composer or Scholar (film people are Artists with roles like `film director`, `actor`).
6. **Prominence.** 1–5, 5 = most important, blank = 3. Hand-set for rulers, clergy and officials; 5 sparingly (Hastings). For Artist, Writer, Composer, Scholar and Notable, derive it from `sitelinks`: 150+ = 5, 100–149 = 4, 60–99 = 3, 40–59 = 2, under 40 = 1, and always record `sitelinks` and `sitelinks_on`.
7. **Titles and realms.** One spelling per realm everywhere ("Normandy", not "Duchy of Normandy"; "Kievan Rus'"), one title wording per realm ("King of England" for every English king, "Pope" with realm "Papacy"). Every realm a title names needs a `realms` entry with a region. A regent or chief minister with real power is a title too. `disputed` only for contested claims. Do not derive a title start from an age or general knowledge: if the article does not state it, leave it out and list it as a gap.
8. **Events** need a clear date in the source; leave out vague or legendary ones or mark them `estimated` with a note. Keep events rated 3 and up unless the batch is specifically about minor ones.
9. **Places.** Today's naming: `city`, `region` (county/state), `country` (England / Scotland / Wales as countries; United States; France). Coordinates required. A moment needs a place; a cemetery is a place of its own with `kind: cemetery`.
10. **Images** are links only. Use a Wikipedia lead image only when its Commons page marks it public domain, CC0 or a free licence (CC BY, CC BY-SA), and record `image_page` and `image_license`. Files local to en.wikipedia (no Commons record) are skipped. Strip `?utm_…` from URLs. A portrait is best an `artworks` record linked as `portrait`.
11. **Coverage.** Every person added gets `coverage` and, for `partly`, a `coverage_note` saying what was captured and what is missing.
12. **Nothing is deleted by intake.** If your data corrects an existing record, re-send the key with the corrected fields and explain in the reviewer notes.
13. **Dining and entertainment data** belong to Ty's other databases. Link to them with `external` (`system: dining`, `id: <establishments.id>`; `system: entertainment` / `tmdb`), never copy their fields here.

## 6. Vocabularies already in the database

Reuse these spellings. New values are allowed where the column is free text, but prefer an existing one.

**6.1 Person types:** Royalty, Nobility, Clergy, Government, Artist, Writer, Composer, Scholar, Patron, Military, Notable.

**6.2 Moment roles (`person_places.role`):** born, died, buried, worked, lived, crowned, built, proclaimed, imprisoned, held, lay in state, founded, exiled, heart buried, trained.

**6.3 Relationship kinds:** parent, spouse, patron, teacher (written in `links` as `parent/child`, `spouse/to`, `patron/artist`, `teacher/student`).

**6.4 Event types in use (most common first):** Battle, Inauguration, Coronation, Siege, Treaty, Founding, War, Council, Publication, Rebellion, Campaign, Political, Conquest, Building, Invasion, Execution, Performance, Assassination, Invention, Crusade, Law, Succession, Coup, Death, Marriage, Bombing, Ceremony, Trial, Massacre, Conference. Event people roles most used: victor, commander, inaugurated, defeated, crowned, author, founder, signatory, killed, ordered, conqueror, died, architect, succeeded, attended, captured, deposed, executed, leader, bride, groom.

**6.5 Realm names in use (159):**
Western Europe: Anjou, Aquitaine, Aragon, Austria, Barcelona, Bavaria, Blois, Caliphate of Córdoba, Castile, Commonwealth of England, Emirate of Granada, England, Ferrara, Florence, France, French Empire, Germany, Great Britain, Habsburg Netherlands, Hanover, Holy Roman Empire, Ireland, Italian Social Republic, Italy, León, Mantua, Milan, Montferrat, Naples, Navarre, Normandy, Pamplona, Papacy, Parma, Portugal, Prussia, Savoy, Saxony, Scotland, Sicily, Spain, Spanish Netherlands, Tuscany, United Kingdom, Urbino, Venice.
Northern Europe: Denmark, Norway, Sweden.
Eastern Europe: Albania, Bohemia, Bosnia, Bulgaria, Byzantine Empire, Crimean Khanate, Croatia, Galicia-Volhynia, Golden Horde, Grand Duchy of Lithuania, Grand Duchy of Moscow, Grand Duchy of Vladimir, Hungary, Kievan Rus', Poland, Principality of Moldavia, Principality of Wallachia, Protectorate of Bohemia and Moravia, Russian Empire, Serbia, Soviet Union, Tsardom of Russia.
Middle East and North Africa: Abbasid Caliphate, Abkhazia, Almohad Caliphate, Almoravid dynasty, Armenia, Armenian Kingdom of Cilicia, Ayyubid Sultanate, Buyid Emirate, Empire of Trebizond, Fatimid Caliphate, Georgia, Great Seljuk Empire, Hafsid Sultanate, Iberia, Ilkhanate, Kingdom of Cyprus, Kingdom of Jerusalem, Mamluk Sultanate, Marinid Sultanate, Ottoman Empire, Safavid Iran, Sultanate of Rum, Tao, Zirid Ifriqiya.
Sub-Saharan Africa: Ethiopian Empire, Kingdom of Benin, Kingdom of Kongo, Songhai Empire, Zagwe dynasty.
Central Asia: Chagatai Khanate, Ghaznavid Empire, Ghurid Sultanate, Khwarazmian Empire, Mongol Empire, Timurid Empire, Western Liao.
South Asia: Bahmani Sultanate, Bengal Sultanate, British India, Chahamana dynasty, Chaulukya dynasty, Chola Empire, Delhi Sultanate, Dominion of India, Eastern Ganga dynasty, Gajapati Kingdom, Gujarat Sultanate, Hoysala Empire, Kakatiya dynasty, Mewar, Mughal Empire, Pala Empire, Pandya dynasty, Paramara dynasty, Sena dynasty, Sur Empire, Vijayanagara Empire, Western Chalukya Empire.
East Asia: Ashikaga shogunate, China, Dali Kingdom, Goryeo, Japan, Jin dynasty, Joseon, Kamakura shogunate, Liao dynasty, Ming dynasty, Ryukyu Kingdom, Song dynasty, Tokugawa shogunate, Western Xia, Yuan dynasty.
Southeast Asia: Ava Kingdom, Ayutthaya Kingdom, Đại Cồ Việt, Đại Ngu, Đại Việt, Hanthawaddy Kingdom, Khmer Empire, Majapahit, Malacca Sultanate, Pagan Kingdom, Sukhothai Kingdom.
Americas: Aztec Empire, Los Angeles, United States.
Oceania: Australia.

**6.6 Title wordings most used:** Pope (Papacy); President of the United States, Vice President of the United States, First Lady of the United States, Second Lady of the United States (United States); King of England, Queen of England (England); Byzantine Emperor; King of Scotland; King of France; King of the Germans and Holy Roman Emperor (Holy Roman Empire); Mayor of Los Angeles (Los Angeles); King of León; King of Castile; Emperor of China (Song dynasty); Emperor of Japan; Ottoman Sultan; King of Goryeo; Sultan of Delhi; Emperor of the Ming; Duke of Normandy; Shogun (Ashikaga shogunate); King of Joseon; King of the United Kingdom; King of Denmark; King of Norway; King of Sweden; King of Portugal; King of Spain; King of Aragon; King of Hungary.

**6.7 Place kinds most used:** city, town, village, church, museum, cemetery, palace, castle, battlefield, house, cathedral, abbey, district, monastery, island, chapel, theatre, gallery, temple, bridge, hospital, street, harbour, mausoleum, villa, stadium, park, memorial, square, hotel.

**6.8 Artwork kinds and roles:** kinds painting, film, sculpture, fresco, altarpiece, portrait, mural, print, drawing, photograph, poster, book; people roles creator, subject, patron, after, engraver, owner; place roles made, depicts, held, made-for, displayed, filmed; event roles depicts, commemorates, made-during.

**6.9 Source keys:** `wp-<english-wikipedia-slug>`; `frwp-…` for French Wikipedia; `wd-…` for Wikidata; `commons-…`; `tmdb-…`.

## 7. What a finished batch looks like

Shape of a real file (abridged from `inbox/2026-10-24-wwii-science.yaml`):

```yaml
batch:
  title: "WWII, batch 5: science and codebreaking"
  requested: "Ty: WWII build-out, batch 5"
  date: 2026-10-24

# Notes for the reviewer
# - Facts from each person's English Wikipedia article, read 2026-10-24. Sitelinks from Wikidata the same day.
# - All new people are Scholars, so prominence follows the sitelinks scale.
# - Existing people: Leslie Groves gets his Manhattan Project command as a military title.
# - Portraits: public domain lead images only. Left out: Heisenberg, Hahn (CC BY-SA), Feynman (local non-free file).
# - Burials left out where the article names none (Szilard, Lawrence).
# - The Polish break of Enigma (December 1932) has no exact day: year only.

sources:
  - {key: wp-enrico-fermi, title: "Enrico Fermi (Wikipedia)", url: "https://en.wikipedia.org/wiki/Enrico_Fermi"}
  - {key: wp-chicago-pile-1, title: "Chicago Pile-1 (Wikipedia)", url: "https://en.wikipedia.org/wiki/Chicago_Pile-1"}

places:
  - {key: oak-woods-cemetery, name: Oak Woods Cemetery, kind: cemetery, city: Chicago, region: Illinois, country: United States, lat: 41.77, lng: -87.6, visitable: true, sources: [wp-enrico-fermi]}
  - {key: chicago-pile-1-site, name: Chicago Pile-1 site (old Stagg Field), kind: laboratory, city: Chicago, region: Illinois, country: United States, lat: 41.7925, lng: -87.6011, visitable: true, sources: [wp-chicago-pile-1]}

people:
  - {key: enrico-fermi, name: Enrico Fermi, type: Scholar, roles: [physicist], born: 1901-09-29, died: 1954-11-28, prominence: 5, sitelinks: 151, sitelinks_on: 2026-10-24, coverage: partly, coverage_note: "Dates, places and his wartime work; pre-war physics not built out.", note: "Nobel physicist who led the team that built Chicago Pile-1, the first nuclear reactor.", image_url: "https://upload.wikimedia.org/wikipedia/commons/d/d4/Enrico_Fermi_1943-49.jpg", image_page: "https://commons.wikimedia.org/wiki/File:Enrico_Fermi_1943-49.jpg", image_license: Public domain, sources: [wp-enrico-fermi]}

moments:
  - {person: enrico-fermi, role: born, place: rome, year: 1901}
  - {person: enrico-fermi, role: died, place: chicago, year: 1954}
  - {person: enrico-fermi, role: buried, place: oak-woods-cemetery, year: 1954}

events:
  - {key: chicago-pile-1, name: "Chicago Pile-1: first nuclear reactor", type: Invention, date: 1942-12-02, place: chicago-pile-1-site, prominence: 4, people: [{person: enrico-fermi, role: led}, {person: leo-szilard, role: physicist}], sources: [wp-chicago-pile-1]}
```

Existing places like `rome`, `chicago` and `copenhagen` are referenced by key without being redefined. The preview rejects any key that is in neither the database nor the file.

## 8. Checklist before you hand the file back

- `batch` has title, requested, date. File name `inbox/YYYY-MM-DD-short-title.yaml`.
- Every new record has `sources`, and every source key is defined in the file or is a known `wp-…` key.
- Every person has `type`; cultural figures have `sitelinks` and derived `prominence`; everyone has `coverage`.
- Every place has `lat` and `lng` and a modern `country`.
- Every title's `realm` is in section 6.5 or in the file's `realms` with a region from the fixed list.
- Dates are years or `YYYY-MM-DD` strings; moment years are integers; BC negative.
- Links and moments only reference people that exist or are in the file.
- Source disagreements are `discrepancies`, with two claims.
- Images carry `image_page` and `image_license` and are free licences.
- Reviewer notes at the top list: where facts came from and when, records that may already exist, facts left out and why, anything needing a schema change.
- About 150 rows or fewer; otherwise split by topic.

## 9. What happens next, on Ty's side

Ty pastes or saves your YAML into the repo's `inbox/` folder. His Claude Code session runs the preview, fixes key collisions against the live database, opens a pull request, waits for the `preview` check, merges, watches the `Intake apply` workflow, and checks the live site. If the preview finds problems it cannot settle, the questions come back to you with the preview output.
