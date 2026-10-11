# Handoff: where the History Timeline stands (2026-10-11)

Paste this into a new chat, then say what you want next. Read `CLAUDE.md` and `docs/BUILDOUT.md` first (every rule applies; the BUILDOUT "Lessons" sections hold the pipelines). Model and token limits: ask before changing them.

## What exists now (live at https://schmittyideas.github.io/history/)
- Database (Supabase `alhvzdvabugmkeqmvmiz`): about 1,500 people (541 Western painters 1500 to today, 55 pre-1500 masters, sculptors, architects and graphic artists, 74 patrons, 48 English artists 1600-1700, plus rulers and others), places, events, titles and realms, **artworks (about 4,600, about 3,500 with free images, about 3,800 linked to 101 museums)**, **museums (115)**, sources, discrepancies.
- Per person: `sitelinks` (Wikipedia language editions, a popularity signal; dated 2026-10-10), `prominence` for artists/writers/composers/scholars derived from it (150+ = 5 ... under 40 = 1), `coverage` (`partly` for all painters: dates, places and one to a few works captured; portfolios not built out).
- Per artwork: creator link, optional `museum` / `accession` / `museum_url`, free image links with licence and credit (hotlinked: CC0, public domain, CC BY/BY-SA).
- Per museum: location, website, `data_access` (open-api, open-data-download, website-only, no-access, unknown), licence and notes on what was checked and when.
- Site: person panel shows the portrait and a gallery of their works with museum links; **Fame** buttons (Icons 150+, Famous 100+, Well known 60+, Everyone; default Well known) hide the long tail of cultural figures; Show buttons filter by group.

## How things get in (never write data any other way)
Branch, write `inbox/YYYY-MM-DD-title.yaml`, `python tools/intake.py plan <file>` (set SUPABASE_URL and SUPABASE_SECRET_KEY from config.js as in CLAUDE.md), fix errors and warnings, open a PR, wait for the `preview` check, merge, wait for `Intake apply`, check the live site. Format: `docs/intake-format.md`. Schema changes: `sql/NNN_*.sql` applied with the connector's `apply_migration` first (latest: 014 museums). Tests: `PYTHONIOENCODING=utf-8 python tests/test_intake.py`. Never `git add -A` (other sessions' `.claude/worktrees` get staged). Never merge on a failed preview.

## The routes for getting museum works (no scraping, ever)
1. Official APIs/open data (done): Met (v1.1 search; v1 retired 2026-10-01), Art Institute of Chicago, Cleveland, National Gallery of Art (CSVs on GitHub), Rijksmuseum (Linked Art), MoMA and Tate (CC0 metadata, no images).
2. **Wikidata + Wikimedia Commons** for everything else, especially museums whose own terms forbid reading (Louvre, National Gallery London): `P195` collection, `P170` creator, `P217` inventory number, `P18` image, `P347` Joconde id (link back to pop.culture.gouv.fr). Query by POST, chunk the museums.
3. Scripts live only in a session scratchpad (not in the repo): acquire.py (Met/AIC/Cleveland), nga_acquire.py, rijks_acquire.py, meta_acquire.py, wd_collection.py, build_acq.py, shipf.sh. Rebuild from the BUILDOUT lessons if needed.

## What is left (see `docs/BACKLOG.md`; GitHub Project 1)
- **#129 Museums**: V&A, Statens Museum for Kunst, Harvard (needs a free key), Minneapolis and the Smithsonian museums; museum-page links for non-French museums (Wikidata gives inventory numbers only); a second pass for the 34 museums whose terms are still `unknown` (research agents got thin results for about a third); merge the duplicate Statens Museum for Kunst / National Gallery of Denmark records; works for painters below the 40-edition cut; National Gallery London and the Louvre have no official data route (asking them is an option).
- **#126 Artists**: professional photographers; non-Western artists (Hokusai, Kahlo, Rivera, Tagore: outside the Europe/US scope Ty set); lesser-known painters.
- Artist portfolios: each painter is `coverage: partly`. Build a painter out (all works, with images) when they become the focus, then mark `complete`.
- Site: show artworks on artwork, place and event panels; museum pages; apply tiers to label size on the timeline; **check Art Institute of Chicago images load in a normal browser** (they did not in the desktop app's built-in browser; failures are hidden).
- Data gaps: Thomas Cromwell was not written (one patron link missing); death places missing where Wikipedia articles were cut at 32,000 characters; about 40 minor patrons exist only in artwork notes; refresh `sitelinks` now and then.
- The big build-out queue in `docs/BUILDOUT.md` (Europe's thrones, India, East Asia, the world by century) is separate and still open; its rule is to stay inside the cloud credits, never Ty's weekly allowance.

## Working with Ty
Short, plain answers with one recommendation. Ty reads usage meters (weekly and 5-hour); there is a usage tool (`get_usage`) to read them. Ty approves scope with "go". For unattended runs: finish with a short summary on the last PR or issue.
