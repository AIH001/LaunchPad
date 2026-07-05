-- Seed the job_sources catalog. Loaded by `supabase db reset` (see config.toml
-- [db.seed]). These rows are what the background ingest worker walks each run —
-- they replace the hardcoded GREENHOUSE_BOARDS/LEVER_BOARDS arrays that used to
-- live in the jobs edge function.
--
-- Extend coverage by adding rows here (or via the future admin/query-capture
-- flow), not by editing code. Ashby/SmartRecruiters/Workable ship with no rows
-- yet — add real, curl-verified company slugs before they surface any jobs.

-- ── ats_board: one company's public board per row ──────────────────────────────
insert into public.job_sources (kind, source, token, display_name) values
  ('ats_board', 'greenhouse', 'stripe',   'Stripe'),
  ('ats_board', 'greenhouse', 'gitlab',   'GitLab'),
  ('ats_board', 'greenhouse', 'figma',    'Figma'),
  ('ats_board', 'greenhouse', 'airbnb',   'Airbnb'),
  ('ats_board', 'greenhouse', 'dropbox',  'Dropbox'),
  ('ats_board', 'greenhouse', 'coinbase', 'Coinbase'),
  ('ats_board', 'lever',      'kraken',   'Kraken'),
  ('ats_board', 'lever',      'voleon',   'Voleon');
  -- Add Ashby/SmartRecruiters/Workable rows here once you have verified slugs:
  --   ('ats_board', 'ashby',          '<board>',     '<Company>'),
  --   ('ats_board', 'smartrecruiters','<companyId>', '<Company>'),
  --   ('ats_board', 'workable',       '<subdomain>', '<Company>'),

-- ── scrape: whole-page / whole-thread sources (no token/query) ─────────────────
insert into public.job_sources (kind, source, display_name) values
  ('scrape', 'wwr',      'We Work Remotely'),
  ('scrape', 'simplify', 'SimplifyJobs'),
  ('scrape', 'hn',       'HN Who''s Hiring');

-- ── search_query: standing early-career queries for the global search APIs ──────
-- These APIs have no "list everything" endpoint, so ingestion coverage is
-- exactly this curated set. Adzuna's free tier is rate-limited, so it gets fewer
-- queries than the keyless sources. The Muse is category-based (Software
-- Engineering firehose) and ignores the query, so it's a single null-query row.
insert into public.job_sources (kind, source, query, display_name) values
  ('search_query', 'adzuna',   'junior software engineer',      'Adzuna · junior software engineer'),
  ('search_query', 'adzuna',   'software engineer intern',      'Adzuna · software engineer intern'),
  ('search_query', 'adzuna',   'entry level developer',         'Adzuna · entry level developer'),
  ('search_query', 'remotive', 'junior developer',              'Remotive · junior developer'),
  ('search_query', 'remotive', 'software engineer',             'Remotive · software engineer'),
  ('search_query', 'remotive', 'frontend developer',            'Remotive · frontend developer'),
  ('search_query', 'jooble',   'junior software engineer',      'Jooble · junior software engineer'),
  ('search_query', 'jooble',   'software engineer intern',      'Jooble · software engineer intern'),
  ('search_query', 'themuse',  null,                            'The Muse · Software Engineering');
