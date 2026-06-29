-- profiles: one row per user, holding their career profile.
-- The id is BOTH the primary key AND a foreign key to auth.users — so each
-- profile shares the UUID of its auth user (one user <-> one profile).
-- on delete cascade: deleting the auth user removes their profile too.
create table public.profiles (
  id          uuid        primary key references auth.users (id) on delete cascade,
  resume_text text,
  skills      text[]      not null default '{}',
  interests   text[]      not null default '{}',
  location    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Turn on Row Level Security. IMPORTANT: once enabled, ALL access is denied
-- by default until a policy explicitly allows it. RLS is what actually keeps
-- one user from reading another user's data — enforced inside Postgres.
alter table public.profiles enable row level security;

-- auth.uid() returns the id of the currently authenticated user (from their JWT).
-- Each policy below restricts the row(s) a user can touch to their own.

-- SELECT: you can read only your own profile.
create policy "Users can view own profile"
  on public.profiles
  for select
  using (auth.uid() = id);

-- INSERT: you can create a profile only with your own id.
-- (with check validates the NEW row being written.)
create policy "Users can insert own profile"
  on public.profiles
  for insert
  with check (auth.uid() = id);

-- UPDATE: you can change only your own profile.
-- using  = which existing rows you may target;
-- with check = what the row is allowed to look like afterwards.
create policy "Users can update own profile"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Keep updated_at fresh automatically on every UPDATE, so the app never has
-- to remember to set it. This is a trigger calling a small function.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();
