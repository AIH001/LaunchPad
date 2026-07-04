-- job_scores: cached Claude match scores. The job feed auto-loads on every
-- visit and scores up to 15 jobs per load (one Haiku call each), so without a
-- cache the same job gets re-scored — and re-billed — every time the user opens
-- the page. This table lets the frontend apply a known score instantly and only
-- call Claude for jobs it hasn't scored yet.
--
-- Scores are profile-relative (they depend on the user's skills/resume), so
-- they're keyed per user and invalidated when the profile changes (the frontend
-- deletes the user's rows on profile save). No TTL: listings churn fast enough
-- that stale scores age out naturally. (Flagged tradeoff.)
create table public.job_scores (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  job_id     text        not null, -- normalized `${source}:${externalId}`
  score      integer     not null,
  why_fit    text,
  gaps       text,
  created_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

-- RLS: deny-by-default, then allow each user to touch only their own rows.
alter table public.job_scores enable row level security;

create policy "Users can view own job scores"
  on public.job_scores
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own job scores"
  on public.job_scores
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own job scores"
  on public.job_scores
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own job scores"
  on public.job_scores
  for delete
  using (auth.uid() = user_id);
