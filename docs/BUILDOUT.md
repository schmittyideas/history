# History build-out plan (cloud session credits)

Decided with Ty on 2026-10-07. A large, verified expansion of the database, run in Claude Code cloud sessions on Ty's **cloud session credits** (they expire 11:59 PM PST, 4 November 2026). Read `CLAUDE.md` first: every rule there applies here.

## The one hard rule: don't touch Ty's weekly allowance

Ty has more important work that needs his weekly Claude usage. The cloud credits are spent first; **once they run out, cloud sessions start drawing on Ty's weekly plan, and that must not happen.**

- **Credit balance:** not yet known. Ty saw the expiry but not the amount; ask him for it at the start of the session if it's still unknown. Size the work to about **70% of the credit**, leaving room in case cloud credit isn't charged exactly at API rates.
- **Cost guide** (API rates, Claude Opus 5.5): about $1.50–3.50 per million tokens for this kind of work, most of it re-read context at the cached rate. A verified ruler costs about 8,000–10,000 tokens all in (research, checking, intake, preview, PR). So 100 rulers ≈ 1M tokens ≈ $2–4.
- **Stop rule:** if you can read plan usage (a usage tool showing weekly %), note the weekly figure before starting. If it rises by more than 2 points, the credit has run out: finish or close any open PR cleanly, write the summary, and stop all work. If you can't read usage at all, stay within the work caps below and stop when they're done.
- No extra usage: it's off on Ty's account, and it stays off.

## The queue, in order

Do them in this order. Each is a GitHub issue on Project 1. Within each, go in order of importance (oldest and most central first), so stopping early still leaves something useful. Up to about 60–80 records per batch (one intake file and one PR per batch).

| # | Build-out | Issue | Rough size | Notes |
|---|---|---|---|---|
| 1 | **English monarchs, 1066 to today** | #15 | ~40 people, ~0.4M tokens | Every King and Queen of England, then Great Britain and the United Kingdom, with reigns (`realm: England` until 1707, then `Great Britain`, then `United Kingdom` from 1801; add the realms), consorts where notable, coronations. Edward the Confessor to Henry III and Stephen are already in: reuse their keys. Ty's Obsidian has a "Royalty timelines" note for most of them; cloud sessions can't read it, so use Wikipedia (List of English monarchs, List of British monarchs, each article). Run this first to measure cost (see Calibrate). |
| 2 | **Europe's big thrones, 1000–1500** | #31 | ~200 people, ~2M | France, the Holy Roman Empire, the Papacy (~90 popes: do it last, possibly in its own batches), Castile and León, Scotland, Byzantium. Many 1000-era holders are already in from the world-in-1000 batch: reuse their keys. |
| 3 | **Indian rulers, 1000–1600** | #32 | ~100 people, ~1M | Ty asked for India before East Asia. Cholas, Western Chalukyas and Hoysalas, Palas and Senas, the Delhi Sultanate (all dynasties), Vijayanagara, the Bahmanis, Rajput kingdoms (Chauhans, Mewar), the Mughals to Akbar. Key battles: Tarain 1191, Panipat 1526, Talikota 1565. Region: South Asia. |
| 4 | **East Asian dynasties, 1000–1600** | #33 | ~150 people, ~1.5M | Song, Liao, Jin, Yuan, Ming; Japan's emperors plus the Kamakura and Ashikaga shoguns and the Hōjō regents; Goryeo and Joseon; Đại Việt. Region: East Asia, Southeast Asia for Vietnam. |
| 5 | **The world, century by century (1100–1500), with maps** | #34 | ~200 people, ~2M | Repeat the world-in-1000 build for 1100, 1200, 1300, 1400 and 1500, reusing everyone the earlier build-outs added. Add the border snapshots to `data/maps/` (see CLAUDE.md, Maps) with `index.json` names and capital `points`. This is the only item with a site-side change; keep it to the data files and `index.json`. |

Ty said "do it all". The whole queue is roughly 700 people and ~7M tokens (likely $10–25 at API rates, but anywhere from $5 to $50), so it only all fits if the credit is large enough. If it isn't, stop where the credit cap says and leave the rest Ready on the board.

## Calibrate after the first build-out

When #15 is merged: note the tokens used and, if readable, how much the weekly % or credit moved. Work out the cost per person, then check that the next item fits the remaining budget before starting it. Record the figures in the summary.

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
