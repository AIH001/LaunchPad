// Pure logic for the ingest worker — no network, no DB, so it's unit-testable
// with `deno test` the same way lib.ts is. The worker (../ingest-jobs/index.ts)
// does the I/O and calls buildJobRows to turn fetched NormalizedJobs into rows
// ready to upsert into the public.jobs table.
import { type NormalizedJob, isTechRole, isEarlyCareer } from './lib.ts'

export type SourceKind = 'ats_board' | 'search_query' | 'scrape'

// Max jobs stored per job_sources row per run, by source kind. One flat cap was
// wrong: `search_query` rows hit large general job APIs where a modest cap keeps a
// single query from flooding the table, but `scrape`/`ats_board` sources are
// curated lists (SimplifyJobs' README, WWR, a company's own board) where the whole
// point is coverage — capping them at 50 silently dropped the bulk of them (the
// Simplify repo alone lists ~330 internships).
export const PER_ROW_CAP: Record<SourceKind, number> = {
  search_query: 50,
  ats_board: 100,
  scrape: 500,
}

// The insert/upsert shape for public.jobs. Only real columns — the generated
// ones (external_id, normalized_title, content_hash, search_tsv) are computed by
// Postgres and must NOT be sent. first_seen_at/created_at/updated_at are left to
// their defaults/trigger.
export interface JobRow {
  source: string
  external_job_id: string
  title: string
  company: string
  location: string
  description: string
  url: string
  salary_min: number | null
  salary_max: number | null
  posted_at: string
  is_early_career: boolean
  last_seen_at: string
  is_active: true
  closed_at: null
}

// Recover the source-local id from the normalized `${source}:${externalId}` id.
// Slice by source length rather than splitting on ':' — some external ids are
// URLs that themselves contain colons (simplify, jooble).
export function externalJobId(job: NormalizedJob): string {
  return job.id.slice(job.source.length + 1)
}

// Turn a source row's fetched jobs into upsert-ready rows: filter to relevant
// roles, cap the volume, de-dupe within the batch, and stamp the flags.
export function buildJobRows(
  jobs: NormalizedJob[],
  kind: SourceKind,
  runStartedAt: string,
  cap = 50
): JobRow[] {
  // search_query results are already query-targeted; ats_board/scrape dumps list
  // every role, so drop non-tech ones (sales/HR/ops) before storing.
  const relevant = kind === 'search_query' ? jobs : jobs.filter((j) => isTechRole(j.title))

  const seen = new Set<string>()
  const out: JobRow[] = []
  for (const j of relevant) {
    if (out.length >= cap) break
    const external = externalJobId(j)
    // A single upsert statement can't touch the same (source, external_job_id)
    // twice, so collapse in-batch duplicates (a board occasionally repeats a job).
    if (seen.has(external)) continue
    seen.add(external)
    out.push({
      source: j.source,
      external_job_id: external,
      title: j.title,
      company: j.company,
      location: j.location,
      description: j.description,
      url: j.url,
      salary_min: j.salaryMin,
      salary_max: j.salaryMax,
      posted_at: j.created,
      is_early_career: isEarlyCareer(j.title, j.description),
      last_seen_at: runStartedAt,
      is_active: true,
      closed_at: null,
    })
  }
  return out
}

// Run `fn` over `items` with at most `limit` in flight at once, returning results
// in input order with allSettled semantics (never throws — a failed item is a
// `rejected` result). The ingest worker uses this instead of firing every source
// at once: once the catalog grows to hundreds of ATS boards, an unbounded
// `Promise.allSettled(rows.map(...))` would open hundreds of sockets and trip
// source rate limits inside one function invocation.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}
