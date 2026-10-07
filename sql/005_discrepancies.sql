-- 005: discrepancies. Where sources disagree about a record, what each side says, and what was decided.
-- Intake previews show open ones whenever a batch touches the same record, so new sources get checked against them.
-- Readable with the public key (it's about the history, not about you).
create table discrepancies (
  id bigint primary key generated always as identity,
  key text unique not null,
  question text not null,              -- what's disputed, e.g. "Where did Coover work in 1942?"
  about jsonb not null default '[]',   -- records it concerns: [{"person": "harry-coover"}, {"event": "..."}]
  field text,                          -- which field, if one: born, died, date, place, ...
  claims jsonb not null default '[]',  -- [{"value": "...", "sources": ["source-key"], "note": "..."}]
  status text not null default 'open' check (status in ('open','resolved')),
  note text,                           -- context while it's open, e.g. which value the record uses for now
  resolution text,                     -- what the database uses and why
  created_at timestamp default now(),
  updated_at timestamp default now()
);
alter table discrepancies enable row level security;
create policy "Public read" on discrepancies for select to anon using (true);
