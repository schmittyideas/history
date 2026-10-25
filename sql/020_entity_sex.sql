-- 020: a person's sex, so person panels can list a ruler's children as Sons and Daughters.
-- Blank until a batch records it; panels list those children as plain Children.
alter table entities
  add column sex text check (sex in ('male', 'female'));
