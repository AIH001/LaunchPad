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
import { buildJobRows } from '../jobs/ingest-lib.ts'

const SOURCE_TIMEOUT_MS = 12_000
const PER_ROW_CAP = 50 // max jobs stored per job_sources row per run

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

  // 1) Load the active catalog.
  const { data: sourceRows, error: srcErr } = await supabase
    .from('job_sources')
    .select('id, kind, source, token, query, display_name')
    .eq('is_active', true)
  if (srcErr) return json({ error: `job_sources read failed: ${srcErr.message}` }, 500)
  const rows = (sourceRows ?? []) as JobSourceRow[]

  // 2) Fetch every row concurrently, each behind a timeout so one hung source
  // can't stall the run.
  const settled = await Promise.allSettled(
    rows.map((r) => withTimeout(fetchSourceRow(r, { country: 'us' }), SOURCE_TIMEOUT_MS, r.source))
  )

  // Aggregate by source NAME (a source can have many catalog rows) for the
  // stale-close guard and the run summary.
  const bySource: Record<string, SourceAgg> = {}
  const agg = (s: string): SourceAgg =>
    (bySource[s] ??= { ok: 0, errored: 0, skipped: 0, upserted: 0 })

  // 3) Per row: upsert its jobs and record its sync status.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const result = settled[i]
    const a = agg(row.source)
    let status: 'ok' | 'error' | 'skipped'
    let lastError: string | null = null

    if (result.status === 'fulfilled') {
      status = 'ok'
      const jobRows = buildJobRows(result.value, row.kind, runStartedAt, PER_ROW_CAP)
      if (jobRows.length > 0) {
        const { error: upErr } = await supabase
          .from('jobs')
          .upsert(jobRows, { onConflict: 'source,external_job_id' })
        if (upErr) {
          status = 'error'
          lastError = `upsert failed: ${upErr.message}`
        } else {
          a.upserted += jobRows.length
        }
      }
      status === 'ok' ? a.ok++ : a.errored++
    } else if (result.reason instanceof SkippedError) {
      status = 'skipped'
      lastError = String(result.reason.message)
      a.skipped++
    } else {
      status = 'error'
      lastError = String(result.reason)
      a.errored++
    }

    await supabase
      .from('job_sources')
      .update({ last_synced_at: runStartedAt, last_status: status, last_error: lastError })
      .eq('id', row.id)
  }

  // 4) Close listings that disappeared from a source this run — but ONLY for
  // sources that fully synced with no errors (else a transient outage would
  // wrongly close every job from that source).
  const closed: Record<string, number> = {}
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

  // 5) Record the run for observability.
  const perSource = Object.fromEntries(
    Object.entries(bySource).map(([s, a]) => [s, { ...a, closed: closed[s] ?? 0 }])
  )
  await supabase.from('ingestion_runs').insert({
    started_at: runStartedAt,
    finished_at: new Date().toISOString(),
    per_source: perSource,
  })

  return json({ ok: true, runStartedAt, sources: perSource })
})
