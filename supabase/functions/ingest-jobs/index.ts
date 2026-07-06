// ingest-jobs: the background sync worker. Walks the job_sources catalog, fetches
// each source, and upserts normalized listings into the public.jobs table. Runs
// on a schedule (GitHub Actions cron → this function), NOT on the user's search
// path — the user-facing `jobs` function reads the table this populates.
//
// Auth: this is the app's ONLY service-role code path (it writes global tables
// that RLS otherwise makes read-only). It's not user-gated; instead it requires a
// shared `x-ingest-secret` header, and `verify_jwt = false` is set for it in
// config.toml so the platform doesn't reject the secret-authenticated call.
// Never expose the service-role key or this secret to the browser.
import { createClient } from 'npm:@supabase/supabase-js'
import { json } from '../_shared/cors.ts'
import { withTimeout, SkippedError } from '../jobs/lib.ts'
import { fetchSourceRow, type SourceRow } from '../jobs/sources.ts'
import { buildJobRows, PER_ROW_CAP, mapWithConcurrency } from '../jobs/ingest-lib.ts'

const SOURCE_TIMEOUT_MS = 12_000
// Max source fetches in flight at once. Keeps one run from opening a socket per
// catalog row (hundreds, once ATS boards are seeded) or tripping source rate
// limits — while still finishing well inside the function's time budget. This is
// ALSO the memory ceiling: because each source is fetched → built → upserted →
// released inside the worker (never accumulated), only ~this many boards' payloads
// are resident at once. That's what keeps the run under the Edge Function's
// ~256 MB limit no matter how large the catalog grows.
const FETCH_CONCURRENCY = 10

// Max job_sources rows processed per run. The catalog is ordered oldest-synced
// first, so capping here turns the run into a round-robin: each invocation syncs
// the N most-stale sources and rotates the rest to later runs. Streaming bounds
// MEMORY; this bounds TIME/CPU — the other wall an invocation hits once the
// catalog reaches thousands of boards (you can't even *visit* them all serially in
// one run). Freshness knobs: raise N, or run the cron more often; beyond that,
// shard the cron into parallel offset slices. Env-overridable so it's tunable
// without a redeploy. Default 250 comfortably covers today's catalog every run.
const MAX_SOURCES_PER_RUN = Math.max(1, Number(Deno.env.get('INGEST_MAX_SOURCES') ?? '250'))

interface JobSourceRow extends SourceRow {
  id: string
  display_name: string
}

interface SourceAgg {
  ok: number
  errored: number
  skipped: number
  upserted: number
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // Shared-secret gate (see header note). Constant-ish check; the secret must be
  // configured or every call is rejected.
  const secret = Deno.env.get('INGEST_SECRET')
  if (!secret || req.headers.get('x-ingest-secret') !== secret) {
    return json({ error: 'unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'ingest worker is missing SUPABASE_URL / SERVICE_ROLE_KEY' }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceKey)

  // Single timestamp for the whole run: seen jobs get last_seen_at = this, so
  // "not seen this run" is simply last_seen_at < runStartedAt.
  const runStartedAt = new Date().toISOString()

  // 1) Load the active catalog, oldest-synced first and capped at
  // MAX_SOURCES_PER_RUN so a large catalog rotates through over successive runs
  // (see the constant's note). nullsFirst puts never-synced rows at the head.
  const { data: sourceRows, error: srcErr } = await supabase
    .from('job_sources')
    .select('id, kind, source, token, query, display_name')
    .eq('is_active', true)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(MAX_SOURCES_PER_RUN)
  if (srcErr) return json({ error: `job_sources read failed: ${srcErr.message}` }, 500)
  const rows = (sourceRows ?? []) as JobSourceRow[]

  // 2) Process each source with bounded concurrency. CRUCIAL: fetching, building,
  // upserting, and recording sync status ALL happen inside the worker, so each
  // source's job payload is released as soon as it's written — never accumulated
  // across the whole catalog. (The previous version fetched every source into one
  // array first, then looped to upsert; at ~160 boards that held every board's
  // parsed listings in memory at once and blew the ~256 MB Edge Function limit.)
  // Each fetch is behind a timeout so one hung source can't stall the run. Errors
  // are handled here, so every result is `fulfilled` with a small status record.
  const settled = await mapWithConcurrency(rows, FETCH_CONCURRENCY, async (row) => {
    let status: 'ok' | 'error' | 'skipped'
    let lastError: string | null = null
    let upserted = 0
    try {
      const jobs = await withTimeout(
        fetchSourceRow(row, { country: 'us' }),
        SOURCE_TIMEOUT_MS,
        row.source
      )
      status = 'ok'
      const jobRows = buildJobRows(jobs, row.kind, runStartedAt, PER_ROW_CAP[row.kind])
      if (jobRows.length > 0) {
        const { error: upErr } = await supabase
          .from('jobs')
          .upsert(jobRows, { onConflict: 'source,external_job_id' })
        if (upErr) {
          status = 'error'
          lastError = `upsert failed: ${upErr.message}`
        } else {
          upserted = jobRows.length
        }
      }
    } catch (reason) {
      if (reason instanceof SkippedError) {
        status = 'skipped'
        lastError = String(reason.message)
      } else {
        status = 'error'
        lastError = String(reason)
      }
    }

    await supabase
      .from('job_sources')
      .update({ last_synced_at: runStartedAt, last_status: status, last_error: lastError })
      .eq('id', row.id)

    return { source: row.source, status, upserted }
  })

  // 3) Aggregate by source NAME (a source can have many catalog rows) for the
  // stale-close guard and the run summary. Only small status records are folded in
  // here — the job payloads are already written and gone.
  const bySource: Record<string, SourceAgg> = {}
  const agg = (s: string): SourceAgg =>
    (bySource[s] ??= { ok: 0, errored: 0, skipped: 0, upserted: 0 })
  for (const result of settled) {
    // fn above never throws, so every result is fulfilled; guard anyway for types.
    if (result.status !== 'fulfilled') continue
    const { source, status, upserted } = result.value
    const a = agg(source)
    if (status === 'ok') a.ok++
    else if (status === 'skipped') a.skipped++
    else a.errored++
    a.upserted += upserted
  }

  // 4) Close listings that disappeared from a source this run — but ONLY for
  // sources that fully synced with no errors (else a transient outage would
  // wrongly close every job from that source).
  //
  // Guard against the round-robin cap: stale-close is keyed by source PLATFORM
  // (e.g. all of `greenhouse`) and closes anything not seen this run. That's only
  // sound when EVERY board of that source was visited this run. If the run was
  // truncated by MAX_SOURCES_PER_RUN, a source's boards are split across runs, so
  // a job "not seen" may just belong to a board we didn't reach — closing it would
  // be wrong. So when the catalog outgrows one run, we skip closing entirely
  // rather than risk retiring live jobs. Honest tradeoff: past that point, dead
  // listings linger until the catalog fits in one run again (raise N / run the
  // cron more often) or a dedicated per-board close pass is added.
  const truncated = rows.length >= MAX_SOURCES_PER_RUN
  const closed: Record<string, number> = {}
  if (!truncated) {
    for (const [source, a] of Object.entries(bySource)) {
      if (a.errored > 0 || a.ok === 0) continue
      const { data: closedRows, error: closeErr } = await supabase
        .from('jobs')
        .update({ is_active: false, closed_at: runStartedAt })
        .eq('source', source)
        .eq('is_active', true)
        .lt('last_seen_at', runStartedAt)
        .select('id')
      if (!closeErr) closed[source] = (closedRows ?? []).length
    }
  }

  // 5) Record the run for observability. `_run` carries whole-run facts (how many
  // catalog rows this invocation covered, and whether the cap truncated it — i.e.
  // stale-close was skipped) alongside the per-source breakdown.
  const perSource = Object.fromEntries(
    Object.entries(bySource).map(([s, a]) => [s, { ...a, closed: closed[s] ?? 0 }])
  )
  const runMeta = { sources_processed: rows.length, cap: MAX_SOURCES_PER_RUN, truncated }
  await supabase.from('ingestion_runs').insert({
    started_at: runStartedAt,
    finished_at: new Date().toISOString(),
    per_source: { _run: runMeta, ...perSource },
  })

  return json({ ok: true, runStartedAt, run: runMeta, sources: perSource })
})
