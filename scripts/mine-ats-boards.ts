// Free-miner: DISCOVER ATS boards from data we already ingest, at zero cost.
//
// The SimplifyJobs new-grad/internship READMEs list each role with a direct
// "Apply" link — which is usually the company's own ATS posting URL
// (boards.greenhouse.io/…, jobs.lever.co/…, jobs.ashbyhq.com/…, etc.). We reuse
// the SAME parser the ingest worker uses (parseSimplifyReadme), run every apply
// URL through extractAtsBoard, dedupe by (source, token), and print reviewable
// SQL for a job_sources seed migration.
//
// This is a one-time/occasional catalog-build step — NOT part of the recurring
// ingest. Run:  npm run mine:ats > /tmp/ats-boards.sql   (then review + commit)
//
// Node/tsx script (like scripts/benchmark-jobs.ts). It imports the pure function
// modules directly — parseSimplifyReadme and ats-slug have no Deno/npm deps.
import { parseSimplifyReadme } from '../supabase/functions/jobs/lib.ts'
import { extractAtsBoard, type AtsSource } from '../supabase/functions/jobs/ats-slug.ts'

// SimplifyJobs maintains these two public README tables. Both use the same row
// format parseSimplifyReadme already understands.
const README_URLS = [
  'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md',
  'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md',
]

interface Board {
  source: AtsSource
  token: string
  company: string
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { accept: 'text/plain' } })
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`)
  return res.text()
}

// Double single quotes for safe SQL string literals.
const sqlStr = (s: string): string => `'${s.replace(/'/g, "''")}'`

// Simplify prefixes hot/new roles with a 🔥 emoji; strip leading non-alphanumeric
// noise so display_name reads cleanly ("🔥 Palantir" → "Palantir").
const cleanCompany = (s: string): string => s.replace(/^[^\p{L}\p{N}]+/u, '').trim()

async function main(): Promise<void> {
  const byKey = new Map<string, Board>() // `${source}:${token}` → first-seen board

  for (const url of README_URLS) {
    let markdown: string
    try {
      markdown = await fetchText(url)
    } catch (e) {
      console.error(`! skipping ${url}: ${(e as Error).message}`)
      continue
    }
    for (const job of parseSimplifyReadme(markdown)) {
      const board = extractAtsBoard(job.url)
      if (!board) continue
      const key = `${board.source}:${board.token}`
      if (!byKey.has(key)) {
        byKey.set(key, { ...board, company: cleanCompany(job.company) || board.token })
      }
    }
  }

  const boards = [...byKey.values()].sort((a, b) =>
    a.source === b.source ? a.token.localeCompare(b.token) : a.source.localeCompare(b.source)
  )

  // Per-source summary → stderr, so stdout stays clean pipeable SQL.
  const counts: Record<string, number> = {}
  for (const b of boards) counts[b.source] = (counts[b.source] ?? 0) + 1
  console.error(`Discovered ${boards.length} unique ATS boards:`)
  for (const [source, n] of Object.entries(counts).sort()) console.error(`  ${source.padEnd(16)} ${n}`)

  if (boards.length === 0) {
    console.error('No boards discovered — the README format may have changed.')
    return
  }

  // SQL → stdout. `on conflict do nothing` makes re-applying idempotent against
  // the job_sources_dedup unique index (and skips rows already seeded by hand).
  const values = boards
    .map((b) => `  ('ats_board', ${sqlStr(b.source)}, ${sqlStr(b.token)}, ${sqlStr(b.company)})`)
    .join(',\n')
  console.log('-- Mined from SimplifyJobs READMEs via scripts/mine-ats-boards.ts')
  console.log('insert into public.job_sources (kind, source, token, display_name) values')
  console.log(values)
  console.log('on conflict do nothing;')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
