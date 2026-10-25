# History Timeline: working notes for Claude

A personal project of Ty's (GitHub: schmittyideas). A static website for exploring history as lanes of lives, plus a Supabase database it reads, plus an intake pipeline that writes to the database through pull requests. Live at https://schmittyideas.github.io/history/ (GitHub Pages, deploys on every push to `main`). Repo: `schmittyideas/history` (public).

Read this whole file before changing anything. It is written so a session with no other context (a cloud session, a new laptop) can work safely.

## Permissions (granted by Ty, standing)

- Create branches, commit, push, open pull requests, and **merge your own pull requests** without asking: once the intake preview check passes, or straight away for a site-only or docs-only change. Then watch the apply run and check the live site.
- Apply schema changes to the History Supabase project yourself when a connector is available (see Database).
- Never: delete data from the database, force-push `main`, rewrite history other sessions may have pulled, put the Supabase secret key anywhere in the repo, or change `config.js`'s key.
- When something Ty asks for conflicts with what already exists (a field, a scale, a convention), ask one short question before building. Ty decided, for example, that `prominence` stays 5 = most important (like stars), not 1.
- Ty prefers short, plain answers with one recommendation, not a survey of options.

## Layout

| Path | What |
|---|---|
| `index.html`, `styles.css`, `app.js` | The site. No build step, plain JS in one file with section comments. d3 v7 from cdnjs. |
| `config.js` | Supabase URL and the **publishable** (anon) key. Public by design: RLS allows reads only. |
| `data/snapshot.js` | Fallback data when live data fails to load (old; not kept in sync). |
| `data/land.js` | Modern coastline for the side-panel map (Natural Earth, public domain). |
| `data/maps/` | Historical border maps, **GPL-3.0** (see Maps). |
| `inbox/*.yaml` | Intake files: one per batch of history. Format: `docs/intake-format.md`. |
| `tools/intake.py` | Plans (previews) and applies intake files. Tests: `tests/test_intake.py`. |
| `sql/00N_*.sql` | Every schema change, numbered in the order applied. The repo is the record; Supabase's migration list is incomplete. |
| `docs/intake-format.md` | The intake file format. Keep it in step with `tools/intake.py`. |
| `docs/dining-api.md` | The dining API in RouteWeaver that the site calls for "Eat and drink nearby" |
| `docs/BACKLOG.md` | The backlog, mirrored as issues on GitHub Project 1 (see Backlog). |
| `.github/workflows/` | `intake-preview.yml` posts a preview on PRs that touch `inbox/`; `intake-apply.yml` applies them on merge to `main`. |

## Database

Supabase project `alhvzdvabugmkeqmvmiz`, schema `public`. Tables: `entities` (people), `relationships` (parent, spouse, patron, teacher), `events`, `event_people`, `event_places` (an event's other places, each with a role and a note: the 2028 Olympic venues), `places`, `person_places` (life moments), `titles` (who held what, when), `realms` (what a title rules, with a world region), `external_links` (a record's entry in another database: Ty's entertainment database for films, later restaurants and bars; field `external` in intake files), `artworks` (paintings, prints, sculptures, films: linked to their creator, the people shown, places, events and the artwork they copy, through `artwork_people`, `artwork_places`, `artwork_events`), `museums` (where artworks are: location, website, and `data_access` notes on how each collection may be read; artworks point to one with `museum`, `accession`, `museum_url`), `sources`, `source_links`, `discrepancies`, and the private `learning_log` / `learning_log_items` (no public read).

- **1,000-row cap:** Supabase's REST API returns at most 1,000 rows per request. The site (`loadData`) and `tools/intake.py` (`RestDB.select`) read in pages ordered by `id`; anything new that reads a table must do the same.
- **Reads:** the claude.ai custom connector "Supabase History" (tools named like `mcp__…__execute_sql`, `list_tables`), if this session has it. Otherwise the REST API with the anon key from `config.js`: `curl "$URL/rest/v1/entities?select=key,name" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"`.
- **Data writes:** only through intake files and pull requests. The apply workflow holds the secret key as a GitHub secret (`SUPABASE_SECRET_KEY`). Don't write data any other way.
- **Schema changes:** add `sql/00N_name.sql` (next number), then apply it with the connector's `apply_migration`. New tables get RLS on, plus `create policy "Public read" ... for select to anon using (true)` unless private. Apply **before** merging any intake file that needs it, and teach `tools/intake.py`, its tests and `docs/intake-format.md` about new fields in the same PR. Without a connector, stop and leave the SQL for Ty.
- The RouteWeaver Supabase connector, if present, is a different project. Never touch it from here, with one exception Ty approved on 2026-10-11: the public read-only function `public.nearby_dining` (see `docs/dining-api.md`). It returns open establishments on a public Metro Advisor list (`dining.lists.category_slug = 'metro-advisor'`), within 5 km at most. Change it only when Ty asks, and record each change in that doc. The dining data is Ty's own; History never copies it, only links to it (`external: {system: dining, id: <establishments.id>}`) or asks the API live. A second exception, approved on 2026-10-17: read-only `select` queries on the `entertainment` schema (Ty's entertainment database: `titles`, `title_tag_details`, `title_external_ids`, `credits`, `people`) and `lab_entertainment.raw_tmdb` (TMDB keywords), to find films that depict our places and events. Never write there. A film links to it with `external: {system: entertainment, id: <titles.id>}` plus `{system: tmdb, id: <TMDB id>}`.

## How a change goes in

1. Branch: `intake/YYYY-MM-DD-short-title` for data, `feature/...` or `fix/...` for site and tooling, `docs/...` for docs.
2. Data: write `inbox/YYYY-MM-DD-short-title.yaml`. Preview it locally before pushing (read-only, the anon key is enough):
   ```bash
   export SUPABASE_URL=https://alhvzdvabugmkeqmvmiz.supabase.co SUPABASE_SECRET_KEY=$(grep -o 'eyJ[^"]*' config.js) PYTHONIOENCODING=utf-8
   python tools/intake.py plan inbox/YYYY-MM-DD-short-title.yaml
   ```
   Fix every error, and every warning unless it's expected (a deliberate source-less claim, say).
3. Tooling: run `PYTHONIOENCODING=utf-8 python tests/test_intake.py` (must print ALL TESTS PASSED).
4. Site: bump the `?v=` tag on `styles.css`, `config.js` and `app.js` in `index.html` whenever one of them changes, so visitors' browsers fetch the new copy. Serve with `python -m http.server 8765` and check in a browser: the console has no errors, light and dark both work, phone width (375px) has no sideways scroll. Browsers cache `app.js` hard; reload with the cache bypassed.
5. Push, open the PR (body: what changed, how it was checked; end with the Claude Code line), wait for the `preview` check, merge with a merge commit, watch `Intake apply` succeed, then check the live site.
6. Update the backlog and the GitHub Project (below).

Commit messages: plain imperative title ("Add …", "Intake: …"), a short body saying why, and the co-author line.

## Data rules

- **Keys** are lowercase-hyphenated and never change: `william-i-of-england`, `otto-iii-holy-roman-emperor`. Re-sending a key updates that record, never duplicates it. **Before adding a person, look for them**: query `entities` by name and key. Rulers show up in several batches (a king of England may also be Duke of Normandy), so reuse the existing key and add only what's new.
- **Sources:** every new person, place, event and title cites at least one source. Default: the person's English Wikipedia article, as `wp-<person-key>`. A person must cite **their own** article, not only a relative's: the site links each ruler to the cited Wikipedia article whose title best matches their name. Check facts with the article itself (WebFetch), not from memory.
- **Dates:** a year, or a full date `YYYY-MM-DD` only when the source gives the day. BC years are negative (384 BC = `-384`; there is no year 0). A month without a day becomes the year alone, with a note. Mark approximate dates `*_estimated: true` ("c.").
- **Disagreements:** when sources disagree on a date, place or attribution, record a `discrepancies` entry with each side's claim and source. Never pick silently. The record holds the best-supported value, and the note says which.
- **Titles and realms:** use one spelling per realm, everywhere ("Normandy", not "Duchy of Normandy"; "Kievan Rus'"). Every realm a title names needs a `realms` entry with a region from the fixed list in `docs/intake-format.md`. Use one title wording per realm ("King of England" for every English king, whatever the period form was) so reign strips line up. `disputed: true` is only for contested claims (Empress Matilda, 1141), never for uncertain dates. A regent, chamberlain or chief minister who held real power is a title too ("Hajib of Córdoba", "Empress Dowager (regent)").
- **Types:** `Royalty` for monarchs and their consorts, `Nobility` for dukes, counts, jarls, doges, emirs under a caliph and regents who weren't royal, `Clergy` for popes and bishops (with `roles: [pope]`), `Government` for mayors, governors and presidents (their titles show a column, not a crown; so do Notable people's, such as First Lady), `Patron` for benefactors and founders (Griffith J. Griffith, Getty), `Notable` for real people known for one story rather than an office or a body of work, usually as a film's subject (Oskar Schindler, Desmond Doss, Al Capone). `Military` for soldiers, sailors and airmen known mainly for their service (Patton, Zhukov, Yamamoto). Their commands are titles with `kind: military` (Supreme Commander, Allied Expeditionary Force), drawn in iron rather than gold and left out of the Year view's rulers; their realm is the country whose forces they served. A soldier who later led a country (Eisenhower) keeps their later type and gets the commands as military titles, which also put them in the Military group.
- **Prominence** is a 1–5 star rating, **5 = most important**. On the timeline, 5-star events are always labelled; the rest get labels while there's room. Give 5 sparingly (a Hastings, a coronation that changed a country), 1 to minor events. Blank counts as 3.
  - **Cultural figures** (types Artist, Writer, Composer, Scholar, Notable) get prominence from their Wikipedia `sitelinks` (language editions, from Wikidata; record `sitelinks` and `sitelinks_on` for every new person): 150+ = 5, 100-149 = 4, 60-99 = 3, 40-59 = 2, under 40 = 1. Don't hand-set it. Rulers, clergy and officials keep hand-set prominence.
- **Events** need a clear date in the source. Leave out vague or legendary ones, or mark them `estimated` with a note.
- **Places:** for each person, look for references to significant locations (places) and buildings that they built, or in which significant events took place, and add them with their `moments` and `events`. See `docs/BUILDOUT.md`, What to capture.
- **Images** are links only, never copied files: `image_url`, `image_thumb`, `image_page` (the Commons page), `image_license`, and for artworks `image_credit`. Use an image only when Commons marks it public domain, CC0 or a free licence; otherwise leave the fields out and say why in a comment. Strip `?utm_...` from Wikipedia image URLs. A person's picture is best an `artworks` record linked as their `portrait`, so its maker, date and licence travel with it.
- **Artworks:** give each a `creator` (a person) and, for a portrait, a `subject`; use `after` for a copy of another artwork. Don't invent a medium or kind the source doesn't state.
- **Museums:** never scrape a museum's site. Read collections only through an official API or open-data download, and record what you checked (robots.txt, terms, licence) in the museum's `data_access`, `data_licence`, `data_notes` and `data_checked_on`. A site that forbids crawling is `no-access`; an unchecked one is `unknown`.
- **Museum works without scraping:** where a museum's own terms give no right to automated access (the Louvre, the National Gallery London), read its paintings from **Wikidata** (WikiProject sum of all paintings: `P195` collection, `P31` painting, `P170` creator, `P217` inventory number, `P18` image, `P347` Joconde id for French museums) and take each image's licence from **Wikimedia Commons** (keep public domain, CC0, CC BY, CC BY-SA). Link back to the French Ministry of Culture's Joconde notice (`https://www.pop.culture.gouv.fr/notice/joconde/{id}`) where there is one. Query Wikidata with POST and chunk the museums (a single big query times out).
- **Coverage:** every person added to a batch gets `coverage` (`not-read`, `partly`, `complete`) and, for `partly`, a `coverage_note` saying what was captured and what is missing. When a person becomes the focus, read their article and list of works, add the artworks, and mark them `complete`. Blank means not yet assessed.
- **Los Angeles** work covers all of Los Angeles County (plus Anaheim, Pomona, San Clemente and Oklahoma City for the 2028 Olympic venues). Films are `artworks` with `kind: film`, linked to places as `filmed`; keep only the locale facts (what was shot where) and point at the entertainment database with `external` for everything else about the film.
- Realms Wikipedia names no confident ruler for are left out, and the batch file says so in a comment.
- Obsidian: Ty's notes are in the vault `Personal`, folder `History` (`D:\Documents\Obsidian\all vaults\Personal\History` on Ty's PC). Cloud sessions can't reach it; use Wikipedia. Set `obsidian_link` only to a note name you've seen.

## Site rules

- Colours come from the tokens at the top of `styles.css` (Bayeux Tapestry wools: woad, madder, weld, stitch, ochre, gold), redefined for dark mode. Never hard-code a colour.
- Place panels show **Nearby** (spots within 5 km, nearest 8; areas such as cities left out), **Big events nearby** (4–5 star events at those spots), **Eat and drink nearby** (live from the dining API, also drawn as small square pins on the street map) and **Elsewhere** (a record's `external` links). The distance is `NEARBY_KM` in `app.js`; the API's cap must be at least as large.
- The side map is a street map (Leaflet 1.9.4 from cdnjs, OpenStreetMap tiles, credit kept) when the pins fit in about a county, or most of them do; wider views use the coastline map.
- Views: **Explore**, the front page (one search filling six linked cards: Year, World (the border map for the year and who led each realm elsewhere), Event, Place, Person, Work; a link changes only the card it matches, except an event, which also brings its main person into the Person card; a card expands to full screen; a country picker puts that country first; the address records the cards), Timeline (lanes of lives, events lane, side panel with a places map) and Year (rulers by realm and world region, a border map, artists, writers and thinkers with what they did that year, events, births and deaths). Links go both ways between them. The Year view's makers section lists types Artist, Writer, Composer and Scholar, so give cultural figures one of those types.
- **Journey:** a person with two or more places gets a "Journey ⤢" button on the side panel's map and in the Explore Person card's Places section (links inside then go to the Explore cards). It opens a full-screen map of their events and place moments in date order (events with no place stay in the list, unpinned); picking a stop moves the map there and shows the event, its people and sources. The map is the border snapshot nearest the stop's year, or today's street map. Events order within a year by `start_date`, then `start_month` (sql/019), so give an event its `month` when the source names one.
- The **Show** buttons filter both views by group (Royalty, Nobility, Clergy, Government, Artists, Architects, Writers, Composers, Scholars, Patrons, Military, Notable people). They sit under the timeline's search box and between the Year form and the year, and double as the colour key: each group has a colour token (woad, weld, stitch, verdigris, ochre, walnut, lichen, rose, slate, indigo, iron, sage) that its people's lifespan bars share. Groups match `type` (Military also takes anyone with a military title); Architects match the `architect` role and Artists need an artistic role (painter, engraver, sculptor…), so set types and roles carefully.
- The **Fame** buttons (Icons 150+, Famous 100+, Well known 60+, Everyone) hide the long tail of artists, writers, composers, scholars and notable people by sitelinks; the default is Well known, the choice is remembered per browser. Rulers, clergy and officials are never hidden by it, and a person you searched for or selected always shows. So give every new cultural figure a `sitelinks` count, or they show at every level.
- A **person panel** shows their portrait (the Wikipedia lead image, with a Wikimedia Commons credit link) and a gallery of their works held in open museum collections (`Works in open museum collections`, up to 12, best first), and works that show them (`Shown in`). Every picture is a hotlinked thumbnail with its credit as a tooltip and a link to the museum's own page; a picture that fails to load is dropped. Only link images that are CC0 or public domain (see Data rules).
- **Films** (artworks of kind `film`) link to places as `filmed` (where it was shot) or `depicts` (where it is set), to events as `depicts`, and to real people as `subject` (who it portrays). Panels show them both ways: a person's "Portrayed in", a film's "Portrays", "Shows" and "Set in", an event's "Films about it", and a place's "Films set here" (with who each film portrays) and "Films shot here". In Explore a film is a work: it opens in the Work card, and searching a film named after someone it portrays ("Oppenheimer") puts the person in the Person card and the film in the Work card.
- Realms are searchable: a realm name in the timeline search or the Year form ("Scotland 1300") filters to its title holders. In the Year view, a realm heading or its shape on the map focuses the page on that realm. So keep realm spellings consistent (see Data rules) and give realms a `country`.
- Crowns mark people who held a title; the gold strip beside a lifespan bar marks the years held.
- Person, event and place panels show a **Sources** row linking each cited source ("Wikipedia: …", new tab). So a record without a source shows "None recorded": always cite one.
- Keep it working at 375px wide and in both themes. Check that it does.

## Maps (GPL-3.0)

`data/maps/` holds world border snapshots from historical-basemaps by André Ourednik, under GPL-3.0. Keep the `LICENSE` file, the README credit and the list of changes, and the credit line under the map. Ty chose GPL data on purpose and links to it. `index.json` lists the snapshot files, the map names that belong to each of our realms (`realms`), and capital coordinates (`points`) for realms the map draws inside a bigger one. When adding a snapshot year: fetch `geojson/world_<year>.geojson` from the source at a recorded commit, round coordinates to 3 decimals (see the README), add it to `years`, and extend `realms` / `points` for the names that year uses.

## Backlog and GitHub Project

`docs/BACKLOG.md` is the list, in a fixed format (one `####` item, a field line, a short body). Ty finds hand-editing it hard, so keep it up to date yourself: add items Ty asks for, and move finished ones to Done with the date and PR. Each item has an issue on `schmittyideas/history`, added to **GitHub Project 1** (owner schmittyideas) with the fields Status (Icebox, Ready, Blocked, In progress, Done), Priority (P1–P3) and Area (Site, Data, Tooling). Put "Closes #N" in the PR so merging closes the issue. Labels: type (`bug`, `task`, `enhancement`) and area (`site`, `data`, `tooling`).

## Running in parallel (several sessions at once)

- One batch per branch and one intake file per batch. Name files by topic so two sessions never write the same file.
- Before opening a PR, `git fetch` and rebase on `origin/main`. Re-run the local preview after rebasing, because another batch may have added the same people meanwhile. On conflict, reuse their keys.
- `docs/BACKLOG.md` and `data/maps/index.json` are shared. Change them in small, separate commits, and rebase right before pushing.
- Merges apply one at a time (the apply workflow queues). If an apply fails, fix forward with a new PR; never revert data by hand.

## Current plan: the build-out

As of October 2026 there's a large build-out queue, run on Ty's cloud session credits: English monarchs, Europe's big thrones, Indian rulers, East Asian dynasties, then the world century by century. **Read `docs/BUILDOUT.md` before starting any of it.** Its hard rule: stop before the cloud credits run out, so the work never eats Ty's weekly plan allowance, which he needs for other work.

## Unattended runs (Ty asleep or away)

Work through the task you were given without stopping to ask. Quality beats quantity:
- Check every ruler, date and event against its source. If a fact can't be confirmed, leave it out and say so in the batch file.
- Keep batches to about 150 rows in the preview (the "N to add" line), so each preview stays readable and a mistake stays small. Ty raised this from 60–80 on 2026-10-11 after batches of 110–200 rows stayed clean.
- Don't start schema changes or large site redesigns unattended unless the task says so. Data batches and small, tested site fixes are fine.
- Finish with a short summary on the last PR or issue: what was added, what was skipped and why, and any open questions for Ty.
