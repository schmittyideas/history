-- 009: places get a city, so a place reads "London, Greater London, England" by today's standards.
-- region = county or state, modern_country = country (both existed already). Existing public-read policy covers it.
alter table places add column city text;   -- the city or town it is in today; empty when the place is itself the city
