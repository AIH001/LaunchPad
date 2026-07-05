-- Enable pg_trgm for trigram (fuzzy / partial) matching on job titles. The jobs
-- table's primary search is Postgres full-text search (a generated tsvector +
-- GIN index); pg_trgm backs a secondary ILIKE/similarity path for partial and
-- typo-tolerant matches. Installed into the `extensions` schema per Supabase
-- convention (already on the API search_path via config.toml).
create extension if not exists pg_trgm with schema extensions;
