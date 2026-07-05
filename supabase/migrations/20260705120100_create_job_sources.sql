-- job_sources: the catalog of WHERE we ingest jobs from. This replaces the
-- hardcoded GREENHOUSE_BOARDS/LEVER_BOARDS arrays that used to live in the jobs
-- edge function — each becomes a row here, so coverage can grow (and standing
-- search queries can be added) without a code deploy.
--
-- This is the app's FIRST global (non-user-owned) table. Unlike profiles/
-- saved_jobs/etc. (which are scoped to auth.uid()), job_sources and jobs are
-- shared reference data: every authenticated user reads the same rows, and only
-- the background ingest worker (service role) writes them.
--
-- Three kinds of source:
--   ats_board    — a single company's public board (Greenhouse/Lever/Ashby/
--                  SmartRecruiters/Workable). `token` is the board slug.
--   search_query — a global search API (Adzuna/Remotive/Jooble/The Muse) run
--                  against a standing early-career `query`. These APIs have no
--                  "list everything" endpoint, so ingestion is only as broad as
--                  this curated query set (a documented knob).
--   scrape       — an HTML/README source (We Work Remotely, SimplifyJobs, HN
--                  "Who is hiring?"). No token/query — the whole page/thread.
create table public.job_sources (
  id             uuid        primary key default gen_random_uuid(),
  kind           text        not null check (kind in ('ats_board', 'search_query', 'scrape')),
  source         text        not null, -- the JobSource name, e.g. 'greenhouse'
  token          text,                 -- board slug / account subdomain (ats_board)
  query          text,                 -- standing query (search_query)
  display_name   text        not null,
  is_active      boolean     not null default true,
  -- Sync health, updated by the ingest worker each run. The jobs search endpoint
  -- reads these to rebuild the per-source status map the UI's degraded banner
  -- expects — so "degraded" now means "this source's last sync failed / is stale."
  last_synced_at timestamptz,
  last_status    text        check (last_status in ('ok', 'error', 'skipped')),
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index job_sources_active_idx on public.job_sources (is_active) where is_active;

-- RLS: global read for any signed-in user, writes only via the service role
-- (which bypasses RLS). There are deliberately NO insert/update/delete policies —
-- that's what keeps the browser (anon/authenticated) read-only on this table.
alter table public.job_sources enable row level security;

create policy "Signed-in users can read job sources"
  on public.job_sources
  for select
  to authenticated
  using (true);

-- config.toml does not auto-expose new tables to the Data API roles, so grant
-- explicitly: read for authenticated (the browser/edge fns), all for the ingest
-- worker's service role.
grant select on public.job_sources to authenticated;
grant all on public.job_sources to service_role;

-- Reuse the shared updated_at trigger fn defined in the profiles migration.
create trigger job_sources_set_updated_at
  before update on public.job_sources
  for each row
  execute function public.set_updated_at();
