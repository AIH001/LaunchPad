-- Per-user hourly usage counter for the `claude` Edge Function. Claude calls
-- cost real money, so the function checks this before touching Anthropic.
--
-- Design: RLS is ON with NO policies — browsers can neither read nor write the
-- counter (if a user could write it, they could reset their own quota). The
-- only path in is consume_claude_call() below, a SECURITY DEFINER function
-- that increments and reports whether the caller is still under the limit.
create table public.claude_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (user_id, window_start)
);

alter table public.claude_usage enable row level security;

-- Explicit grants (schema auto-expose is off in config.toml): only the service
-- role may touch the table directly; authenticated users go through the RPC.
grant all on table public.claude_usage to service_role;

-- Increment the caller's counter for the current hourly window and return
-- whether they are within p_limit. Fixed-window limiting on purpose: one tiny
-- upsert per call, and the goal is bounding the Anthropic bill, not perfectly
-- smooth pacing (a user can burst up to 2x the limit across a window edge —
-- acceptable). A caller invoking this RPC directly only burns their own quota;
-- the Edge Function passes its own server-side limit, so p_limit is not a
-- bypass vector.
create or replace function public.consume_claude_call(p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_window timestamptz := date_trunc('hour', now());
  v_count integer;
begin
  if v_user is null then
    return false;
  end if;

  -- Self-cleaning: drop this user's stale windows so the table never grows
  -- beyond one live row per active user (cheap — hits the primary key).
  delete from public.claude_usage
  where user_id = v_user and window_start < v_window;

  insert into public.claude_usage (user_id, window_start, count)
  values (v_user, v_window, 1)
  on conflict (user_id, window_start)
  do update set count = public.claude_usage.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_claude_call(integer) from public;
grant execute on function public.consume_claude_call(integer) to authenticated;
