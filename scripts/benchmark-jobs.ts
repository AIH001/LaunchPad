// Benchmark the job feed: end-to-end aggregation latency (with per-source
// timings) and per-call Claude scoring latency. Records a dated JSON result so
// we can compare against benchmarks/baseline.json after future changes.
//
// Run:  npm run bench
//
// Requires a .env with the public Supabase values plus a REAL test account
// (the claude function is auth-gated — never use a service-role key here):
//   VITE_SUPABASE_URL=...
//   VITE_SUPABASE_ANON_KEY=...
//   BENCH_EMAIL=you@example.com
//   BENCH_PASSWORD=...
//
// Baseline update policy: `benchmarks/baseline.json` is committed and should be
// overwritten only DELIBERATELY, after a change you expect to move the numbers —
// not on every run. Regular runs land in benchmarks/results/ (gitignored).
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Minimal .env loader (avoid a dotenv dependency for a dev-only script).
function loadEnv() {
  try {
    const raw = readFileSync(join(ROOT, '.env'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    // no .env — rely on the ambient environment
  }
}
loadEnv()

const URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const EMAIL = process.env.BENCH_EMAIL
const PASSWORD = process.env.BENCH_PASSWORD

if (!URL || !ANON || !EMAIL || !PASSWORD) {
  console.error(
    'Missing env. Need VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, BENCH_EMAIL, BENCH_PASSWORD.'
  )
  process.exit(1)
}

const JOBS_RUNS = 3
const SCORE_RUNS = 5
const QUERY = 'frontend developer'

const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

async function main() {
  const supabase = createClient(URL!, ANON!)
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: EMAIL!,
    password: PASSWORD!,
  })
  if (authErr) {
    console.error('Sign-in failed:', authErr.message)
    process.exit(1)
  }

  // --- Jobs feed: total wall time + per-source timings ---
  const totals: number[] = []
  let lastSources: Record<string, string> = {}
  let lastTimings: Record<string, number> = {}
  let lastCount = 0
  for (let i = 0; i < JOBS_RUNS; i++) {
    const t0 = performance.now()
    const { data, error } = await supabase.functions.invoke('jobs', {
      body: { queries: [QUERY], location: '', skills: ['react', 'typescript'] },
    })
    const dt = performance.now() - t0
    if (error) {
      console.error('jobs invoke failed:', error.message)
      process.exit(1)
    }
    totals.push(dt)
    lastSources = data?.sources ?? {}
    lastTimings = data?.timings ?? {}
    lastCount = (data?.jobs ?? []).length
    console.log(`jobs run ${i + 1}/${JOBS_RUNS}: ${dt.toFixed(0)}ms, ${lastCount} jobs`)
  }

  // --- Claude scoring: per-call latency over a fixed fixture ---
  const fixtureJob = {
    id: 'bench:1',
    title: 'Frontend Developer',
    company: 'Benchmark Co',
    location: 'Remote',
    description:
      'Build React + TypeScript UIs. Work with a design system, ship features, write tests.',
  }
  const profile = { summary: null, skills: ['react', 'typescript'], interests: [], location: null }
  const scoreMs: number[] = []
  for (let i = 0; i < SCORE_RUNS; i++) {
    const t0 = performance.now()
    const { error } = await supabase.functions.invoke('claude', {
      body: { task: 'score_jobs', profile, jobs: [fixtureJob] },
    })
    const dt = performance.now() - t0
    if (error) {
      console.error('claude invoke failed:', error.message)
      process.exit(1)
    }
    scoreMs.push(dt)
    console.log(`score run ${i + 1}/${SCORE_RUNS}: ${dt.toFixed(0)}ms`)
  }

  const result = {
    date: new Date().toISOString().slice(0, 10),
    target: URL,
    query: QUERY,
    jobsFeed: {
      runs: JOBS_RUNS,
      totalMsP50: Math.round(percentile(totals, 50)),
      perSourceMs: lastTimings,
      sources: lastSources,
      jobCount: lastCount,
    },
    claudeScoring: {
      samples: SCORE_RUNS,
      p50Ms: Math.round(percentile(scoreMs, 50)),
      p95Ms: Math.round(percentile(scoreMs, 95)),
    },
  }

  const outDir = join(ROOT, 'benchmarks', 'results')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${result.date}.json`)
  writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n')
  console.log('\nResult written to', outPath)
  console.log(JSON.stringify(result, null, 2))
  console.log(
    '\nTo set this as the baseline (deliberately): copy it to benchmarks/baseline.json'
  )

  await supabase.auth.signOut()
}

main()
