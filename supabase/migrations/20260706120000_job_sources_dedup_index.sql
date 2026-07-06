-- Make the job_sources catalog idempotently insertable. Until now nothing stopped
-- the same (source, token) being inserted twice — fine for the 8 hand-seeded rows,
-- but the ATS-board bulk seed (next migration) and the discovery tooling
-- (scripts/mine-ats-boards.ts, scripts/theirstack-ats-boards.ts) re-run and re-emit
-- overlapping rows. A unique key lets those inserts use `on conflict do nothing`.
--
-- The key spans (source, token, query) via coalesce so it fits all three kinds:
--   ats_board    unique per (source, token)      — token set, query null
--   search_query unique per (source, query)      — query set, token null
--   scrape       unique per source               — both null → keyed on ('','')

-- Defensive: collapse any pre-existing duplicates (keeping the earliest row) so
-- the unique index can be created on an already-populated remote DB.
delete from public.job_sources a
using public.job_sources b
where a.ctid > b.ctid
  and a.source = b.source
  and coalesce(a.token, '') = coalesce(b.token, '')
  and coalesce(a.query, '') = coalesce(b.query, '');

create unique index if not exists job_sources_dedup_idx
  on public.job_sources (source, coalesce(token, ''), coalesce(query, ''));
