// Pure logic for the ingest worker — no network, no DB, so it's unit-testable
// with `deno test` the same way lib.ts is. The worker (../ingest-jobs/index.ts)
// does the I/O and calls buildJobRows to turn fetched NormalizedJobs into rows
// ready to upsert into the public.jobs table.
import { type NormalizedJob, isTechRole, isEarlyCareer } from './lib.ts'

type SourceKind = 'ats_board' | 'search_query' | 'scrape'

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
