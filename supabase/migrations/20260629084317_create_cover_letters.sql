-- cover_letters: tailored letters the user drafts for a role.
-- We snapshot job_title + company rather than FK to saved_jobs, so a letter is
-- standalone — it survives even if the job was never saved or the listing is gone.
create table public.cover_letters (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  job_title  text        not null,
  company    text        not null,
  body       text        not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cover_letters enable row level security;

create policy "Users can view own cover letters"
  on public.cover_letters for select
  using (auth.uid() = user_id);

create policy "Users can insert own cover letters"
  on public.cover_letters for insert
  with check (auth.uid() = user_id);

create policy "Users can update own cover letters"
  on public.cover_letters for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own cover letters"
  on public.cover_letters for delete
  using (auth.uid() = user_id);

-- Reuse the set_updated_at() function created in the profiles migration.
create trigger cover_letters_set_updated_at
  before update on public.cover_letters
  for each row
  execute function public.set_updated_at();
