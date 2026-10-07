# History Timeline backlog

Last updated 2026-10-06

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

#### [P2] Lanes by dynasty and realm
`type: enhancement` · `area: site` · `status: ready` · `issue: —`

People carry `house` and `realm` (added in `sql/002`), but the Lanes control only offers Family and Type. Add House and Realm options to the grouping in `app.js`. `app.js` loads `select=*`, so the fields are already in the data.
Source: `docs/intake-format.md` ("used for lanes later").

### Icebox

---

## Data

### Ready (ranked)

#### [P2] Add Emperor Henry V
`type: task` · `area: data` · `status: ready` · `issue: —`

Empress Matilda's first husband (married 1114). Intake: the person, a `spouse` link to `empress-matilda`, and a source.
Source: Empress Matilda's note in `inbox/2026-10-05-white-ship.yaml` ("not yet added").

#### [P3] White Ship follow-ups
`type: task` · `area: data` · `status: ready` · `issue: —`

Who survived the wreck (the butcher Berold is the usual answer). Visiting Barfleur on a Normandy trip belongs in a learning-log entry rather than here.
Source: `inbox/examples/2026-10-05-white-ship.yaml` log `follow_up`.

### Icebox

---

## Tooling

### Ready (ranked)

### Icebox

---

## Done

#### [P2] Intake crashed on a BC full date instead of showing an error
`type: bug` · `area: tooling` · `status: done` · `issue: —`

`-0044-03-15` (and year `0`, or any malformed date) crashed `tools/intake.py`. Event, link, moment and log dates were only parsed during apply, so a bad one could stop a run after some writes. The preview now checks every date field and lists bad ones as errors (2026-10-06).
Source: found while adding Aristotle (PR #2).

#### [P3] Stop tracking the Python cache file
`type: bug` · `area: tooling` · `status: done` · `issue: —`

`tools/__pycache__/intake.cpython-313.pyc` was committed with the intake script. Removed it and added `__pycache__/` to `.gitignore` (2026-10-06).
Source: commit `8f56234`.
