-- target_role: the role the user is hunting for. Drives the proactive job feed
-- query (mixed with skills/resume-derived terms in derive-queries.ts). Nullable
-- because the feed falls back to skills when it's unset.
alter table public.profiles add column target_role text;
