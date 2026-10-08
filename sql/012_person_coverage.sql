-- 012: how far a person's record has been built out, so "which artists still need their works captured?" is a query.
-- null = not yet assessed. not-read: named but the article was not read; partly: read, only what the batch needed was
-- captured (coverage_note says what and what is missing); complete: the article and its list of works were worked through.
alter table entities add column coverage text check (coverage in ('not-read', 'partly', 'complete')), add column coverage_note text;
