-- Private bucket for resume files (not publicly readable).
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

-- Storage has its own RLS on the storage.objects table (already enabled by
-- Supabase). Same idea as our other tables: scope access to the current user.
-- Convention: files live at "{user_id}/resume.pdf", so the first path segment
-- (storage.foldername(name)[1]) must equal the caller's uid.
create policy "Own resume files - select"
  on storage.objects for select
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Own resume files - insert"
  on storage.objects for insert
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Own resume files - update"
  on storage.objects for update
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Own resume files - delete"
  on storage.objects for delete
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

-- Profiles: replace the pasted resume text with a file pointer + the structured
-- data Claude extracts from it (skills, education, experience, etc.).
alter table public.profiles drop column if exists resume_text;
alter table public.profiles add column resume_file_path text;
alter table public.profiles add column resume_parsed jsonb;
