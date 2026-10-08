# Historical border maps

World borders for snapshot years, shown at the top of the site's Year view.

**Source:** [historical-basemaps](https://github.com/aourednik/historical-basemaps) by André Ourednik and contributors, commit `da7a4b7` (15 September 2026).

**Licence:** GPL-3.0 (see `LICENSE` in this folder). These files, and any changes to them, stay under GPL-3.0: anyone may copy, change and share them. The rest of the History Timeline site (its code and its own data) is separate and not covered by this licence.

**What was changed from the source:**
- Coordinates rounded to 3 decimal places (about 100 m), with points that became repeats dropped, to halve the file size.
- Only the `NAME`, `SUBJECTO`, `PARTOF` and `BORDERPRECISION` properties kept.

**Accuracy:** the source calls itself a work in progress. Borders before the modern era are approximate and often disputed, and the source warns that fixed borders mean little before the Peace of Westphalia (1648).

**Files:**
- `world_1000.geojson`, `world_1100.geojson`: one snapshot each. The Year view uses the latest snapshot at or before the year asked for, up to 99 years back.
- `index.json`: which years exist, and which map names belong to which realm in the database (`realms.name` → `NAME` in the map). A realm can match several names (Denmark is "Denmark-Norway" in 1000 and "Denmark" in 1100).
