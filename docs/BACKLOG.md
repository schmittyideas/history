# History Timeline backlog

Last updated 2026-10-08 · Board: [GitHub Project](https://github.com/users/schmittyideas/projects/1)

One list of bugs, tasks and ideas for the site, the data and the tooling.

## How to read and edit this file

Each item is a `####` heading (the title) with one field line under it, then a short body. The format is fixed so a script can later turn each item into a GitHub issue.

| Field | Values |
| --- | --- |
| `type` | `bug` (broken) · `task` (work to do; titles starting "Decide:" are decisions) · `enhancement` (idea for later) |
| `area` | `site` (the website) · `data` (history to add or fix, usually an intake file) · `tooling` (intake script, workflows, SQL, repo) |
| `status` | `icebox` (ideas, no priority) · `ready` · `blocked` · `in-progress` · `done` |
| priority | in the title: `[P1]` next · `[P2]` should happen, nothing breaks if it waits · `[P3]` nice-to-have. Icebox items have none. |
| `issue` | `—` until ported, then the issue number |

Rules:
- An enhancement gets a priority only when it moves out of the Icebox.
- Finished items move to **Done** at the bottom.
- `Source:` points at where the item came from.

---

## Site

### Ready (ranked)

#### [P2] Show artworks and portraits on the site
`type: enhancement` · `area: site` · `status: ready` · `issue: #62`

Show a person's portrait (thumbnail, credit line, link to its Commons page) and an Artworks row on person, place and event panels, linking maker, sitter, place and event. Then backfill artworks for the 44 existing person images from their Commons credits (the credits are in the Wikipedia image data; only the link and licence were stored so far). Needs the artworks table (sql/011).
Source: Ty, 2026-10-08.

#### [P2] Navigation: breadcrumb of 5 with browser Back, and Center on a person
`type: task` · `area: site` · `status: ready` · `issue: #23`

1. Breadcrumb of 5: replace the "Back to:" trail (8 steps, newest first, raw query text) with the last 5 steps, oldest to newest, in plain words (`Everything › Henry I's family › 1060 › William I's family`). The last crumb is where you are (bold, not clickable); clicking an earlier one goes back there and drops the later steps. Year view steps join it ("Who ruled in 1000"). The browser's Back button and the phone's back swipe follow the same history (pushState) instead of leaving the site.
2. Center on a person: the card's "Show <name>'s family" button moves to the top as "Center on <name>"; double-clicking a nameplate does the same; a single click still just selects.
Source: Ty, 2026-10-07.

#### [P2] Decide: when a request names a place and a person, which wins
`type: task` · `area: site` · `status: ready` · `issue: #11`

Today people are matched before places, so a place whose name contains a person's ("St Dunstan-in-the-West", "Henry VII Chapel") is read as that person. When both are named ("Henry III Westminster Abbey") the person takes the side panel; a place opens its own panel only when named alone.
Recommendation: match people and places in one pass, longest name first, with a place winning a tie, so the fuller name always wins. When a request names both, keep the person as the family focus but open the place's panel, since the place is what narrows the request.
Source: Ty, 2026-10-06.

#### [P2] Nearby: enter a location, see the history around it
`type: enhancement` · `area: site` · `status: ready` · `issue: #13`

Give the site a location (a town or address you type, "near me" from the browser, or a click on the map) and list the history near it: places within a chosen distance (10 / 50 / 100 km), nearest first, each with what happened there and whether you can visit. Useful for trips ("visit Barfleur on a Normandy trip").
Approach: distance is worked out in the browser from the lat/lng places already have, so no database change. Typing a town needs a geocoder; OpenStreetMap Nominatim is free with no key (1 request a second, needs an attribution line). "Near me" uses the browser's location and nothing is stored. Places without coordinates can't show up; the intake preview already warns about those.
Source: Ty, 2026-10-06.

#### [P2] Lanes by dynasty and realm
`type: enhancement` · `area: site` · `status: ready` · `issue: #5`

People carry `house` and `realm` (added in `sql/002`), but the Lanes control only offers Family and Type. Add House and Realm options to the grouping in `app.js`. `app.js` loads `select=*`, so the fields are already in the data.
Source: `docs/intake-format.md` ("used for lanes later").

### Icebox

---

## Data

### Ready (ranked)

#### [P1] Places: today's location (city, county, country) and current coordinates
`type: task` · `area: data` · `status: ready` · `issue: #39`

For every place that past events happened at, record where it is today by present-day standards: city, county or region, and country, plus current latitude and longitude. Example: the Tower of London becomes London, Greater London, England, with today's coordinates. Today a place has `region`, `modern_country`, `lat` and `lng` but no city field. Proposed: add a `city` column (a small schema change, applied before the intake), make `region` the county or state, and back-fill the existing places. Teach `tools/intake.py`, its tests and `docs/intake-format.md` the new field, and show the full location in the place panel.
Source: Ty, 2026-10-08.

#### [P2] English artists, writers, composers and scholars, 1600–1700
`type: task` · `area: data` · `status: ready` · `issue: #52`

About 40 to 60 well-documented people active in England 1600–1700; only Shakespeare is in so far. Painters (van Dyck, Lely, Kneller), architects (Inigo Jones, Wren, Hawksmoor), writers (Milton, Donne, Dryden, Behn), composers (Purcell), scholars (Newton, Boyle). Each with a patron link where the article says so, the places and buildings they made or worked in (county, country, coordinates, city, built_by, architect), life moments and dated events. Reuse existing place keys. One batch of about 60 records, about $5–8. Follow the lessons in `docs/BUILDOUT.md`.
Source: Ty, 2026-10-08.

#### [P3] Period emblems for realms, with today's flag as context
`type: enhancement` · `area: data` · `status: ready` · `issue: #27`

A realm can carry emblems with the years they were really in use (banner, arms or colour: the Abbasid black banner, the Fatimid white, England's three lions from 1198), with the picture's source and licence (Wikimedia Commons). Where one was in use in the year shown, it replaces the plain map flag and appears on the realm card; otherwise the plain flag stays. Cards can also show a small grey "today: France" flag from the realm's modern country, labelled as today's. Needs an emblems table (realm, picture, from, to, source), an intake section and a first batch.
Source: Ty, 2026-10-07 (option 3 of the flags discussion).

#### [P3] Fill the gaps left in the Europe's big thrones batches
`type: task` · `area: data` · `status: ready` · `issue: #72`

Rulers and popes left out of item 2 because they were not in the list or had no downloaded article: Romanos III Argyros, John IV Laskaris, Lulach, Ferdinand II of León, Henry I of Castile, Berengaria, the popes of 1003-1032 and a few others, antipopes, HRE antikings, Aragon and Navarre. Full list in the issue.
Source: Ty, 2026-10-08 (item 2 session).

#### [P2] Build-out: Indian rulers, 1000–1600
`type: task` · `area: data` · `status: ready` · `issue: #32`

Cholas, Western Chalukyas and Hoysalas, Palas and Senas, the Delhi Sultanate, Vijayanagara, the Bahmanis, Rajput kingdoms, the Mughals to Akbar; Tarain, Panipat, Talikota. Queue item 3 (Ty: India before East Asia).
Source: Ty, 2026-10-07 (cloud credits build-out, "do it all").

#### [P2] Build-out: East Asian dynasties, 1000–1600
`type: task` · `area: data` · `status: ready` · `issue: #33`

Song, Liao, Jin, Yuan, Ming; Japan's emperors, shoguns and Hōjō regents; Goryeo and Joseon; Đại Việt. Queue item 4.
Source: Ty, 2026-10-07 (cloud credits build-out, "do it all").

#### [P2] Build-out: the world, century by century (1100–1500) with maps
`type: task` · `area: data` · `status: ready` · `issue: #34`

The world-in-1000 build repeated for 1100–1500, plus border snapshots in `data/maps/`. Queue item 5.
Source: Ty, 2026-10-07 (cloud credits build-out, "do it all").


#### [P2] Add Emperor Henry V
`type: task` · `area: data` · `status: ready` · `issue: #6`

Empress Matilda's first husband (married 1114). Intake: the person, a `spouse` link to `empress-matilda`, and a source.
Source: Empress Matilda's note in `inbox/2026-10-05-white-ship.yaml` ("not yet added").

#### [P3] White Ship follow-ups
`type: task` · `area: data` · `status: ready` · `issue: #7`

Who survived the wreck (the butcher Berold is the usual answer). Visiting Barfleur on a Normandy trip belongs in a learning-log entry rather than here.
Source: `inbox/examples/2026-10-05-white-ship.yaml` log `follow_up`.

### Icebox

---

## Tooling

### Ready (ranked)

### Icebox

---

## Done

#### [P2] Year view: artists, writers and thinkers, with what they did that year
`type: enhancement` · `area: site` · `status: done` · `issue: #74`

A section under Who ruled: everyone of type Artist, Writer, Composer or Scholar alive in the year or span, grouped by type, with their age (single year) or life span and roles, and under each their events, life moments (with place) and artworks in the span. Done 2026-10-09.
Source: Ty, 2026-10-09 ("add artists and their events to the year").

#### [P2] Build-out: Europe's big thrones, 1000–1500
`type: task` · `area: data` · `status: done` · `issue: #31`

182 rulers with 221 title rows, their places, events, life moments and 66 discrepancies, checked against their English Wikipedia articles: France (22, PR #57), the Holy Roman Empire (24, #58), Castile and León (21, #59), Scotland and William Wallace (24, #60), Byzantium (31, #66) and the Papacy (60 popes, 1012 to 1503, #68 and #70). Everyone is marked `coverage: partly` (#71). The wiki downloader `tools/wiki.py` (#56) now waits out Wikipedia's rate limit. Done 2026-10-08. Left for later: see the gaps item above. Batches ran 160-200 preview rows, over the 60-80 guide, because every ruler has places and events.
Source: Ty, 2026-10-07 (cloud credits build-out, "do it all").

#### [P3] Coverage status on people
`type: enhancement` · `area: data` · `status: done` · `issue: #64`

People carry `coverage` (not-read, partly, complete) and a `coverage_note` saying what was captured, so artists who need a portfolio pass can be found with a query. Backfilled as partly for the 48 English artists and Hogarth. Done 2026-10-08. When an artist becomes the focus, read their article and list of works, add the artworks, and mark them complete.
Source: Ty, 2026-10-08.

#### [P2] Artworks as records: maker, sitter, place, event, copies
`type: enhancement` · `area: data` · `status: done` · `issue: #61`

New `artworks` table (sql/011) with links to its creator, the people it shows, places, events and the artwork it copies (`after`), image links with licence and credit, and a person's `portrait`. The intake format, tool and tests know it. First record: Hogarth's portrait of Inigo Jones after Van Dyck. Done 2026-10-08.
Source: Ty, 2026-10-08.

#### [P2] Add English artists, writers, architects, composers and scholars, 1600-1700
`type: task` · `area: data` · `status: done` · `issue: #54`

48 people active in England 1600-1700 (painters, architects, writers, composers, scholars) with royal patrons, teachers, buildings, works and life places, checked against their English Wikipedia articles. People now carry image links (full, thumbnail, Commons page, licence; schema 010) for later display. Done 2026-10-08. Left for later: showing the images on the site; Hawksmoor's churches and other buildings; artists without a usable free image (Webb, Pratt, Stone, Tomkins).
Source: Ty, 2026-10-08.

#### [P2] Add every English monarch's reign, with their places and events
`type: task` · `area: data` · `status: done` · `issue: #15`

Every King and Queen of England, Great Britain and the United Kingdom from Edward the Confessor to Charles III now has a reign, with places (county, country, city, coordinates) and events, checked against their English Wikipedia articles. Done 2026-10-08 in PRs #42 (Stuarts), #43 (Plantagenets and Lancaster), #44 (York and Tudor), #45 (Hanover to today), #46/#48 (Mary II) and #47 (city back-fill). Left for later: Mary II's place of death, some battlefield cities, Elizabeth II's birthplace, coronation dates the articles do not give, and a verification pass on approximate coordinates.
Source: Year view, 2026-10-06; widened by Ty on 2026-10-08 to include places, buildings and events.

#### [P2] Map flags: a plain flag with each realm's ruler
`type: enhancement` · `area: site` · `status: done` · `issue: #26`

On the Year view's border map, each shaded realm gets a plain flag (black on light, white on dark; hollow for a disputed claim) with the ruler's name and the realm's name under it. The sovereign is named over co-rulers, dukes, regents and officials, with +N for others holding titles there then. A Rulers / Realms switch brings back plain realm names. Deliberately not a real banner (Ty: historically accurate). Done 2026-10-07.
Source: Ty, 2026-10-07.

#### [P2] Historical border maps in the Year view (trial: 1000 and 1100)
`type: enhancement` · `area: site` · `status: done` · `issue: #24`

Two snapshots from historical-basemaps (GPL-3.0, Ty's choice to use GPL data and link to it), kept in `data/maps/` with the licence, a credit README and the realm-to-map name list (`index.json`). The Year view draws the nearest earlier snapshot (up to 99 years back), fitted to the realms with a ruler in the span; those are shaded, labelled and clickable. Spans crossing snapshots get a switch. Next if it works out: more snapshot years, and the name list moving into the `realms` table. Done 2026-10-07.
Source: Ty, 2026-10-07 ("let's try with 1000 to 1100").

#### [P2] Event labels by prominence: 5 always, then 4 to 1 while they fit
`type: enhancement` · `area: site` · `status: done` · `issue: #21`

Events' `prominence` is a star rating (5 = always shown; kept as 5-to-1 by Ty's choice, 2026-10-07). The timeline labels 5s always, then 4, 3, 2, 1 while labels fit; no rating counts as 3. The rest get a small marker with the name on hover. Also fixed: the timeline's example-button handler was catching the Year view's examples too. Done 2026-10-07.
Source: Ty, 2026-10-07.

#### [P2] Crowns for rulers, with their title under the name
`type: enhancement` · `area: site` · `status: done` · `issue: #19`

Timeline: a crown above the name of anyone who held a title (in the requested years, if the request names some), their main title in small text under the dates ("King of England", so William I and William Adelin are easy to tell apart), and a gold strip beside the bar for the years each title was held. Year view and the person panel show a crown beside rulers. Done 2026-10-07.
Source: Ty, 2026-10-07.

#### [P2] The world in AD 1000: every ruler, grouped by world region
`type: enhancement` · `area: data` · `status: done` · `issue: #17`

Rulers of 41 realms in 1000 (54 title holders), from England to Song China, with their reigns, 11 events of the year and two discrepancies (Svolder; Stephen of Hungary's coronation). Realms get a world region (`sql/008`, applied 2026-10-07; intake `realms` section) so the Year view groups them under Western Europe, East Asia and so on, with region filters. Left out for lack of a confidently named ruler: Srivijaya, Ghana Empire, Ethiopia/Zagwe, Kara-Khanids, Toltec and Maya states. Merged in PR #18 and applied 2026-10-07 (50 people, 62 titles, 44 realms).
Source: Ty, 2026-10-07 ("find all the royalty in 1000 in the world").

#### [P2] Year view: who ruled, and what happened, in a year or span
`type: enhancement` · `area: site` · `status: done` · `issue: #14`

A second view beside the timeline. Type a year (1060, 384 BC) or a span (1060 to 1100, 12th century): rulers grouped by realm, each title's holders in order with a reign strip for spans, then events, births and deaths. Rulers come from a new `titles` table (`sql/007`, applied 2026-10-06) filled by a new intake `titles` section, so it grows to any country. First data: reigns for the rulers already in the database (`inbox/2026-10-06-reigns.yaml`). Merged in PR #16 and applied 2026-10-07.
Source: Ty, 2026-10-06 ("type in a year, 1060, and it tells me who is King").

#### [P2] Places as their own view, with dates and builders
`type: enhancement` · `area: site` · `status: done` · `issue: #10`

Click a place (map pin, an event's Where, a search for its name) to open its own panel: founded / ended, built by, architect, visit today, its events and people, and everything that happened there in date order under the map. Places gain founded / ended / built by / architect (`sql/006`, applied 2026-10-06). First example: Westminster Abbey (`inbox/2026-10-06-westminster-abbey.yaml`). Merged in PR #12 and applied 2026-10-06.
Source: Ty, 2026-10-06 ("build a place like Westminster Abbey").

#### [P2] Intake crashed on a BC full date instead of showing an error
`type: bug` · `area: tooling` · `status: done` · `issue: #8`

`-0044-03-15` (and year `0`, or any malformed date) crashed `tools/intake.py`. Event, link, moment and log dates were only parsed during apply, so a bad one could stop a run after some writes. The preview now checks every date field and lists bad ones as errors (2026-10-06).
Source: found while adding Aristotle (PR #2).

#### [P3] Stop tracking the Python cache file
`type: bug` · `area: tooling` · `status: done` · `issue: #9`

`tools/__pycache__/intake.cpython-313.pyc` was committed with the intake script. Removed it and added `__pycache__/` to `.gitignore` (2026-10-06).
Source: commit `8f56234`.
