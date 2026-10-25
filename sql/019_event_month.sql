-- 019: the month of an event whose source gives a month but no day ("early December 1066"), so events in the
-- same year can be put in order (the journey map steps through a person's events in date order).
-- Blank when the day is known (start_date holds it) or the month isn't.
alter table events
  add column start_month smallint check (start_month between 1 and 12);
