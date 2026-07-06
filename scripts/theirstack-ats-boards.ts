// TheirStack extractor: DISCOVER ATS boards at scale from TheirStack's Jobs API.
//
// Companion to scripts/mine-ats-boards.ts (which is free but limited to the
// SimplifyJobs lists). TheirStack aggregates postings from 348k+ sources; we ask
// it for recent jobs whose posting URL is on a supported ATS domain, pull the
// (source, token) out of each posting's `final_url`, dedupe, and print the same
// reviewable job_sources SQL.
//
// This is a PAID, one-time/occasional catalog-build step. It is NOT wired into
// the recurring ingest worker — the worker keeps fetching the free public boards.
// So THEIRSTACK_API_KEY lives only in your local env here, never as an edge
// secret. Cost: 1 API credit per job returned (free tier = 200/mo).
//
// Run:  THEIRSTACK_API_KEY=... npm run theirstack:ats > /tmp/ats-boards.sql
//   env knobs: THEIRSTACK_LIMIT (per page, default 100), THEIRSTACK_PAGES
//   (default 1), THEIRSTACK_MAX_AGE_DAYS (default 30).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractAtsBoard, type AtsSource } from '../supabase/functions/jobs/ats-slug.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ATS_DOMAINS = ['greenhouse.io', 'lever.co', 'ashbyhq.com', 'smartrecruiters.com', 'workable.com']

// Minimal .env loader (mirrors scripts/benchmark-jobs.ts — no dotenv dependency).
function loadEnv(): void {
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    // no .env — rely on the ambient environment
  }
}
loadEnv()

interface TheirStackJob {
  final_url?: string | null
  url?: string | null
  source_url?: string | null
  company?: string | null
  company_object?: { name?: string | null } | null
}

const sqlStr = (s: string): string => `'${s.replace(/'/g, "''")}'`

async function fetchPage(apiKey: string, page: number, limit: number, maxAgeDays: number): Promise<TheirStackJob[]> {
  const res = await fetch('https://api.theirstack.com/v1/jobs/search', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      page,
      limit,
      url_domain_or: ATS_DOMAINS,
      posted_at_max_age_days: maxAgeDays, // satisfies the API's "at least one date filter" rule
      job_country_code_or: ['US'],
    }),
  })
  if (!res.ok) {
    throw new Error(`TheirStack ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const body = await res.json()
  return (body.data ?? []) as TheirStackJob[]
}

async function main(): Promise<void> {
  const apiKey = process.env.THEIRSTACK_API_KEY
  if (!apiKey) {
    console.error(
      'THEIRSTACK_API_KEY not set. Add it to .env or pass it inline. This script is\n' +
        'optional — scripts/mine-ats-boards.ts already discovers boards for free.'
    )
    process.exit(1)
  }
  const limit = Number(process.env.THEIRSTACK_LIMIT ?? 100)
  const pages = Number(process.env.THEIRSTACK_PAGES ?? 1)
  const maxAgeDays = Number(process.env.THEIRSTACK_MAX_AGE_DAYS ?? 30)

  const byKey = new Map<string, { source: AtsSource; token: string; company: string }>()
  let seen = 0
  for (let page = 0; page < pages; page++) {
    const jobs = await fetchPage(apiKey, page, limit, maxAgeDays)
    seen += jobs.length
    for (const j of jobs) {
      const board = extractAtsBoard(j.final_url ?? j.url ?? j.source_url ?? '')
      if (!board) continue
      const key = `${board.source}:${board.token}`
      if (!byKey.has(key)) {
        const company = (j.company ?? j.company_object?.name ?? board.token).trim()
        byKey.set(key, { ...board, company })
      }
    }
    if (jobs.length < limit) break // last page
  }

  const boards = [...byKey.values()].sort((a, b) =>
    a.source === b.source ? a.token.localeCompare(b.token) : a.source.localeCompare(b.source)
  )

  const counts: Record<string, number> = {}
  for (const b of boards) counts[b.source] = (counts[b.source] ?? 0) + 1
  console.error(`Scanned ${seen} postings → ${boards.length} unique ATS boards (cost ≈ ${seen} credits):`)
  for (const [source, n] of Object.entries(counts).sort()) console.error(`  ${source.padEnd(16)} ${n}`)
  if (boards.length === 0) return

  const values = boards
    .map((b) => `  ('ats_board', ${sqlStr(b.source)}, ${sqlStr(b.token)}, ${sqlStr(b.company)})`)
    .join(',\n')
  console.log('-- Discovered from TheirStack Jobs API via scripts/theirstack-ats-boards.ts')
  console.log('insert into public.job_sources (kind, source, token, display_name) values')
  console.log(values)
  console.log('on conflict do nothing;')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
