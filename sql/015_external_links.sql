-- 015: links from our records to entries in Ty's other databases (and public ones), so a film can point at its
-- entry in the entertainment database, and later a place can point at nearby restaurants and bars, without
-- copying their data here. Keyed by record type + key, like source_links, because keys never change.
create table external_links (
  id bigint primary key generated always as identity,
  record_type text not null check (record_type in ('person','place','event','artwork','museum')),
  record_key text not null,
  system text not null,            -- which database: 'entertainment', 'imdb', 'tmdb', 'restaurants', 'wikidata' ...
  external_id text,                -- that database's own id for the entry ("tt0095016")
  url text,                        -- a link to the entry, when it has a page
  label text,                      -- how the link reads on the site ("Die Hard in the entertainment database")
  note text,
  created_at timestamp default now(),
  unique (record_type, record_key, system)
);
alter table external_links enable row level security;
create policy "Public read" on external_links for select to anon using (true);
