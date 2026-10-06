-- 002: keys and extra detail fields.
-- Keys let intake files refer to records by a stable name and update instead of duplicating.

-- Step A: new columns
alter table entities
  add column key text unique,
  add column roles text[] not null default '{}',
  add column birth_date date,
  add column death_date date,
  add column birth_estimated boolean not null default false,
  add column death_estimated boolean not null default false,
  add column house text,
  add column realm text,
  add column prominence smallint check (prominence between 1 and 5),
  add column note text;

alter table places
  add column key text unique,
  add column note text;

alter table events
  add column key text unique,
  add column estimated boolean not null default false,
  add column prominence smallint check (prominence between 1 and 5),
  add column note text;

alter table relationships
  add column end_year int;

-- Step B: keys for the records already in the database
update entities e set key = v.key from (values
  ('William I','william-i-of-england'), ('Robert Curthose','robert-curthose'),
  ('William II','william-ii-of-england'), ('Henry I','henry-i-of-england'),
  ('Adela','adela-of-normandy'), ('Matilda of Flanders','matilda-of-flanders'),
  ('Sybilla of Conversano','sybilla-of-conversano'), ('Matilda of Scotland','matilda-of-scotland'),
  ('Adeliza of Louvain','adeliza-of-louvain'), ('Stephen of Blois','stephen-of-blois'),
  ('Harold II','harold-ii-of-england')
) as v(name, key) where e.name = v.name;

update places p set key = v.key from (values
  ('Falaise Castle','falaise-castle'), ('Battle Abbey','battle-abbey'),
  ('Westminster Abbey','westminster-abbey'), ('Saint-Gervais, Rouen','saint-gervais-rouen'),
  ('Abbaye-aux-Hommes','abbaye-aux-hommes'), ('Abbaye-aux-Dames','abbaye-aux-dames'),
  ('Reading Abbey','reading-abbey'), ('Waltham Abbey','waltham-abbey'),
  ('Musée de la Tapisserie','musee-de-la-tapisserie'), ('Conversano','conversano'),
  ('Jerusalem','jerusalem')
) as v(name, key) where p.name = v.name;

update events ev set key = v.key from (values
  ('Battle of Hastings','battle-of-hastings'),
  ('Coronation of William I','coronation-of-william-i')
) as v(name, key) where ev.name = v.name;
