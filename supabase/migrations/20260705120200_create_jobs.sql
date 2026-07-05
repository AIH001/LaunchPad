-- jobs: our own normalized store of job listings, populated by the background
-- ingest worker. The user-facing search reads THIS table instead of fanning out
-- to ~11 live source APIs per request. This is what unlocks fast search,
-- freshness/lifecycle tracking, and (later) alerts.
--
-- Global table, same access model as job_sources: authenticated read, service-
-- role write only.
create table public.jobs (
  id              uuid        primary key default gen_random_uuid(),
  -- source + external_job_id together identify one posting from one source. The
  -- unique index on the pair is the upsert conflict target (per-source dedup).
  source          text        not null,
  external_job_id text        not null,
  -- external_id reconstructs the `${source}:${externalId}` id the rest of the
  -- app keys on (job_scores.job_id PK, saved_jobs' job_payload->>'id' unique
  -- index). Generated so it can never drift from source/external_job_id.
  external_id     text        generated always as (source || ':' || external_job_id) stored,
  title           text        not null,
  company         text        not null,
  location        text,
  description     text,
  url             text        not null,
  salary_min      integer,
  salary_max      integer,
  -- Kept as text (ISO 8601 or '') to mirror NormalizedJob.created — sources vary
  -- and some give nothing; we don't invent a date.
  posted_at       text,
  -- Heuristic set at ingest (title/description keywords). Stored as a signal for
  -- ranking/filtering; the Claude per-user match score is still the real gate.
  is_early_career boolean     not null default false,
  -- Generated helpers. lower(title) for trigram matching; content_hash to detect
  -- when a re-ingested posting actually changed; search_tsv for full-text search.
  -- All three use IMMUTABLE expressions (required for generated columns) — note
  -- the two-arg to_tsvector with an explicit 'english' config is immutable.
  normalized_title text       generated always as (lower(title)) stored,
  content_hash    text        generated always as (
                    md5(coalesce(title, '') || '|' || coalesce(company, '') || '|' ||
                        coalesce(location, '') || '|' || coalesce(description, ''))
                  ) stored,
  search_tsv      tsvector    generated always as (
                    to_tsvector('english',
                      coalesce(title, '') || ' ' || coalesce(company, '') || ' ' ||
                      coalesce(description, ''))
                  ) stored,
  -- Lifecycle: first_seen_at is set once; last_seen_at bumps every time the
  -- posting is re-confirmed by a sync; a posting missing from a source's sync is
  -- flipped is_active=false with closed_at set (so search hides it but history
  -- is kept).
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  closed_at       timestamptz,
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index jobs_source_external_unique on public.jobs (source, external_job_id);
create index jobs_search_tsv_idx on public.jobs using gin (search_tsv);
create index jobs_norm_title_trgm_idx on public.jobs using gin (normalized_title extensions.gin_trgm_ops);
create index jobs_active_last_seen_idx on public.jobs (last_seen_at desc) where is_active;

-- RLS: global read for signed-in users, writes only via the service role. No
-- insert/update/delete policies by design (keeps the browser read-only).
alter table public.jobs enable row level security;

create policy "Signed-in users can read jobs"
  on public.jobs
  for select
  to authenticated
  using (true);

grant select on public.jobs to authenticated;
grant all on public.jobs to service_role;

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row
  execute function public.set_updated_at();
