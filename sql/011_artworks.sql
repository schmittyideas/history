-- 011: artworks (paintings, engravings, miniatures, sculptures ...) as records of their own.
-- Who made one, who it shows, where it was made or hangs, which event it depicts, and which artwork it copies
-- are all links, so a painter's work can be found from the painter, the sitter, the place or the event.
create table artworks (
  id bigint primary key generated always as identity,
  key text unique not null,
  name text not null,
  kind text,                      -- painting, engraving, miniature, sculpture, drawing, medal, tapestry ...
  medium text,                    -- "oil on canvas", "line engraving"
  start_year int,                 -- when it was made (BC negative); end_year for a span
  end_year int,
  estimated boolean not null default false,
  derived_from_id bigint references artworks(id) on delete set null,   -- an engraving or copy "after" another artwork
  collection text,                -- where it is now: "Chatsworth House"
  image_url text,                 -- links only; nothing is copied
  image_thumb text,
  image_page text,                -- the Commons (or museum) page with author and licence
  image_license text,
  image_credit text,              -- credit line as the source gives it, plain text
  prominence smallint check (prominence between 1 and 5),
  obsidian_link text,
  note text,
  created_at timestamp default now()
);

create table artwork_people (
  id bigint primary key generated always as identity,
  artwork_id bigint not null references artworks(id) on delete cascade,
  entity_id bigint not null references entities(id) on delete cascade,
  role text not null,             -- creator, subject (portrayed), patron (commissioned it), engraver, owner ...
  unique (artwork_id, entity_id, role)
);
create table artwork_places (
  id bigint primary key generated always as identity,
  artwork_id bigint not null references artworks(id) on delete cascade,
  place_id bigint not null references places(id) on delete cascade,
  role text not null,             -- made, depicts, held, made-for, displayed
  unique (artwork_id, place_id, role)
);
create table artwork_events (
  id bigint primary key generated always as identity,
  artwork_id bigint not null references artworks(id) on delete cascade,
  event_id bigint not null references events(id) on delete cascade,
  role text not null,             -- depicts, commemorates, made-during
  unique (artwork_id, event_id, role)
);

-- A person's picture can be an artwork, so its maker, date and licence travel with it.
alter table entities add column portrait_artwork_id bigint references artworks(id) on delete set null;

alter table source_links drop constraint source_links_record_type_check;
alter table source_links add constraint source_links_record_type_check
  check (record_type in ('person','place','event','relationship','moment','title','artwork'));

alter table artworks enable row level security;
alter table artwork_people enable row level security;
alter table artwork_places enable row level security;
alter table artwork_events enable row level security;
create policy "Public read" on artworks for select to anon using (true);
create policy "Public read" on artwork_people for select to anon using (true);
create policy "Public read" on artwork_places for select to anon using (true);
create policy "Public read" on artwork_events for select to anon using (true);
