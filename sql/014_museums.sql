-- 014: museums and galleries as records, so an artwork can say where it is and link back to the museum's own page for it.
-- The data-access columns record what we found about reading each museum's collection (open API, licence, robots rules),
-- so we never scrape a site that forbids it and prefer an official open-data route where one exists.
create table museums (
  id bigint primary key generated always as identity,
  key text unique not null,
  name text not null,
  kind text,                       -- art museum, gallery, library, palace, church ...
  address text,                    -- street address or a short "where": "Rue de Rivoli"
  city text,
  region text,
  modern_country text,
  lat double precision,
  lng double precision,
  website text,                    -- the museum's home page
  start_year int,                  -- opened or founded
  collection_url text,             -- the online collection or search page
  collection_url_pattern text,     -- how to build a link to one object, e.g. https://example.org/object/{id}
  data_access text,                -- 'open-api', 'open-data-download', 'website-only', 'no-access', 'unknown'
  data_api_url text,               -- the API or download page, when there is one
  data_licence text,               -- licence of the museum's data and images, e.g. CC0
  data_notes text,                 -- what is allowed and what was checked (robots.txt, terms), with the date
  data_checked_on date,
  place_key text,                  -- the matching row in places, if the museum is also a place we show on the map
  obsidian_link text,
  note text,
  created_at timestamp default now()
);
alter table artworks add column museum_id bigint references museums(id) on delete set null,
  add column accession_number text,           -- the museum's own number for the object
  add column museum_url text;                 -- the object's page on the museum's site
alter table source_links drop constraint source_links_record_type_check;
alter table source_links add constraint source_links_record_type_check
  check (record_type in ('person','place','event','relationship','moment','title','artwork','museum'));
alter table museums enable row level security;
create policy "Public read" on museums for select to anon using (true);
