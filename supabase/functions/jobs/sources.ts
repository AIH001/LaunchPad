// Per-source network fetchers for the background ingest worker. Extracted from
// the old live jobs/index.ts: there, each fetcher looped over a hardcoded array
// of company tokens; here each fetcher does ONE unit of work (one board, one
// standing query, one scrape) so the ingest worker can drive them row-by-row
// from the job_sources catalog table.
//
// All mapping/parsing still lives in ./lib.ts (pure + unit-tested). These
// functions only do I/O and return NormalizedJob[] with NO relevance filtering —
// the ingest worker applies its own tech/early-career filter (isTechRole /
// isEarlyCareer) since there's no per-user query at ingest time.
import {
  type NormalizedJob,
  type JobSource,
  type AdzunaJob,
  type RemotiveJob,
  type TheMuseJob,
  type JoobleJob,
  type GreenhouseJob,
  type LeverJob,
  type AshbyJob,
  type SmartRecruitersJob,
  type WorkableJob,
  SkippedError,
  mapAdzuna,
  mapRemotive,
  mapTheMuse,
  mapJooble,
  mapGreenhouse,
  mapLever,
  mapAshby,
  mapSmartRecruiters,
  mapWorkable,
  parseWwrHtml,
  parseSimplifyReadme,
} from './lib.ts'

// One row of the job_sources catalog, as the worker hands it in.
export interface SourceRow {
  kind: 'ats_board' | 'search_query' | 'scrape'
  source: JobSource
  token: string | null // board slug / account subdomain (ats_board)
  query: string | null // standing query (search_query)
}

// Ambient config a fetch may need (Adzuna country, etc.).
export interface FetchContext {
  country: string
}

// --- Global search APIs (one standing query each) --------------------------------

async function fetchAdzuna(query: string, ctx: FetchContext): Promise<NormalizedJob[]> {
  const appId = Deno.env.get('ADZUNA_APP_ID')
  const appKey = Deno.env.get('ADZUNA_APP_KEY')
  // Missing optional creds → skip (not error): the source is deliberately
  // unconfigured, so the worker records 'skipped' and no failure banner shows.
  if (!appId || !appKey) throw new SkippedError('ADZUNA credentials not configured')

  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: '20',
    what: query,
  })
  const res = await fetch(`https://api.adzuna.com/v1/api/jobs/${ctx.country}/search/1?${params}`)
  if (!res.ok) throw new Error(`Adzuna request failed (${res.status})`)
  const data = await res.json()
  return ((data.results ?? []) as AdzunaJob[]).map(mapAdzuna)
}

async function fetchRemotive(query: string): Promise<NormalizedJob[]> {
  const params = new URLSearchParams({ search: query, limit: '20' })
  const res = await fetch(`https://remotive.com/api/remote-jobs?${params}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Remotive request failed (${res.status})`)
  const data = await res.json()
  return ((data.jobs ?? []) as RemotiveJob[]).map(mapRemotive)
}

// The Muse has no free-text search — it's a category firehose, so the standing
// query is ignored (the seed row carries a null query).
async function fetchTheMuse(): Promise<NormalizedJob[]> {
  const params = new URLSearchParams({ category: 'Software Engineering', page: '1' })
  const apiKey = Deno.env.get('THEMUSE_API_KEY')
  if (apiKey) params.set('api_key', apiKey)
  const res = await fetch(`https://www.themuse.com/api/public/jobs?${params}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`The Muse request failed (${res.status})`)
  const data = await res.json()
  return ((data.results ?? []) as TheMuseJob[]).map(mapTheMuse)
}

async function fetchJooble(query: string): Promise<NormalizedJob[]> {
  const apiKey = Deno.env.get('JOOBLE_API_KEY')
  if (!apiKey) throw new SkippedError('JOOBLE_API_KEY not configured')
  const res = await fetch(`https://jooble.org/api/${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keywords: query }),
  })
  if (!res.ok) throw new Error(`Jooble request failed (${res.status})`)
  const data = await res.json()
  return ((data.jobs ?? []) as JoobleJob[]).map(mapJooble)
}

// --- Per-company ATS boards (one board each) -------------------------------------

async function fetchGreenhouseBoard(token: string): Promise<NormalizedJob[]> {
  const res = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
    { headers: { accept: 'application/json' } }
  )
  if (!res.ok) throw new Error(`Greenhouse ${token} failed (${res.status})`)
  const data = await res.json()
  return ((data.jobs ?? []) as GreenhouseJob[]).map((j) => mapGreenhouse(j, token))
}

async function fetchLeverBoard(token: string): Promise<NormalizedJob[]> {
  const res = await fetch(`https://api.lever.co/v0/postings/${token}?mode=json`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Lever ${token} failed (${res.status})`)
  const data = await res.json()
  const postings = Array.isArray(data) ? (data as LeverJob[]) : []
  return postings.map((j) => mapLever(j, token))
}

async function fetchAshbyBoard(token: string): Promise<NormalizedJob[]> {
  const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${token}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Ashby ${token} failed (${res.status})`)
  const data = await res.json()
  return ((data.jobs ?? []) as AshbyJob[]).map((j) => mapAshby(j, token))
}

async function fetchSmartRecruitersCompany(token: string): Promise<NormalizedJob[]> {
  const res = await fetch(
    `https://api.smartrecruiters.com/v1/companies/${token}/postings`,
    { headers: { accept: 'application/json' } }
  )
  if (!res.ok) throw new Error(`SmartRecruiters ${token} failed (${res.status})`)
  const data = await res.json()
  return ((data.content ?? []) as SmartRecruitersJob[]).map((j) => mapSmartRecruiters(j, token))
}

async function fetchWorkableAccount(token: string): Promise<NormalizedJob[]> {
  const res = await fetch(`https://apply.workable.com/api/v1/widget/accounts/${token}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Workable ${token} failed (${res.status})`)
  const data = await res.json()
  return ((data.jobs ?? []) as WorkableJob[]).map((j) => mapWorkable(j, token))
}

// --- Scrapes (whole page / thread) -----------------------------------------------

async function fetchWwr(): Promise<NormalizedJob[]> {
  const res = await fetch('https://weworkremotely.com/categories/remote-programming-jobs', {
    redirect: 'follow',
    headers: {
      accept: 'text/html',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120',
    },
  })
  if (!res.ok) throw new Error(`WWR request failed (${res.status})`)
  return parseWwrHtml(await res.text())
}

async function fetchSimplify(): Promise<NormalizedJob[]> {
  const res = await fetch(
    'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md',
    { headers: { accept: 'text/plain' } }
  )
  if (!res.ok) throw new Error(`Simplify README fetch failed (${res.status})`)
  return parseSimplifyReadme(await res.text())
}

// --- Dispatcher ------------------------------------------------------------------

// Fetch the listings for one job_sources row. Throws Error on failure (recorded
// as 'error') or SkippedError when deliberately unconfigured/deferred (recorded
// as 'skipped'). Returns raw mapped jobs; relevance filtering is the worker's job.
export function fetchSourceRow(row: SourceRow, ctx: FetchContext): Promise<NormalizedJob[]> {
  switch (row.source) {
    case 'adzuna':
      return fetchAdzuna(row.query ?? '', ctx)
    case 'remotive':
      return fetchRemotive(row.query ?? '')
    case 'themuse':
      return fetchTheMuse()
    case 'jooble':
      return fetchJooble(row.query ?? '')
    case 'greenhouse':
      return fetchGreenhouseBoard(row.token ?? '')
    case 'lever':
      return fetchLeverBoard(row.token ?? '')
    case 'ashby':
      return fetchAshbyBoard(row.token ?? '')
    case 'smartrecruiters':
      return fetchSmartRecruitersCompany(row.token ?? '')
    case 'workable':
      return fetchWorkableAccount(row.token ?? '')
    case 'wwr':
      return fetchWwr()
    case 'simplify':
      return fetchSimplify()
    case 'hn':
      // HN "Who is hiring?" needs a Claude call to structure freeform comments,
      // and that call is auth-gated to a real user — which the service-role
      // ingest worker isn't. Deferred: wire it in via a service-to-service
      // bypass on the claude function (or inline extraction) in a follow-up.
      return Promise.reject(new SkippedError('HN ingestion deferred (needs auth-gated Claude extraction)'))
    default:
      return Promise.reject(new SkippedError(`Unknown source: ${row.source}`))
  }
}
