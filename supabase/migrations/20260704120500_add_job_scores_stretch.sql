-- stretch: Claude's judgment that a role needs materially more experience than
-- the candidate has for their career stage. Surfaced as a "Stretch" badge in the
-- feed (never used to hide a listing). Cached alongside the score so a re-visit
-- doesn't re-call Claude. Nullable because rows scored before this column existed
-- (and any future score that omits it) simply have no stretch verdict.
alter table public.job_scores add column stretch boolean;
