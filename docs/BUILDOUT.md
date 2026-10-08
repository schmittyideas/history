# History build-out plan (cloud session credits)

Decided with Ty on 2026-10-07. A large, verified expansion of the database, run in Claude Code cloud sessions on Ty's **cloud session credits** (they expire 11:59 PM PST, 4 November 2026). Read `CLAUDE.md` first: every rule there applies here.

## The one hard rule: don't touch Ty's weekly allowance

Ty has more important work that needs his weekly Claude usage. The cloud credits are spent first; **once they run out, cloud sessions start drawing on Ty's weekly plan, and that must not happen.**

- **Credit balance:** $248 at the start of the 2026-10-08 session (Ty reads it from his billing page; Claude cannot see it). Size the work to about 70% of it. Size the work to about **70% of the credit**, leaving room in case cloud credit isn't charged exactly at API rates.
- **Cost guide** (API rates, Claude Opus 5.5): about $1.50–3.50 per million tokens for this kind of work, most of it re-read context at the cached rate. A verified ruler costs about 8,000–10,000 tokens all in (research, checking, intake, preview, PR). So 100 rulers ≈ 1M tokens ≈ $2–4.
- **Stop rule:** if you can read plan usage (a usage tool showing weekly %), note the weekly figure before starting. If it rises by more than 2 points, the credit has run out: finish or close any open PR cleanly, write the summary, and stop all work. If you can't read usage at all, stay within the work caps below and stop when they're done.
- No extra usage: it's off on Ty's account, and it stays off.

## The queue, in order

Do them in this order. Each is a GitHub issue on Project 1. Within each, go in order of importance (oldest and most central first), so stopping early still leaves something useful. Up to about 60–80 records per batch (one intake file and one PR per batch).

| # | Build-out | Issue | Rough size | Notes |
|---|---|---|---|---|
| 1 | **English monarchs, 1066 to today** | #15 | ~40 people, ~0.4M tokens | Every King and Queen of England, then Great Britain and the United Kingdom, with reigns (`realm: England` until 1707, then `Great Britain`, then `United Kingdom` from 1801; add the realms), consorts where notable, coronations, plus their places and events (see What to capture). Edward the Confessor to Henry III and Stephen are already in: reuse their keys. Ty's Obsidian has a "Royalty timelines" note for most of them; cloud sessions can't read it, so use Wikipedia (List of English monarchs, List of British monarchs, each article). Run this first to measure cost (see Calibrate). |
| 2 | **Europe's big thrones, 1000–1500** | #31 | ~200 people, ~2M | France, the Holy Roman Empire, the Papacy (~90 popes: do it last, possibly in its own batches), Castile and León, Scotland, Byzantium. Many 1000-era holders are already in from the world-in-1000 batch: reuse their keys. |
| 3 | **Indian rulers, 1000–1600** | #32 | ~100 people, ~1M | Ty asked for India before East Asia. Cholas, Western Chalukyas and Hoysalas, Palas and Senas, the Delhi Sultanate (all dynasties), Vijayanagara, the Bahmanis, Rajput kingdoms (Chauhans, Mewar), the Mughals to Akbar. Key battles: Tarain 1191, Panipat 1526, Talikota 1565. Region: South Asia. |
| 4 | **East Asian dynasties, 1000–1600** | #33 | ~150 people, ~1.5M | Song, Liao, Jin, Yuan, Ming; Japan's emperors plus the Kamakura and Ashikaga shoguns and the Hōjō regents; Goryeo and Joseon; Đại Việt. Region: East Asia, Southeast Asia for Vietnam. |
| 5 | **The world, century by century (1100–1500), with maps** | #34 | ~200 people, ~2M | Repeat the world-in-1000 build for 1100, 1200, 1300, 1400 and 1500, reusing everyone the earlier build-outs added. Add the border snapshots to `data/maps/` (see CLAUDE.md, Maps) with `index.json` names and capital `points`. This is the only item with a site-side change; keep it to the data files and `index.json`. |

## What to capture for each ruler

Added by Ty on 2026-10-08. For every ruler, not just the reign:

- **The person and their title:** life dates, reign, notable consorts, coronation (as an event).
- **Places:** look for references to significant locations (places) and buildings that they built, or in which significant events took place. Add each as a `places` record with its `kind` (castle, abbey, cathedral, palace, battlefield, city, …), coordinates, `founded` / `ended`, `built_by` and `visitable`. Include where they were born, crowned, died and buried, as `moments` linked to those places.
- **Events:** the significant events of their life and reign (battles, treaties, rebellions, coronations), each with a place where the source gives one, the people involved, and a prominence rating.

The same rules apply as everywhere else: cite a source for every new place and event, check each fact against the article, and leave out anything that can't be confirmed. Only keep places and events that matter to the ruler's story, not every place the article mentions. The extra work makes each ruler more expensive (estimated 30–50% more tokens), so measure it in the first build-out (see Calibrate).

Ty said "do it all". The whole queue is roughly 700 people and ~7M tokens (likely $10–25 at API rates, but anywhere from $5 to $50), so it only all fits if the credit is large enough. If it isn't, stop where the credit cap says and leave the rest Ready on the board.

## Calibrate after the first build-out

When #15 is merged: note the tokens used and, if readable, how much the weekly % or credit moved. Work out the cost per person, then check that the next item fits the remaining budget before starting it. Record the figures in the summary.

## Calibration: item 1 (English monarchs), 2026-10-08

- Cost: **about $9** ($248 to $239, read by Ty) for about 64 new people plus their places, events, reigns and discrepancies, in 4 batches and a city back-fill. That is about **$0.14 per person**, all in, roughly five times the original reigns-only estimate, because places and events are now captured too, and because of the setup problems below.
- Budget after item 1: about $165 of the 70% cap remains. The rest of the queue (~650 people) should cost roughly $90–130 at this rate. Re-check the rate after item 2.

## Calibration: item 2 (Europe's big thrones), 2026-10-08

- Added **182 people** (France 22, Holy Roman Empire 24, Castile and León 21, Scotland 24, Byzantium 31, Papacy 60), 221 title rows and 66 discrepancies, in 7 data PRs (#57, #58, #59, #60, #66, #68, #70) plus a coverage backfill (#71). The 6 realms took one agent each (Papacy two).
- Tokens: the 7 research agents used **about 2.45M** (measured). The main session's share is not measured; roughly 0.4-0.5M. So about **2.9M tokens, or about 16,000 per person** (item 1 was nearer 10,000), because every ruler also has places, moments and events. Credit used: not readable from here; Ty to read the billing page.
- Batches ran 160-200 preview rows (the guide says 60-80). They were still clean, so one PR per realm was kept; splitting would have made the second half depend on places from the first.
- Pace: about 1 article per 15-60 seconds is what Wikipedia allowed; downloads, not research, set the pace.

## Lessons from item 2

- **`tools/wiki.py`** (PR #56) replaces the shell loop for downloads: serial, a proper User-Agent, waits for `Retry-After`, records the revision ID. Run it detached (`setsid nohup ... &`): a background job started the plain way died when the tool shell restarted. Quote or avoid titles with brackets in shell lists; use a file of titles with `xargs -a`.
- Check each downloaded file's first lines: some titles land on a disambiguation page (Adolf of Nassau).
- Agents write the file; the main session runs the preview, fixes warnings (a discrepancy needs two claims), decides judgement calls (here, `disputed` was dropped from the Western Schism popes because the rival line was not entered) and merges one PR at a time, waiting for `Intake apply` each time.
- New rule mid-run: `coverage` on every person. Backfill with a small update-only intake rather than reopening merged files.

## Lessons from item 1

- **Wikipedia:** research agents' WebFetch could not reach `en.wikipedia.org`, even with network access set to Full (curl could). Download the articles first with `curl` from the main session, saved as plain text, then have the agents read the local copies. Use the MediaWiki API (`action=query&prop=extracts&explaintext=1`) with a descriptive `User-Agent`; it rate-limits (HTTP 429), so fetch one article at a time with pauses and retries. Redirected titles can land on a disambiguation page ("Victoria" is one; "Queen Victoria" is the article). Check the file isn't an error before launching agents.
- **Network access:** the environment must be set to Full (or allow `en.wikipedia.org`) before the session starts, or it needs a new session.
- **Agents:** each agent reads the brief and its local articles, writes one YAML file, and does not touch the repo. The main session then runs `tools/intake.py plan`, fixes unknown place keys, adds cities, and opens the PR. Define every shared place in exactly one batch and reference it by key elsewhere.
- **Merging:** the apply workflow queue keeps only one waiting run, so merging a second PR while one is applying and another is waiting cancels the waiting one (its data never lands). Merge one PR at a time and wait for `Intake apply` to finish. If a run is cancelled, re-send the file in a new PR.
- **Gaps to expect:** facts the articles do not give (a day, a place of death) are left out and noted, not guessed. Coordinates are mostly from general knowledge and approximate.

## Lessons from the English artists batch (1600-1700)

- **Cost:** 48 people, 68 places, 39 events and 174 moments from four Sonnet research agents (about 640k tokens in total) plus the main session. Ran on Ty's weekly allowance by his choice, outside the queue.
- **Downloading:** one script in the scratchpad fetched each article's plain text, lead image and Commons licence (MediaWiki API, `User-Agent`, 2 second pauses, about 5 seconds per person), so it took about 5 minutes for 48. Check the redirect: "Roger Pratt" is a disambiguation page, the article is "Roger Pratt (architect)". Run it with the shell's normal foreground or `run_in_background`; a `&` inside a command was killed when the call ended.
- **Agents:** group by kind (painters, architects, writers, composers and scholars), one YAML fragment each, and tell each which shared places the architects agent defines. Expect duplicate place keys across fragments; merge and dedupe, then trim: keep events rated 3 and up, and only places that a kept moment or event uses.
- **Merging fragments:** YAML dates load as dates, so convert them back to `YYYY-MM-DD` strings when re-dumping. Comments are lost on re-dump; put the agents' doubts into a reviewer note at the top of the file.
- **Images:** Wikipedia lead images are public domain for most 17th-century people; some files are local to en.wikipedia (no Commons record, so no licence): skip those. The Commons "Artist" field carries who made the image (it names the engraver of a portrait "after" a painter), so capture it as an artwork record's creator, not just the person's picture.
- **Gaps:** the `image_credit` for the 44 existing person images is in the downloaded Commons data but was not stored (issue #62).

## How to run it

- **One build-out at a time** is the simplest. If the session can start parallel cloud sessions, at most two at once, each on its own issue, own branches and own intake files (see CLAUDE.md, Running in parallel).
- **Research:** check each ruler against their English Wikipedia article (WebFetch). Agents per region or per dynasty work well: the world-in-1000 batch used four parallel research agents, each returning YAML-shaped data with `doubt:` lines. Then normalise everything to `docs/intake-format.md` (one realm spelling, one title wording per realm, `disputed` only for contested claims, discrepancies for real disagreements) and run the local preview before every PR.
- **Merge** each PR yourself once the preview passes, watch the apply run, and spot-check the Year view on the live site for one year per batch.
- **Backlog:** move each build-out's issue to Done in `docs/BACKLOG.md` and on the Project when it's finished. If it stopped partway, say how far it got in the issue.

## When finished (or stopped)

Comment on the last PR or on issue #15 with a summary for Ty:
- what was added, per build-out (people, titles, events)
- what was skipped and why
- discrepancies recorded
- cost figures (tokens and, if readable, the weekly % before and after)
- what's left in the queue
