-- 021: a family link that tradition or family-tree sites claim but no record proves (the Rosel-to-Russell line),
-- so it can be shown as "traditional, unproven" instead of looking as solid as a documented one.
-- `note` says why it is doubted and who claims it.
alter table relationships
  add column uncertain boolean not null default false,
  add column note text;
