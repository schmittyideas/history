# History Timeline

A website for exploring history as lanes of lives: ask for a slice ("Normandy 11th century", "rulers in 1066", "Henry I"), then zoom out, move across, and zoom in. Every name links to the person.

## How it works
- `index.html`, `styles.css`, `app.js`: the site. No build step; any static host works (GitHub Pages).
- `config.js`: Supabase project URL and **publishable** key (public by design). Never put the secret key here.
- `data/snapshot.js`: fallback data used when live data isn't available.
- `data/land.js`: map outline (Natural Earth 1:50m, public domain, via the world-atlas package).
- `sql/`: database changes, numbered in the order they were applied.

## Going live
1. Run `sql/001_public_read_policies.sql` in the History Project's SQL Editor (lets the site read, not write).
2. Put the project's publishable key in `config.js`.
3. Publish the folder with GitHub Pages.

## Adding history (intake)
1. Claude writes an intake file (`inbox/YYYY-MM-DD-title.yaml`, format in `docs/intake-format.md`) on a new branch and opens a pull request.
2. GitHub posts a preview on the pull request (`.github/workflows/intake-preview.yml`). It also lists any open discrepancies (where sources disagree) on the records the batch touches.
3. Merging the pull request applies it to Supabase (`.github/workflows/intake-apply.yml`). Adds and updates only; never deletes.

Needs a repository secret `SUPABASE_SECRET_KEY` (Settings → Secrets and variables → Actions). Tests: `python tests/test_intake.py`.
