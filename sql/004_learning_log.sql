-- 004: personal learning log. PRIVATE: row-level security on and no public read policy,
-- so the website's public key cannot see it. Only the dashboard and the secret key can.
create table learning_log (
  id bigint primary key generated always as identity,
  key text unique not null,
  title text not null,             -- what caught your attention
  learned_on date,                 -- when you came across it
  medium text,                     -- podcast, book, article, video, museum, site visit, conversation, ...
  source_title text,               -- e.g. "The Rest Is History"
  source_detail text,              -- episode, chapter, page, gallery room
  url text,
  where_text text,                 -- where you were, if relevant (e.g. "National Gallery, London")
  notes text,                      -- your own thoughts
  links jsonb not null default '[]',   -- extra links for later: [{"title": "...", "url": "..."}]
  details jsonb not null default '{}', -- anything else worth keeping (follow-ups, questions)
  created_at timestamp default now()
);
alter table learning_log enable row level security;

create table learning_log_items (
  id bigint primary key generated always as identity,
  log_id bigint not null references learning_log(id) on delete cascade,
  record_type text not null check (record_type in ('person','place','event','artwork')),
  record_key text not null,
  created_at timestamp default now(),
  unique (log_id, record_type, record_key)
);
alter table learning_log_items enable row level security;
