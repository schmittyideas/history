-- 017: realms in time, and the countries they cover today. A realm gets the years it existed (so a year names the
-- realm a place was in), and one row per modern country it covered (the Holy Roman Empire: Germany, Austria,
-- Czech Republic, Belgium, the Netherlands, northern Italy…), with the years it held land there when that differs
-- from the realm's own span. realms.modern_country stays as the realm's main country.
alter table realms
  add column start_year integer,
  add column end_year integer,
  add column start_estimated boolean not null default false,
  add column end_estimated boolean not null default false;

create table realm_countries (
  id bigint primary key generated always as identity,
  realm_id bigint not null references realms(id) on delete cascade,
  modern_country text not null,
  start_year integer,          -- blank: from the realm's start
  end_year integer,            -- blank: to the realm's end
  note text,                   -- which part: "northern Italy", "Silesia"
  unique (realm_id, modern_country)
);
alter table realm_countries enable row level security;
create policy "Public read" on realm_countries for select to anon using (true);

-- Realms cite sources too (their dates and countries come from their Wikipedia articles).
alter table source_links drop constraint source_links_record_type_check;
alter table source_links add constraint source_links_record_type_check
  check (record_type in ('person','place','event','relationship','moment','title','artwork','museum','realm'));
