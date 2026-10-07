-- 006: places get a life span and builders, like people and events.
-- Matches the Obsidian rule for landmarks: a start date (founded or built) and an end date only if
-- it was destroyed. Left empty means unknown, or still standing. Existing public-read policy covers these.
alter table places
  add column start_year int,                                  -- founded or built; BC is negative
  add column start_estimated boolean not null default false,  -- shown as "c."
  add column end_year int,                                    -- destroyed or demolished; empty if it still stands
  add column built_by text,                                   -- who founded or (re)built it, e.g. "Edward the Confessor"
  add column architect text;
