// jobs: the user-facing job feed. Since the database-first migration this READS
// our own public.jobs table (populated by the ingest-jobs worker on a schedule)
// instead of fanning out to ~11 live source APIs per request. That makes search
// fast and reliable, and means a slow/broken upstream source degrades a
// background sync — not the user's search.
//
// Contract is unchanged so the frontend (useJobs.ts) didn't have to change:
//   request  { queries: string[], location: string, skills: string[] }
//   response { jobs: Job[], sources: Record<name, 'ok'|'error'|'skipped'>, timings }
// `sources` now reflects each source's last SYNC health (from job_sources), so
// the UI's degraded banner means "this source's last sync failed" rather than
// "this source failed to fetch just now."
import { createClient } from 'npm:@supabase/supabase-js'
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  type NormalizedJob,
  type SourceStatus,
  dedupe,
  interleaveBySource,
  toWebsearchQuery,
} from './lib.ts'

const FEED_CAP = 30
const MAX_QUERIES = 3 // abuse guard — derive-queries sends at most 2
const DB_FETCH_LIMIT = 120 // pull a wider set, then dedupe/interleave down to FEED_CAP

// A row as selected from public.jobs (snake_case), before mapping to the Job
// shape the frontend expects.
interface JobRecord {
  external_id: string
  source: string
  title: string
  company: string
  location: string | null
  description: string | null
  url: string
  salary_min: number | null
  salary_max: number | null
  posted_at: string | null
}

function toNormalized(r: JobRecord): NormalizedJob {
  return {
    id: r.external_id, // `${source}:${externalId}` — the id job_scores/saved_jobs key on
    source: r.source as NormalizedJob['source'],
    title: r.title,
    company: r.company,
    location: r.location ?? '',
    description: r.description ?? '',
    url: r.url,
    salaryMin: r.salary_min,
    salaryMax: r.salary_max,
    created: r.posted_at ?? '',
  }
}

// Aggregate job_sources sync health into the per-source-NAME status map the
// frontend expects. A source can have many catalog rows (e.g. six Greenhouse
// boards): if any errored on its last sync it's 'error'; if it has only ever
// skipped/never-synced it's 'skipped'; otherwise 'ok'.
function buildSourceStatus(
  rows: Array<{ source: string; last_status: string | null }>
): Record<string, SourceStatus> {
  const out: Record<string, SourceStatus> = {}
  const seenOk = new Set<string>()
  for (const r of rows) {
    const cur = out[r.source]
    if (r.last_status === 'error') out[r.source] = 'error'
    else if (r.last_status === 'ok') {
      seenOk.add(r.source)
      if (cur !== 'error') out[r.source] = 'ok'
    } else if (cur === undefined) out[r.source] = 'skipped'
  }
  // A later 'ok' shouldn't override an 'error' seen for the same source.
  for (const s of seenOk) if (out[s] !== 'error') out[s] = 'ok'
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    // `queries` is the multi-query input; `query` kept for back-compat.
    const rawQueries = Array.isArray(body.queries)
      ? (body.queries as string[])
      : [String(body.query ?? '')]
    const queries = rawQueries
      .map((q) => String(q).trim())
      .filter(Boolean)
      .slice(0, MAX_QUERIES)
    const location = String(body.location ?? '').trim()

    // Read the jobs table under the caller's JWT (RLS allows authenticated read).
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const started = Date.now()

    let q = supabase
      .from('jobs')
      .select(
        'external_id, source, title, company, location, description, url, salary_min, salary_max, posted_at'
      )
      .eq('is_active', true)

    // Full-text filter from the derived queries; if there are no usable terms we
    // skip it and just return recent early-career jobs.
    const websearch = toWebsearchQuery(queries)
    if (websearch) {
      q = q.textSearch('search_tsv', websearch, { type: 'websearch', config: 'english' })
    }
    if (location) q = q.ilike('location', `%${location}%`)

    // Prefer early-career, then most-recently-confirmed. Over-fetch, then dedupe/
    // interleave down so no single source dominates the pre-score order.
    q = q.order('is_early_career', { ascending: false }).order('last_seen_at', {
      ascending: false,
    })
    q = q.limit(DB_FETCH_LIMIT)

    const { data, error } = await q
    if (error) throw new Error(`jobs query failed: ${error.message}`)

    const normalized = ((data ?? []) as JobRecord[]).map(toNormalized)
    const jobs = interleaveBySource(dedupe(normalized), FEED_CAP)

    // Per-source sync health for the degraded banner (separate, cheap read).
    const { data: srcRows } = await supabase
      .from('job_sources')
      .select('source, last_status')
    const sources = buildSourceStatus(
      (srcRows ?? []) as Array<{ source: string; last_status: string | null }>
    )

    return json({ jobs, sources, timings: { db: Date.now() - started } })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
