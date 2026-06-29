-- saved_jobs: jobs a user has saved, with the Claude match score snapshotted.
-- Unlike profiles (one row per user, id = the user's id), this is MANY rows per
-- user, so it has its own primary key plus a separate user_id foreign key.
create table public.saved_jobs (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users (id) on delete cascade,
  -- The full job object is stored as jsonb: it's external data (Adzuna's shape,
  -- not ours) and the listing is ephemeral, so we snapshot exactly what the user
  -- saw at save time rather than re-fetching it later.
  job_payload    jsonb       not null,
  -- match_score / match_reasoning are pulled out of the payload into real columns
  -- so we can sort and display without digging into the jsonb each time.
  match_score    integer,
  match_reasoning text,
  created_at     timestamptz not null default now()
);

-- Stop the same job being saved twice by the same user. This is a functional
-- unique index on (user_id, the "id" field inside the jsonb payload) — the DB
-- enforces "no duplicate saves" so the app doesn't have to.
create unique index saved_jobs_user_job_unique
  on public.saved_jobs (user_id, (job_payload ->> 'id'));

-- RLS: deny-by-default, then allow each user to touch only their own rows.
alter table public.saved_jobs enable row level security;

create policy "Users can view own saved jobs"
  on public.saved_jobs
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own saved jobs"
  on public.saved_jobs
  for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own saved jobs"
  on public.saved_jobs
  for delete
  using (auth.uid() = user_id);
