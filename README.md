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
