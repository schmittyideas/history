-- 008: realms. What a title rules (titles.realm holds the realm's name), and which part of the world it is in,
-- so the Year view can group dozens of realms under world regions instead of one long list.
-- Readable with the public key.
create table realms (
  id bigint primary key generated always as identity,
  key text unique not null,
  name text unique not null,          -- matches titles.realm exactly: "England", "Song dynasty"
  region text not null check (region in (
    'Western Europe', 'Northern Europe', 'Eastern Europe', 'Middle East and North Africa',
    'Sub-Saharan Africa', 'Central Asia', 'South Asia', 'East Asia', 'Southeast Asia', 'Americas', 'Oceania')),
  modern_country text,                -- where it is today, for context: "France", "China"
  note text,
  created_at timestamp default now()
);
alter table realms enable row level security;
create policy "Public read" on realms for select to anon using (true);
