# History Timeline backlog

Last updated 2026-10-12 · Board: [GitHub Project](https://github.com/users/schmittyideas/projects/1)

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

### In progress

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

#### [P3] Fill the gaps left in the Indian rulers batches
`type: task` · `area: data` · `status: ready` · `issue: #80`

Rulers and dates left out of item 3: Sadasiva Raya, the Deccan sultans of Talikota, Vijaya Sena's reign, several placeholder title starts, the Pandyas, Yadavas, Kashmir, the Ahoms, the Malwa, Jaunpur and Bengal sultanates, and the later Mughals. Full list in the issue.
Source: Ty, 2026-10-09 (item 3 session).

#### [P3] Fill the gaps left in the East Asian batches
`type: task` · `area: data` · `status: ready` · `issue: #151`

Rulers and dates left out of item 4: the last Song, Jin and Western Xia rulers, the Hōjō regents Tokiyori and Takatoki (no start year in their articles), most Japanese emperors, Goryeo kings between Gongmin and Joseon, the Trần and Lý emperors outside the list, Tibet, Ryukyu and Champa. Full list in the issue.
Source: Ty, 2026-10-11 (item 4 session).

#### [P3] Fill the gaps left in the Ottoman and Seljuk batch
`type: task` · `area: data` · `status: ready` · `issue: #164`

Left out of item 5: the interregnum princes' reign dates, the later Sultans of Rum and the Anatolian beyliks, Ottomans after 1595, viziers and powerful women, the opponents named only in notes (Ismail I, Hunyadi, Skanderbeg and others), and unlocated battle sites. Full list in the issue.
Source: Ty, 2026-10-11 (item 5 session).

#### [P3] Fill the gaps in the 1100-1500 snapshot years
`type: task` · `area: data` · `status: ready` · `issue: #178`

Realms with rulers near a snapshot year but none at it (Poland in 1100, 1200 and 1500, the Hoysalas and Vijayanagara in 1300, Bahmani, the Inca and others), title rows left out for missing dates, and states the maps draw that have no ruler at all. Full list in the issue.
Source: Ty, 2026-10-11 (item 6 session).

#### [P2] Add Emperor Henry V
`type: task` · `area: data` · `status: ready` · `issue: #6`

Empress Matilda's first husband (married 1114). Intake: the person, a `spouse` link to `empress-matilda`, and a source.
Source: Empress Matilda's note in `inbox/2026-10-05-white-ship.yaml` ("not yet added").

#### [P3] White Ship follow-ups
`type: task` · `area: data` · `status: ready` · `issue: #7`

Who survived the wreck (the butcher Berold is the usual answer). Visiting Barfleur on a Normandy trip belongs in a learning-log entry rather than here.
Source: `inbox/examples/2026-10-05-white-ship.yaml` log `follow_up`.

#### [P3] Data: duplicate places for New York City
`type: task` · `area: data` · `status: ready` · `issue: #211`

`new-york-city` and `new-york` are both "New York City" (kind city). Pick one as the main record, move the other's links to it in an intake batch, and leave a note on the other; look for other duplicate cities at the same time.
Source: Explore search for "New York, 1932", 2026-10-13.

### Icebox

---

## Tooling

### Ready (ranked)

#### [P2] Museums: read collections through official APIs for images, accession numbers and links back
`type: task` · `area: data` · `status: in progress` · `issue: #129`

Done 2026-10-11 without scraping: official APIs and open data (Met, Art Institute of Chicago, Cleveland, National Gallery of Art, Rijksmuseum; MoMA and Tate metadata only) and, for museums whose own terms forbid reading (Louvre, National Gallery London and 100+ others), Wikidata plus Wikimedia Commons (the Louvre's 693 paintings have inventory numbers, free images and Joconde links back). The database now holds about 4,600 artworks, 3,500 with images, 3,800 linked to 101 museums. Still to do: V&A, Statens Museum for Kunst, Harvard (key), Minneapolis and the Smithsonian museums; museum page links for museums other than the French ones (Wikidata gives only inventory numbers); the second pass for the 34 museums with unknown terms; the duplicate Statens Museum for Kunst / National Gallery of Denmark records; check Art Institute images in a normal browser; works by painters below the 40-edition cut; show artworks on artwork, place and event panels.
Source: Ty, 2026-10-10.

#### [P3] Artists: remaining gaps (photographers, non-Western, below the 70-edition cut)
`type: task` · `area: data` · `status: ready` · `issue: #126`

Batch 14 (55 pre-1500 masters, sculptors, major architects and graphic artists, merged 2026-10-10) closed the biggest gaps. Still missing: professional photographers, non-Western artists (Hokusai, Kahlo, Rivera, Tagore; outside the Europe/US scope), and lesser-known artists not on the painter list. Artwork images are #62.
Source: Ty, 2026-10-10.

## Done

#### [P2] WWII: events and people
`type: task` · `area: data` · `status: done` · `issue: #262`

Five batches, nine PRs, all checked against English Wikipedia: (1) the war's leaders and 23 outline events (#264, #265); (2) 17 European commanders and 17 battles, with the D-Day beaches (#266, #267); (3) 19 Asia-Pacific leaders and commanders, including Mao, Curtin and Blamey, and 21 events from Mukden to the Tokyo Trial (#268, #269); (4) 19 Holocaust perpetrators, victims, rescuers and resisters, and 18 events from the Nuremberg Laws to the Eichmann trial (#270, #271); (5) 15 scientists and codebreakers and 11 events, with Groves's Manhattan Project command (#272). Commands are iron military titles. Source disagreements (death tolls, dates) are logged as discrepancies. Done 2026-10-24.
Left for later: New Zealand's leaders; portraits that aren't public domain; commands the articles give no dates for; the duplicate Saint Petersburg places (`st-petersburg`, `saint-petersburg`).
Source: Ty, 2026-10-24.

#### [P2] Military group, and military titles drawn in iron
`type: enhancement` · `area: site` · `status: done` · `issue: #261`

A Military type and Show button (iron grey). Titles have a `kind` field (sql/018): `kind: military` titles are drawn in iron instead of gold, put their holder in the Military group whatever their type (Eisenhower stays Government), and stay out of the Year view's rulers. Done 2026-10-24 (#263).
Source: Ty, 2026-10-24.

#### [P3] Explore: rearrange the cards
`type: enhancement` · `area: site` · `status: done` · `issue: #243`

Move the Explore cards into your own order: drag a card by its header on a computer, or use the ← → buttons in its header on a phone or keyboard. The order is kept per browser; a card added later joins the end. Done 2026-10-18 (#244). Follow-up the same day: dragging now uses pointer events (it hadn't worked for Ty; now mouse, pen and touch all work), and the cards pack up and to the left with no gaps under short ones.
Source: Ty, 2026-10-18.

#### [P2] US Presidents
`type: task` · `area: data` · `status: done` · `issue: —`

All 45 presidents (47 terms: Cleveland and Trump twice), Washington to Trump, as type Government with the title "President of the United States" in the new realm United States (from 1776), each with birth, death and burial places, 69 inaugurations, the four assassinations and Nixon's resignation, portraits where Commons marks them public domain (not Franklin D. Roosevelt's, CC BY), and 4 date or place discrepancies (#215, #216, #217). Coverage `partly`: policies, cabinets, vice presidents and families beyond the Adamses and Bushes are not yet in. The Explore page now counts presidents as heads of state (#218). Done 2026-10-13.
Source: Ty, 2026-10-13.

#### [P3] Border maps to 1900: Place card exact after 1599
`type: enhancement` · `area: site` · `status: done` · `issue: #203`

Nine more border snapshots (1600, 1650, 1700, 1715, 1783, 1800, 1815, 1880, 1900) from the same historical-basemaps commit, with 34 realms mapped to their names, so the Place card names a place's realm by its point for every year to 1999. Where one map name stands for several realms, the card keeps those that existed that year and had a ruler then. Done 2026-10-12 (PR #207).
Source: 2026-10-12.

#### [P2] Realms: fill thin country lists
`type: task` · `area: data` · `status: done` · `issue: #202`

Nine thin realms got their countries from their provinces' and successor states' Wikipedia articles: the Ottoman Empire (31 countries), Abbasid Caliphate (21), French Empire (14), Poland (8), Golden Horde, Norway, Chagatai Khanate, Grand Duchy of Moscow and Chola, each with the years it held them. Japan (from 703), Ireland (846–1800) and Pamplona (824–1150) got years. Batch 4's six date conflicts and six new ones are recorded as realm discrepancies. Vassals and tributaries (Wallachia, Moldavia, Crimea) are left out. Done 2026-10-12.
Source: realm batches, 2026-10-12.

#### [P1] Realms in time and museums on the map
`type: task` · `area: data` · `status: done` · `issue: —`

Realms got the years they existed and every modern country they covered (`sql/017`, `realm_countries`; #192), filled for 146 of 149 realms from their Wikipedia articles, with 31 date discrepancies recorded (#194, #198–#201). The Place card says which realm a place was in for the Year card's year, by its point on the border maps for 1000–1599. Every museum but the Royal Collection now has a place: 16 reuse existing buildings, 98 are new (#196, #197), so a painting's Work and Place cards show where it hangs. Search reads a year and a name together and forgives spelling slips (#191). Done 2026-10-12.
Source: Ty, 2026-10-12.

#### [P1] Explore page: four linked cards (Year, Place, Person, Work)
`type: enhancement` · `area: site` · `status: done` · `issue: #185, #186, #187, #188`

The new front page: one search (a person, place, work or year) fills four linked cards; a link in a card changes only the card it matches; any card expands to fill the screen (Esc or Back shrinks it); the address records the cards. A country picker puts that country first in the Year card (In <country>, then Elsewhere in the world, then Influential people alive). The Place card's street map shows the place and nearby spots, the person's places, the work's places and the year's events; Near me opens the nearest place. Person: life strip, works in order, titles, places, family, contemporaries. Work: picture, its place in the artist's sequence, where it is, what happened while it was made. Done 2026-10-12. A person's country is worked out from their birthplace, titles and places (no `country` field yet). Left for later: many artworks have no date or place, so they can't be ordered or mapped; dating them is data work.
Source: Ty, 2026-10-12.

#### [P2] Los Angeles: mayors, Hollywood, film locations and the 2028 Olympics
`type: task` · `area: data` · `status: done` · `issue: #182`

The area is all of LA County (plus the Olympic venues in Anaheim, Pomona, San Clemente and Oklahoma City). Added: every mayor since 1900 with a "Mayor of Los Angeles" title (#91); Hollywood and the main visitor landmarks (#93); 98 films at 61 places, as `artworks` of kind film linked as `filmed`, in four batches (#96, #120, #122, #123); the 2028 Olympics and Paralympics with 32 venues on one event (#134); the Hotel Arcadia (#143); Musso & Frank linked to its dining entry (#147). Every claim checked against English Wikipedia; disagreements recorded. Done 2026-10-11. Left for later: about 30 visitor places in the city (museums in Exposition Park, Grand Central Market, Little Tokyo, the Zoo…), greater-LA sights (Rodeo Drive, the Sunset Strip, the Huntington, the Queen Mary), the films left out for being outside the city line, Abel Stearns and Robert S. Baker, and linking the films to the entertainment database once its location and ids are known.
Source: Ty, 2026-10-09 to 2026-10-11.

#### [P2] Site: offices, films, venues, Nearby, dining and a street map
`type: enhancement` · `area: site` · `status: done` · `issue: #183`

Government and Patron types with Show buttons, and a column instead of a crown for offices (#90, #94); films in the events lane, a film panel and "Films shot here" (#95); realm searches keep a city's own events (#97); `external_links` (sql/015) and `event_places` (sql/016) with intake support and tests (#131, #132); Nearby and Big events nearby on place panels, now 5 km (#131, #136); "Eat and drink nearby" from RouteWeaver's `nearby_dining` API, Metro Advisor picks only, as a list and as map pins (#139, #145, #150, #153); a Leaflet street map on OpenStreetMap tiles for city-sized views (#152); version tags so browsers load new files (#154). Done 2026-10-11. Left: searching event names ("olympics" finds nothing yet); some dining types look wrong in RouteWeaver (Pizzeria da Michele shows as a cocktail bar); RouteWeaver dropped requests for three minutes on 2026-10-11 (522/525), worth watching.
Source: Ty, 2026-10-10 to 2026-10-11.

#### [P2] Build-out: the world, century by century (1100–1500) with maps
`type: task` · `area: data` · `status: done` · `issue: #34`

Border snapshots for 1200, 1300, 1400 and 1500 (PR #168), with `index.json` mapping 100 realms to the map's state names and capital pins for realms the maps do not draw. Rulers for the states each snapshot shows that had none: 133 people, 159 title rows, 74 places, 49 events (38 new and 11 link-only), 51 discrepancies and 42 realms, in five batches: 1100 (23 people, PR #169), 1200 (24, #170), 1300 (29, #175), 1400 (28, #176) and 1500 (29, #177), checked against their English Wikipedia articles. Everyone is `coverage: partly`. Done 2026-10-11. Left for later: the gaps item above.
Source: Ty, 2026-10-07 (cloud credits build-out, "do it all").

#### [P2] Build-out: Ottoman sultans and the Seljuks of Rum, 1077–1600
`type: task` · `area: data` · `status: done` · `issue: #133`

22 rulers with 23 title rows, 12 places, 17 new events (plus link-only updates to 4 existing ones: Manzikert, Ankara, Myriokephalon and the fall of Constantinople), 25 discrepancies and 3 realms, checked against their English Wikipedia articles, in PR #163: the Sultans of Rum from Suleiman ibn Qutulmish to Kaykhusraw II, Alp Arslan and Malik-Shah I of the Great Seljuk Empire, and the Ottoman sultans from Osman I to Murad III, with Kosovo, Nicopolis, Varna, Chaldiran, Mohács, Vienna 1529 and Lepanto. Everyone is `coverage: partly`. Done 2026-10-11. Left for later: the gaps item above.
Source: Ty, 2026-10-11.

#### [P2] Build-out: East Asian dynasties, 1000–1600
`type: task` · `area: data` · `status: done` · `issue: #33`

120 rulers with 122 title rows, 52 places, 113 events, 103 discrepancies and 13 realms, checked against their English Wikipedia articles, in five batches: Song, Liao, Jin and Western Xia (27, PRs #141 and #142), the Mongol Empire, Yuan and Ming (21, #144), Japan's emperors, shoguns and Hōjō regents (29, #148), Korea's Goryeo and Joseon (22, #149) and Vietnam, the Khmer Empire and Pagan (21, #150). Everyone is marked `coverage: partly`. The preview now refuses a full date in a life moment's year (#146). Done 2026-10-11. Left for later: the gaps item above.
Source: Ty, 2026-10-07 (cloud credits build-out, "do it all").

#### [P2] Show artworks and portraits on the site
`type: enhancement` · `area: site` · `status: done` · `issue: #62`

The person panel shows the portrait (Wikipedia lead image, with a Commons credit link) and a gallery of works in open museum collections, each linking to the museum's own page, plus works that show the person. Done 2026-10-11. Left: artwork, place and event panels do not show pictures yet; museum pages (a museum's works in one place); the Art Institute of Chicago's images did not load in the desktop app's built-in browser (they load from artic.edu; untested in a normal browser, and failures are hidden).
Source: Ty, 2026-10-08.
#### [P2] Museums table and the museum links on artworks
`type: enhancement` · `area: data` · `status: done` · `issue: #128`

A museums table (name, kind, address, city, country, coordinates, website, collection URL, plus data-access notes: open-api, open-data-download, website-only, no-access or unknown, with licence, notes and the date checked). Artworks can point to a museum, its accession number and the object's page on the museum's site. Seeded with 115 art museums from Wikidata, each checked for robots.txt; 14 have a verified open API or data download, one forbids crawling, the rest are unknown. 142 artworks linked to their museum. Done 2026-10-10.
Source: Ty, 2026-10-10.

#### [P2] Popularity tiers from Wikipedia sitelinks
`type: enhancement` · `area: data` · `status: done` · `issue: #118`

Every person has `sitelinks` (Wikipedia language editions, from Wikidata; read 2026-10-10). Artists, writers, composers and scholars get prominence from it (150+ = 5, 100-149 = 4, 60-99 = 3, 40-59 = 2, under 40 = 1), and the site has Fame buttons (Icons, Famous, Well known, Everyone; default Well known) that hide the long tail of those groups. Rulers are never hidden by it. Done 2026-10-10. Left: keep `sitelinks` current (re-read now and then); apply tiers to label size on the timeline.
Source: Ty, 2026-10-10.

#### [P3] Painters: batch 13 and the patrons of the painters
`type: task` · `area: data` · `status: done` · `issue: #113, #114`

Batch 13 added 41 painters (the list now stands at 541, including the two missing articles; Capek and Sher-Gil are in). 74 patrons (popes, cardinals, kings and queens, ministers, collectors) were added with titles and 22 new realms, and 89 patron links to painters were made from what each painter's article says (found by name search, then judged on the sentences). Done 2026-10-10. Left: Thomas Cromwell was not written; painters whose Wikipedia lead says "artist" not "painter" may still be missing; patrons not on the 74 (minor nobles, bankers) are only in artwork notes.
Source: Ty, 2026-10-10.

#### [P2] Western painters from 1500: 500 painters in 12 batches
`type: task` · `area: data` · `status: done` · `issue: #98`

500 painters of Europe and the US, 1500 to today, ranked by Wikipedia sitelinks: Leonardo to the postwar masters, in 12 batches (PRs #99-#111, one batch had to be re-sent in a fix PR). Each has dates, places, life moments, a lead image link, one or two key artworks (no images yet), teacher and patron links where the article names someone already in the database, and `coverage: partly`. Done 2026-10-10. Left for later: patrons not yet in the database (popes, Philip IV, Napoleon, the Medici, Louis XIV, Napoleon III); artwork images (#62); full portfolios; about 40 more painters of the same list (batch 13 article files were downloaded but not run), plus Josef Capek and Amrita Sher-Gil (articles missing in batch 5); and famous painters whose Wikipedia lead says "artist" not "painter" were missed by the filter.
Source: Ty, 2026-10-10.

#### [P1] Only the first 1,000 rows of each table loaded; Wikipedia links for rulers
`type: bug` · `area: site` · `status: done` · `issue: #88`

The site and `tools/intake.py` read each table in one request, which Supabase caps at 1,000 rows, so `source_links` (2,490) was cut short. Both now read in pages. The Year view adds a Wikipedia link after each ruler (all 435 have one); five people who cited only someone else's article now cite their own. Done 2026-10-09.
Source: Ty, 2026-10-09 ("add the Wikipedia links for royalty").

#### [P2] Pick a country: realms in the timeline search and a realm focus in the Year view
`type: enhancement` · `area: site` · `status: done` · `issue: #86`

Timeline search knows realms (Byzantine Empire, France 1300 to 1500): title holders there plus close family, and anyone with a place there. Year view: a realm heading, the realm on the map, or typing "Scotland 1300" focuses the page on that realm (rulers, people around them, events, makers in its modern country); a chip clears it and the URL keeps it. Gaps name who came before and after. Done 2026-10-09.
Source: Ty, 2026-10-09.

#### [P2] Show buttons: choose which groups appear in the timeline and Year view
`type: enhancement` · `area: site` · `status: done` · `issue: #82`

Buttons under the title (Royalty, Nobility, Clergy, Artists, Architects, Writers, Composers, Scholars, with counts) filter the timeline's lanes and events and the Year view's rulers, artists, events, births and deaths. Architects match the architect role. Remembered per browser; Show everyone resets. Done 2026-10-09.
Source: Ty, 2026-10-09.

#### [P2] Build-out: Indian rulers, 1000–1600
`type: task` · `area: data` · `status: done` · `issue: #32`

68 rulers with 68 title rows, 32 places, 52 events and 44 discrepancies, checked against their English Wikipedia articles, in two batches: South India (36, PR #78: Cholas, Western Chalukyas, Hoysalas, Kakatiyas, Eastern Gangas, Gajapatis, Vijayanagara, Bahmanis, Talikota) and North India (32, PR #79: Palas and Senas, Ghurids, the Chauhans, thirteen sultans of Delhi, Rajput kingdoms, Gujarat, Timur, the Mughals to Akbar, Tarain, Panipat, Khanwa, Haldighati). 17 new realms in South Asia and neighbouring regions; everyone is marked `coverage: partly`. Done 2026-10-09. Left for later: the gaps item above.
Source: Ty, 2026-10-07 (cloud credits build-out, "do it all").

#### [P2] Timeline: event lines stripe the whole chart
`type: bug` · `area: site` · `status: done` · `issue: #76`

Every event drew a dashed line across the full chart width, labelled or not (82 in 1550 to 1750). Now unlabelled events are markers only, a labelled event draws a short tick to the year rail, and its line out to the people involved appears on hover or selection. Done 2026-10-09.
Source: Ty, 2026-10-09.

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
