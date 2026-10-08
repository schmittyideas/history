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
| `docs/BACKLOG.md` | The backlog, mirrored as issues on GitHub Project 1 (see Backlog). |
| `.github/workflows/` | `intake-preview.yml` posts a preview on PRs that touch `inbox/`; `intake-apply.yml` applies them on merge to `main`. |

## Database

Supabase project `alhvzdvabugmkeqmvmiz`, schema `public`. Tables: `entities` (people), `relationships` (parent, spouse, patron, teacher), `events`, `event_people`, `places`, `person_places` (life moments), `titles` (who held what, when), `realms` (what a title rules, with a world region), `sources`, `source_links`, `discrepancies`, and the private `learning_log` / `learning_log_items` (no public read).

- **Reads:** the claude.ai custom connector "Supabase History" (tools named like `mcp__…__execute_sql`, `list_tables`), if this session has it. Otherwise the REST API with the anon key from `config.js`: `curl "$URL/rest/v1/entities?select=key,name" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"`.
- **Data writes:** only through intake files and pull requests. The apply workflow holds the secret key as a GitHub secret (`SUPABASE_SECRET_KEY`). Don't write data any other way.
- **Schema changes:** add `sql/00N_name.sql` (next number), then apply it with the connector's `apply_migration`. New tables get RLS on, plus `create policy "Public read" ... for select to anon using (true)` unless private. Apply **before** merging any intake file that needs it, and teach `tools/intake.py`, its tests and `docs/intake-format.md` about new fields in the same PR. Without a connector, stop and leave the SQL for Ty.
- The RouteWeaver Supabase connector, if present, is a different project. Never touch it from here.

## How a change goes in

1. Branch: `intake/YYYY-MM-DD-short-title` for data, `feature/...` or `fix/...` for site and tooling, `docs/...` for docs.
2. Data: write `inbox/YYYY-MM-DD-short-title.yaml`. Preview it locally before pushing (read-only, the anon key is enough):
   ```bash
   export SUPABASE_URL=https://alhvzdvabugmkeqmvmiz.supabase.co SUPABASE_SECRET_KEY=$(grep -o 'eyJ[^"]*' config.js) PYTHONIOENCODING=utf-8
   python tools/intake.py plan inbox/YYYY-MM-DD-short-title.yaml
   ```
   Fix every error, and every warning unless it's expected (a deliberate source-less claim, say).
3. Tooling: run `PYTHONIOENCODING=utf-8 python tests/test_intake.py` (must print ALL TESTS PASSED).
4. Site: serve with `python -m http.server 8765` and check in a browser: the console has no errors, light and dark both work, phone width (375px) has no sideways scroll. Browsers cache `app.js` hard; reload with the cache bypassed.
5. Push, open the PR (body: what changed, how it was checked; end with the Claude Code line), wait for the `preview` check, merge with a merge commit, watch `Intake apply` succeed, then check the live site.
6. Update the backlog and the GitHub Project (below).

Commit messages: plain imperative title ("Add …", "Intake: …"), a short body saying why, and the co-author line.

## Data rules

- **Keys** are lowercase-hyphenated and never change: `william-i-of-england`, `otto-iii-holy-roman-emperor`. Re-sending a key updates that record, never duplicates it. **Before adding a person, look for them**: query `entities` by name and key. Rulers show up in several batches (a king of England may also be Duke of Normandy), so reuse the existing key and add only what's new.
- **Sources:** every new person, place, event and title cites at least one source. Default: the person's English Wikipedia article, as `wp-<person-key>`. Check facts with the article itself (WebFetch), not from memory.
- **Dates:** a year, or a full date `YYYY-MM-DD` only when the source gives the day. BC years are negative (384 BC = `-384`; there is no year 0). A month without a day becomes the year alone, with a note. Mark approximate dates `*_estimated: true` ("c.").
- **Disagreements:** when sources disagree on a date, place or attribution, record a `discrepancies` entry with each side's claim and source. Never pick silently. The record holds the best-supported value, and the note says which.
- **Titles and realms:** use one spelling per realm, everywhere ("Normandy", not "Duchy of Normandy"; "Kievan Rus'"). Every realm a title names needs a `realms` entry with a region from the fixed list in `docs/intake-format.md`. Use one title wording per realm ("King of England" for every English king, whatever the period form was) so reign strips line up. `disputed: true` is only for contested claims (Empress Matilda, 1141), never for uncertain dates. A regent, chamberlain or chief minister who held real power is a title too ("Hajib of Córdoba", "Empress Dowager (regent)").
- **Types:** `Royalty` for monarchs and their consorts, `Nobility` for dukes, counts, jarls, doges, emirs under a caliph and regents who weren't royal, `Clergy` for popes and bishops (with `roles: [pope]`).
- **Prominence** is a 1–5 star rating, **5 = most important**. On the timeline, 5-star events are always labelled; the rest get labels while there's room. Give 5 sparingly (a Hastings, a coronation that changed a country), 1 to minor events. Blank counts as 3.
- **Events** need a clear date in the source. Leave out vague or legendary ones, or mark them `estimated` with a note.
- Realms Wikipedia names no confident ruler for are left out, and the batch file says so in a comment.
- Obsidian: Ty's notes are in the vault `Personal`, folder `History` (`D:\Documents\Obsidian\all vaults\Personal\History` on Ty's PC). Cloud sessions can't reach it; use Wikipedia. Set `obsidian_link` only to a note name you've seen.

## Site rules

- Colours come from the tokens at the top of `styles.css` (Bayeux Tapestry wools: woad, madder, weld, stitch, ochre, gold), redefined for dark mode. Never hard-code a colour.
- Views: Timeline (lanes of lives, events lane, side panel with a places map) and Year (rulers by realm and world region, a border map, events, births and deaths). Links go both ways between them.
- Crowns mark people who held a title; the gold strip beside a lifespan bar marks the years held.
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
- Keep batches to about 60–80 records, so each preview stays readable and a mistake stays small.
- Don't start schema changes or large site redesigns unattended unless the task says so. Data batches and small, tested site fixes are fine.
- Finish with a short summary on the last PR or issue: what was added, what was skipped and why, and any open questions for Ty.
