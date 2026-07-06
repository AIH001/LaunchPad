-- ai_cache: one row per user per AI-generated view whose output is expensive to
-- rebuild (a Sonnet game plan, the Claude-scored events feed, the curated
-- digest). Without this, every login and every browser refresh re-runs those
-- Claude calls from scratch — re-billed each time. The frontend hydrates a view
-- from its cached `payload` instantly on mount and only re-generates when the
-- user explicitly asks (a Regenerate/Refresh button).
--
-- `kind` namespaces the three views into one table so they share a single policy
-- set and helper instead of three near-identical tables. `payload` is the whole
-- ready-to-render shape for that view (plan object, scored-events array, or
-- digest stories+items) — deliberately schema-less here because each view owns
-- its own TypeScript type on the client.
--
-- No TTL: entries persist until the user refreshes that view (manual-refresh
-- model). Payloads are profile-relative, so they can go stale if the profile
-- changes without a refresh — a flagged tradeoff, surfaced as an "updated <time
-- ago>" caption in the UI so cached data is never passed off as live.
create table public.ai_cache (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  kind         text        not null check (kind in ('game_plan', 'events', 'digest')),
  payload      jsonb       not null,
  generated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

-- RLS: deny-by-default, then allow each user to touch only their own rows.
alter table public.ai_cache enable row level security;

create policy "Users can view own ai cache"
  on public.ai_cache
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own ai cache"
  on public.ai_cache
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own ai cache"
  on public.ai_cache
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own ai cache"
  on public.ai_cache
  for delete
  using (auth.uid() = user_id);
