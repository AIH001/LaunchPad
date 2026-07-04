-- career_stage: where the user is in their early-career journey (student /
-- internship / new_grad / junior / career_switcher). Drives early-career-aware
-- job scoring, stage-qualified feed queries, and the Game Plan coaching screen.
--
-- Nullable on purpose: this is an OPTIONAL field. When unset, the app infers a
-- stage from the parsed resume (years_experience + education) via
-- resolveCareerStage() so the user is never forced into an extra setup step.
-- Stored as free text; the app validates it against the allowed set.
alter table public.profiles add column career_stage text;
