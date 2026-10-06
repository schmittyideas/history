-- 003: sources, and which records each source supports.
create table sources (
  id bigint primary key generated always as identity,
  key text unique not null,
  title text not null,
  url text,
  author text,
  note text,
  created_at timestamp default now()
);
alter table sources enable row level security;
create policy "Public read" on sources for select to anon using (true);

create table source_links (
  id bigint primary key generated always as identity,
  source_id bigint not null references sources(id) on delete cascade,
  record_type text not null check (record_type in ('person','place','event','relationship','moment')),
  record_key text not null,
  created_at timestamp default now(),
  unique (source_id, record_type, record_key)
);
alter table source_links enable row level security;
create policy "Public read" on source_links for select to anon using (true);
