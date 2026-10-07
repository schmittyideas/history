-- 007: titles. One row per title a person held, with its own start and end: "King of England 1066–1087"
-- alongside the person's life (1028–1087). Mirrors the Obsidian rule that a reign is its own note
-- (King William I of England) apart from the person (William I). Feeds the Year view: who ruled where, when.
-- Readable with the public key, like the rest of the history.
create table titles (
  id bigint primary key generated always as identity,
  key text unique not null,
  entity_id bigint not null references entities(id) on delete cascade,
  title text not null,                                -- "King of England", "Duke of Normandy"
  realm text not null,                                -- what it rules, used to group the Year view: "England", "Normandy"
  start_year int,                                     -- BC is negative
  start_date date,
  start_estimated boolean not null default false,
  end_year int,                                       -- empty while still held
  end_date date,
  end_estimated boolean not null default false,
  disputed boolean not null default false,            -- a contested claim (Empress Matilda, 1141)
  note text,
  obsidian_link text,                                 -- the reign note, e.g. "King William I of England"
  created_at timestamp default now()
);
create index titles_entity_id on titles (entity_id);
create index titles_realm_years on titles (realm, start_year, end_year);
alter table titles enable row level security;
create policy "Public read" on titles for select to anon using (true);

-- Titles can cite sources like everything else.
alter table source_links drop constraint source_links_record_type_check;
alter table source_links add constraint source_links_record_type_check
  check (record_type in ('person','place','event','relationship','moment','title'));
