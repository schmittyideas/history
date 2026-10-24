-- 018: what kind of title a row is. Blank is a reign or an office (King of England, President of the United States);
-- 'military' is a command or rank held for a time (Eisenhower: Supreme Commander, Allied Expeditionary Force,
-- 1943-1945). The site draws military titles in iron rather than gold, counts their holders in the Military group,
-- and leaves them out of the Year view's list of who ruled where.
alter table titles
  add column kind text check (kind in ('military'));
