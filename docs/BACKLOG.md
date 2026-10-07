# History Timeline backlog

Last updated 2026-10-06 · Board: [GitHub Project](https://github.com/users/schmittyideas/projects/1)

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
