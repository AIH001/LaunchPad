-- ingestion_runs: one row per background sync, for observability — how long the
-- run took and per-source outcomes (fetched/upserted/closed counts, status,
-- timing). Not user-facing; only the ingest worker (service role) writes it and
-- reads happen via admin/SQL. Cheap insurance for debugging a scheduled job you
-- can't watch run.
create table public.ingestion_runs (
  id          uuid        primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  -- { "<source>": { status, fetched, upserted, closed, ms } }
  per_source  jsonb,
  created_at  timestamptz not null default now()
);

-- RLS on with no policies: authenticated/anon get nothing; the service role
-- bypasses RLS. This table is intentionally not exposed to the browser.
alter table public.ingestion_runs enable row level security;

grant all on public.ingestion_runs to service_role;
