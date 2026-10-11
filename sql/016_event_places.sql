-- 016: an event can happen at many places (the 2028 Olympics at some forty venues; a war's battlefields), not
-- only at its main place (events.place_id, which stays). Each link has a role (venue, ceremony, start, finish,
-- village) and a note (the sports held there), so the map can show every venue and each venue's panel can
-- say what happens there.
create table event_places (
  id bigint primary key generated always as identity,
  event_id bigint not null references events(id) on delete cascade,
  place_id bigint not null references places(id) on delete cascade,
  role text not null,
  note text,
  unique (event_id, place_id, role)
);
alter table event_places enable row level security;
create policy "Public read" on event_places for select to anon using (true);
