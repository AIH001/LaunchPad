// jobs: aggregates listings from multiple sources into ONE normalized feed,
// mirroring the events function's architecture. The browser calls this; this
// calls the third-party APIs so keys stay server-side.
//
// Design (same as events/index.ts):
//  - Each source has a mapper in ./lib.ts that converts its raw payload into
//    NormalizedJob, and a fetcher here that does the network call.
//  - Sources fan out concurrently via Promise.allSettled, each wrapped in a
//    timeout, so one source failing or hanging never blanks the feed — we
//    return whatever succeeded plus a per-source status map.
//  - Status is 'ok' | 'error' | 'skipped': skipped means the source is
//    deliberately unconfigured (missing optional key) — the UI only banners
//    errors.
//  - Results are deduped across sources (normalized title+company), then
//    interleaved round-robin so no source dominates the pre-score order.
//  - `timings` (ms per source) rides along for the benchmark script.
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  type NormalizedJob,
  type SourceInput,
  type SourceStatus,
  type JobSource,
  type AdzunaJob,
  type RemotiveJob,
  type TheMuseJob,
  type JoobleJob,
  type GreenhouseJob,
  type LeverJob,
  type AlgoliaStoryHit,
  type HnComment,
  type HnExtractedJob,
  SkippedError,
  dedupe,
  interleaveBySource,
  mapAdzuna,
  mapRemotive,
  mapTheMuse,
  mapJooble,
  mapGreenhouse,
  mapLever,
  mapHnExtracted,
  parseWwrHtml,
  pickWhoIsHiringThread,
  prefilterHnComments,
  titleMatchesQueries,
  withTimeout,
} from './lib.ts'

const SOURCE_TIMEOUT_MS = 8_000
const FEED_CAP = 30
const MAX_QUERIES = 3 // abuse guard — derive-queries sends at most 2

// ---------------------------------------------------------------------------
// Adzuna (official API; needs ADZUNA_APP_ID / ADZUNA_APP_KEY)
// ---------------------------------------------------------------------------
// Rate-limit-sensitive free tier, so it runs only the first query.

async function adzunaSource(input: SourceInput): Promise<NormalizedJob[]> {
  const appId = Deno.env.get('ADZUNA_APP_ID')
  const appKey = Deno.env.get('ADZUNA_APP_KEY')
  if (!appId || !appKey) throw new Error('Adzuna credentials are not configured')

  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: '20',
    what: input.queries[0] ?? '',
    where: input.location,
  })
  const res = await fetch(
    `https://api.adzuna.com/v1/api/jobs/${input.country}/search/1?${params}`
  )
  if (!res.ok) throw new Error(`Adzuna request failed (${res.status})`)
  const data = await res.json()
  return ((data.results ?? []) as AdzunaJob[]).map(mapAdzuna)
}

// ---------------------------------------------------------------------------
// Remotive (keyless official API — remote dev roles)
// ---------------------------------------------------------------------------
// Remotive asks integrators not to poll heavily; per-user searches are light,
// and the job_scores cache keeps repeat visits off it. Runs only the first
// query to stay polite.

async function remotiveSource(input: SourceInput): Promise<NormalizedJob[]> {
  const params = new URLSearchParams({ search: input.queries[0] ?? '', limit: '20' })
  const res = await fetch(`https://remotive.com/api/remote-jobs?${params}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Remotive request failed (${res.status})`)
  const data = await res.json()
  return ((data.jobs ?? []) as RemotiveJob[]).map(mapRemotive)
}

// ---------------------------------------------------------------------------
// The Muse (official API; THEMUSE_API_KEY optional — works keyless at a lower
// rate limit)
// ---------------------------------------------------------------------------

async function themuseSource(_input: SourceInput): Promise<NormalizedJob[]> {
  const params = new URLSearchParams({
    category: 'Software Engineering',
    page: '1',
  })
  const apiKey = Deno.env.get('THEMUSE_API_KEY')
  if (apiKey) params.set('api_key', apiKey)

  const res = await fetch(`https://www.themuse.com/api/public/jobs?${params}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`The Muse request failed (${res.status})`)
  const data = await res.json()
  return ((data.results ?? []) as TheMuseJob[]).map(mapTheMuse)
}

// ---------------------------------------------------------------------------
// Jooble (official aggregator API; JOOBLE_API_KEY required)
// ---------------------------------------------------------------------------
// Key approval takes ~a day. Until it's set, skip (not error). Rate-limit-
// sensitive, so only the first query.

async function joobleSource(input: SourceInput): Promise<NormalizedJob[]> {
  const apiKey = Deno.env.get('JOOBLE_API_KEY')
  if (!apiKey) throw new SkippedError('JOOBLE_API_KEY not configured')

  const res = await fetch(`https://jooble.org/api/${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      keywords: input.queries[0] ?? '',
      location: input.location,
    }),
  })
  if (!res.ok) throw new Error(`Jooble request failed (${res.status})`)
  const data = await res.json()
  return ((data.jobs ?? []) as JoobleJob[]).map(mapJooble)
}

// ---------------------------------------------------------------------------
// Greenhouse + Lever (keyless public company boards)
// ---------------------------------------------------------------------------
// Curated company lists — editorial, not exhaustive. Boards list every role
// (sales, HR, ops...), so we filter by title against the queries and let the
// Claude match score be the real relevance gate. Each company is fetched under
// its own allSettled so one dead board can't sink the source. Extend either
// source by adding a token to its list.

const GREENHOUSE_BOARDS = ['stripe', 'gitlab', 'figma', 'airbnb', 'dropbox', 'coinbase']
// Lever coverage is thin/volatile by public token; these are valid boards that
// may currently be empty. Add tokens here as you find active ones.
const LEVER_BOARDS = ['kraken', 'voleon']

const PER_BOARD_CAP = 10

async function greenhouseSource(input: SourceInput): Promise<NormalizedJob[]> {
  const results = await Promise.allSettled(
    GREENHOUSE_BOARDS.map(async (token) => {
      const res = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
        { headers: { accept: 'application/json' } }
      )
      if (!res.ok) throw new Error(`Greenhouse ${token} failed (${res.status})`)
      const data = await res.json()
      return ((data.jobs ?? []) as GreenhouseJob[])
        .filter((j) => titleMatchesQueries(j.title, input.queries))
        .slice(0, PER_BOARD_CAP)
        .map((j) => mapGreenhouse(j, token))
    })
  )
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

async function leverSource(input: SourceInput): Promise<NormalizedJob[]> {
  const results = await Promise.allSettled(
    LEVER_BOARDS.map(async (token) => {
      const res = await fetch(`https://api.lever.co/v0/postings/${token}?mode=json`, {
        headers: { accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`Lever ${token} failed (${res.status})`)
      const data = await res.json()
      const postings = Array.isArray(data) ? (data as LeverJob[]) : []
      return postings
        .filter((j) => titleMatchesQueries(j.text, input.queries))
        .slice(0, PER_BOARD_CAP)
        .map((j) => mapLever(j, token))
    })
  )
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

// ---------------------------------------------------------------------------
// Hacker News "Who is hiring?" (Algolia API + server-to-server Claude call)
// ---------------------------------------------------------------------------
// Slowest source (two Algolia fetches + a Claude extraction), so it gets a
// longer timeout. If it times out or fails, the feed just ships without HN.

async function hnSource(input: SourceInput): Promise<NormalizedJob[]> {
  // Needs the caller's JWT to invoke the (auth-gated) claude function. Without
  // it — e.g. an unauthenticated call — skip rather than error.
  if (!input.authHeader) throw new SkippedError('HN needs an auth token to extract')

  // 1) Find the current "Who is hiring?" thread.
  const listRes = await fetch(
    'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10',
    { headers: { accept: 'application/json' } }
  )
  if (!listRes.ok) throw new Error(`HN thread search failed (${listRes.status})`)
  const listData = await listRes.json()
  const thread = pickWhoIsHiringThread((listData.hits ?? []) as AlgoliaStoryHit[])
  if (!thread) return []

  // 2) Pull the thread's top-level comments.
  const itemRes = await fetch(`https://hn.algolia.com/api/v1/items/${thread.objectID}`, {
    headers: { accept: 'application/json' },
  })
  if (!itemRes.ok) throw new Error(`HN thread fetch failed (${itemRes.status})`)
  const itemData = await itemRes.json()
  const comments = (itemData.children ?? []) as HnComment[]
  const commentsById = new Map(comments.map((c) => [c.id, c]))

  // 3) Prefilter to relevant comments, then Claude structures them.
  const forExtraction = prefilterHnComments(comments, input.queries, input.skills)
  if (forExtraction.length === 0) return []

  // Server-to-server call to the claude function, forwarding the caller's JWT so
  // its auth gate still holds. Keeps all Claude calls centralized in that
  // function (per CLAUDE.md) at the cost of one intra-Supabase hop.
  const claudeRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/claude`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: input.authHeader,
    },
    body: JSON.stringify({ task: 'extract_jobs_from_text', comments: forExtraction }),
  })
  if (!claudeRes.ok) throw new Error(`HN extraction failed (${claudeRes.status})`)
  const claudeData = await claudeRes.json()
  return mapHnExtracted((claudeData.jobs ?? []) as HnExtractedJob[], commentsById)
}

// ---------------------------------------------------------------------------
// We Work Remotely (real HTML scraping — lowest priority, most fragile)
// ---------------------------------------------------------------------------
// Isolated as its own source: allSettled + timeout mean a markup change here
// only ever drops WWR, never the feed. See parseWwrHtml for the honest caveats.

async function wwrSource(input: SourceInput): Promise<NormalizedJob[]> {
  const res = await fetch(
    'https://weworkremotely.com/categories/remote-programming-jobs',
    {
      redirect: 'follow',
      headers: {
        accept: 'text/html',
        // WWR serves RSS to non-browser agents; a browser UA gets the HTML we
        // parse. (If this breaks, switch to the RSS feed at the same path.)
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120',
      },
    }
  )
  if (!res.ok) throw new Error(`WWR request failed (${res.status})`)
  const html = await res.text()
  return parseWwrHtml(html).filter((j) => titleMatchesQueries(j.title, input.queries))
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface Source {
  name: JobSource
  run: (i: SourceInput) => Promise<NormalizedJob[]>
  timeoutMs?: number
}

const SOURCES: Source[] = [
  // Order matters for dedupe: richer-description sources first (first-seen wins).
  { name: 'adzuna', run: adzunaSource },
  { name: 'greenhouse', run: greenhouseSource },
  { name: 'lever', run: leverSource },
  { name: 'remotive', run: remotiveSource },
  { name: 'themuse', run: themuseSource },
  { name: 'jooble', run: joobleSource },
  // HN does two Algolia fetches + a Claude call — give it more headroom.
  { name: 'hn', run: hnSource, timeoutMs: 12_000 },
  { name: 'wwr', run: wwrSource },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    // `queries` is the new multi-query input; `query` kept for back-compat.
    const rawQueries = Array.isArray(body.queries)
      ? (body.queries as string[])
      : [String(body.query ?? '')]
    const queries = rawQueries
      .map((q) => String(q).trim())
      .filter(Boolean)
      .slice(0, MAX_QUERIES)
    if (queries.length === 0) queries.push('software developer')

    const input: SourceInput = {
      queries,
      location: String(body.location ?? ''),
      country: String(body.country ?? 'us'),
      skills: Array.isArray(body.skills) ? (body.skills as string[]) : [],
      authHeader: req.headers.get('Authorization'),
    }

    // Fan out. allSettled => one source failing can't blank the feed; the
    // per-source timeout => one source hanging can't stall it either.
    const started = SOURCES.map(() => Date.now())
    const settled = await Promise.allSettled(
      SOURCES.map((s, i) => {
        started[i] = Date.now()
        return withTimeout(s.run(input), s.timeoutMs ?? SOURCE_TIMEOUT_MS, s.name)
      })
    )

    const collected: NormalizedJob[] = []
    const sources: Record<string, SourceStatus> = {}
    const timings: Record<string, number> = {}
    settled.forEach((result, i) => {
      const name = SOURCES[i].name
      timings[name] = Date.now() - started[i]
      if (result.status === 'fulfilled') {
        sources[name] = 'ok'
        collected.push(...result.value)
      } else if (result.reason instanceof SkippedError) {
        sources[name] = 'skipped'
      } else {
        sources[name] = 'error'
        console.error(`[jobs] source "${name}" failed:`, result.reason)
      }
    })

    const jobs = interleaveBySource(dedupe(collected), FEED_CAP)

    return json({ jobs, sources, timings })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
