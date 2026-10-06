-- Lets the website read (never write) the history tables with the publishable key.
-- Row-level security stays on; these policies only allow SELECT.
create policy "Public read" on entities      for select to anon using (true);
create policy "Public read" on relationships for select to anon using (true);
create policy "Public read" on events        for select to anon using (true);
create policy "Public read" on event_people  for select to anon using (true);
create policy "Public read" on places        for select to anon using (true);
create policy "Public read" on person_places for select to anon using (true);
