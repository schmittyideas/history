-- 022: a one-off data fix, approved by Ty on 2026-10-25 as an exception to "never delete data".
-- Henrietta Maria was Charles I's queen consort, not a ruler, but had been given three reign titles
-- (Queen of England, Scotland and Ireland, 1625-1649). They put her in the line of monarchs, so the
-- person panel's Succession showed her beside Charles I. She stays as a person and as his spouse.
with gone as (
  delete from titles
  where key in ('henrietta-maria--queen-of-england--1625', 'henrietta-maria--queen-of-scotland--1625', 'henrietta-maria--queen-of-ireland--1625')
  returning key)
delete from source_links where record_type = 'title' and record_key in (select key from gone);
-- inbox/2026-10-10-painter-patrons.yaml still lists the three titles. It is left unedited on purpose: changing
-- it would make the apply workflow re-send the whole file and undo later updates to its people. Don't re-send it.
