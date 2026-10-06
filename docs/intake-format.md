# Intake file format

An **intake file** is how new history gets into the database. Claude writes one when you send information or ask for research; you review a preview; on approval it's applied to Supabase.

- One file per batch, saved as `inbox/YYYY-MM-DD-short-title.yaml`.
- Written in YAML: plain text, readable on a phone, no database IDs.
- Everything is referred to by a **key**: a short, unique, lowercase name like `henry-i-of-england`. Keys never change, so re-sending information **updates** a record instead of creating a duplicate.
- Applying a file only **adds or updates**. It never deletes. Removing something is a separate, deliberate step.

## Sections

Every section is optional; include only what the batch needs.

### `batch` (required)
```yaml
batch:
  title: The White Ship and the succession crisis
  requested: "Add Henry I's children, the White Ship, and King Stephen"
  date: 2026-10-05
```

### `sources`
Where the facts came from. Every person, event, place and link should cite at least one.
```yaml
sources:
  - key: wp-white-ship
    title: White Ship (Wikipedia)
    url: https://en.wikipedia.org/wiki/White_Ship
```

### `people`
| Field | Meaning |
|---|---|
| `key` | Unique key (required) |
| `name` | Display name (required for new people) |
| `type` | Main type, used for colour: Royalty, Nobility, Clergy, Artist, Writer, Composer, Scholar |
| `roles` | Extra roles: e.g. `[patron]`, `[pope]`, `[painter, architect]` |
| `born`, `died` | Year, or full date `1120-11-25`. BC years are negative: `-384` = 384 BC (see below) |
| `born_estimated`, `died_estimated` | `true` when the date is approximate (shown as "c.") |
| `house`, `realm` | Optional: dynasty and realm, used for lanes later |
| `prominence` | 1–5: how important when zoomed out (5 = always shown) |
| `obsidian_link` | Exact Obsidian note name |
| `note` | One-line summary |
| `sources` | List of source keys |

An entry whose `key` already exists is an **update**: only the fields given change.

**BC dates.** Write BC years as negative numbers: `born: -384` means 384 BC. Count the same way as BC itself, so 384 BC is `-384`, not astronomers' `-383`. There is no year 0, so a lifespan crossing from BC to AD is one year shorter than plain subtraction suggests; the site corrects for this when it shows age. Full dates (`-0044-03-15`) aren't supported for BC: use the year alone. The same applies to event `year`/`end_year`, link years and moment years.

### `places`
| Field | Meaning |
|---|---|
| `key`, `name` | Required for new places |
| `historical_name` | What it was called then |
| `kind` | castle, abbey, church, battlefield, city, museum, harbour, … |
| `region`, `country` | Region and modern country |
| `lat`, `lng` | Coordinates (decimal degrees) |
| `visitable` | `true` if you can visit it today |
| `visit_site` | What to visit (e.g. "Battle Abbey and Battlefield (English Heritage)") |
| `obsidian_link`, `sources` | As above |

### `events`
| Field | Meaning |
|---|---|
| `key`, `name`, `type` | Required for new events (type: Battle, Coronation, Shipwreck, Treaty, Crusade, …) |
| `date` or `year` | Start; add `end_year` for long events |
| `estimated` | `true` if the date is approximate |
| `place` | Place key |
| `people` | List of `{person: key, role: …}` (victor, defeated, crowned, died, …) |
| `prominence`, `obsidian_link`, `note`, `sources` | As above |

### `links`
Relationships between people. One line each:
```yaml
links:
  - {parent: henry-i-of-england, child: william-adelin}
  - {spouse: william-adelin, to: matilda-of-anjou, year: 1119}   # first = family member, second = married in
  - {patron: lorenzo-de-medici, artist: michelangelo, from: 1489, to: 1492}
  - {teacher: verrocchio, student: leonardo-da-vinci}
```

### `moments`
Life moments that aren't events: born, died, buried, trained, worked, lived.
```yaml
moments:
  - {person: henry-i-of-england, role: died, place: lyons-la-foret, year: 1135}
```

### `log` (private)
Where you learned it: one entry per thing you came across. Linked to every record it touched. Stored privately: the public website can't read it.
| Field | Meaning |
|---|---|
| `key`, `title` | Required. Title is what caught your attention |
| `learned_on` | Date you came across it |
| `medium` | podcast, book, article, video, museum, site visit, conversation, … |
| `source_title`, `source_detail` | e.g. "The Rest Is History", "Episode 412" |
| `url` | Link to the episode, article or page |
| `where` | Where you were, if relevant |
| `notes` | Your own thoughts |
| `links` | Extra links for later: list of `{title, url}` |
| `details` | Anything else worth keeping: follow-up questions, things to visit |
| `about` | Records it touched: `{person: …}`, `{place: …}`, `{event: …}` |

```yaml
log:
  - key: 2026-10-05-white-ship-podcast
    title: The White Ship disaster
    learned_on: 2026-10-05
    medium: podcast
    source_title: The Rest Is History
    source_detail: Episode on the White Ship
    notes: One shipwreck caused a 19-year civil war.
    links:
      - {title: "White Ship (Wikipedia)", url: "https://en.wikipedia.org/wiki/White_Ship"}
    details:
      follow_up: ["Who survived the wreck?", "Visit Barfleur on a Normandy trip"]
    about:
      - {event: white-ship-1120}
      - {person: william-adelin}
      - {place: barfleur}
```

## What the preview checks

Before anything is applied, the preview lists every addition and update, and flags:
- a key that doesn't exist in the database or in the file (likely a typo)
- a new record without a source
- impossible dates (died before born; a child born after a parent died, beyond a pregnancy's length)
- a place without coordinates (it can't appear on the map)
- a possible duplicate: a new person whose name and dates closely match someone already in the database

Nothing is written until you approve.
