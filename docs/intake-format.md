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
| `prominence` | 1–5 stars: how important (5 = always shown). For events, the timeline labels 5s always, then 4, 3, 2, 1 while labels fit; the rest get a small marker with the name on hover. Left out, it counts as 3 |
| `obsidian_link` | Exact Obsidian note name |
| `note` | One-line summary |
| `sources` | List of source keys |

An entry whose `key` already exists is an **update**: only the fields given change.

**BC dates.** Write BC years as negative numbers: `born: -384` means 384 BC. Count the same way as BC itself, so 384 BC is `-384`, not astronomers' `-383`. There is no year 0, so a lifespan crossing from BC to AD is one year shorter than plain subtraction suggests; the site corrects for this when it shows age. Full dates (`-0044-03-15`) aren't supported for BC: use the year alone (the preview flags a BC full date, and year `0`, as errors). The same applies to event `year`/`end_year`, link years and moment years.

### `places`
| Field | Meaning |
|---|---|
| `key`, `name` | Required for new places |
| `historical_name` | What it was called then |
| `kind` | castle, abbey, church, battlefield, city, museum, harbour, … |
| `city` | The city or town it is in today ("London"); leave out when the place is itself the city |
| `region`, `country` | County or state, and modern country, by present-day standards ("Greater London", "England") |
| `lat`, `lng` | Coordinates (decimal degrees) |
| `visitable` | `true` if you can visit it today |
| `visit_site` | What to visit (e.g. "Battle Abbey and Battlefield (English Heritage)") |
| `founded` | Year it was founded or built (BC negative). A full date is kept as its year |
| `founded_estimated` | `true` when the year is approximate (shown as "c.") |
| `ended` | Year it was destroyed or demolished. Leave out if it still stands |
| `built_by` | Who founded or (re)built it, as plain text: "Edward the Confessor; rebuilt by Henry III from 1245". Names that match a person in the database become links on the site |
| `architect` | Architect or master mason, as plain text |
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

### `titles`
Titles and reigns: who held what, from when to when. A title is separate from the person's life, as in the Obsidian notes (William I lived 1028–1087; he was Duke of Normandy 1035–1087 and King of England 1066–1087). The Year view reads these to show who ruled where.
| Field | Meaning |
|---|---|
| `person` | Person key (required) |
| `title` | The title as written: "King of England", "Duke of Normandy", "Pope" (required for new titles) |
| `realm` | What it rules, used to group the Year view: "England", "Normandy", "Papal States" (required for new titles). Use the same spelling every time |
| `from`, `to` | Start and end: year or full date (BC negative). Leave out `to` while it's still held |
| `from_estimated`, `to_estimated` | `true` when approximate |
| `disputed` | `true` for a contested claim (Empress Matilda, 1141) |
| `key` | Optional. Without it the key is `person--title--start year`, so a second reign of the same title gets its own row |
| `note`, `obsidian_link`, `sources` | As above; `obsidian_link` is the reign note, e.g. "King William I of England" |

```yaml
titles:
  - {person: william-i-of-england, title: King of England, realm: England, from: 1066-12-25, to: 1087-09-09, obsidian_link: King William I of England}
  - {person: william-i-of-england, title: Duke of Normandy, realm: Normandy, from: 1035, to: 1087}
```
The preview warns when a title starts before its holder was born or ends after they died, and when its realm has no region yet.

### `realms`
What titles rule, and which part of the world each is in. The Year view groups realms under these regions. Add a realm the first time a title names it.
| Field | Meaning |
|---|---|
| `name` | Exactly as titles write it: "England", "Song dynasty" (required) |
| `region` | One of: Western Europe, Northern Europe, Eastern Europe, Middle East and North Africa, Sub-Saharan Africa, Central Asia, South Asia, East Asia, Southeast Asia, Americas, Oceania (required for new realms) |
| `country` | Where it is today: "France", "China" |
| `key`, `note` | Optional. The key defaults to the name in lowercase with hyphens |

```yaml
realms:
  - {name: England, region: Western Europe, country: United Kingdom}
  - {name: Song dynasty, region: East Asia, country: China}
```

### `discrepancies`
Where sources disagree. Record both sides rather than silently picking one, so a later source can settle it.
| Field | Meaning |
|---|---|
| `key`, `question` | Required. The question is what's disputed |
| `about` | Records it concerns: list of `{person: …}`, `{place: …}`, `{event: …}` |
| `field` | Which field, if one: `born`, `died`, `date`, `place`, … |
| `claims` | What each side says: list of `{value, sources, note}` |
| `note` | Context while it's open, e.g. which value the record uses for now |
| `status` | `open` (default) or `resolved` |
| `resolution` | What the database uses and why. Expected when resolved |

```yaml
discrepancies:
  - key: coover-1942-employer
    question: Where did Coover work when he found cyanoacrylate in 1942?
    about: [{person: harry-coover}, {event: cyanoacrylate-discovered}]
    field: place
    claims:
      - {value: Eastman Kodak, sources: [wp-harry-coover]}
      - {value: B.F. Goodrich, sources: [wp-cyanoacrylate]}
```
The record itself holds whichever value is best supported (or leaves it out, as here). Re-send the same `key` with `status: resolved` and a `resolution` once a source settles it; add a claim if a new source takes a side.

**Checked on every intake.** When a batch adds to, updates, or links to a record that has an open discrepancy, the preview lists it under "Open discrepancies on records in this batch", with each side's claim and sources. Claude also checks for them before writing an intake.

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
- a date that isn't a year or a valid `YYYY-MM-DD` (e.g. `1066-13-40`, `c. 1100`, a BC full date), in any section
- impossible dates (died before born; a child born after a parent died, beyond a pregnancy's length)
- a place without coordinates (it can't appear on the map)
- a possible duplicate: a new person whose name and dates closely match someone already in the database
- an open discrepancy on any record the batch touches (see `discrepancies`)
- a section name it doesn't recognise (a typo would otherwise be silently ignored)

Nothing is written until you approve.
