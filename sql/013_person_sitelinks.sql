-- 013: how widely a person is covered on Wikipedia (number of language editions with an article, from Wikidata).
-- A rough, objective popularity signal, used to rank people and to derive display tiers. null = not fetched.
alter table entities add column sitelinks int, add column sitelinks_on date;   -- count, and the day it was read
