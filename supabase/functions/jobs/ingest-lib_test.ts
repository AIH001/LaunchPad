// Unit tests for the pure ingest logic. Run with `npm run test:functions`.
import { assertEquals } from 'jsr:@std/assert'
import { type NormalizedJob, SkippedError } from './lib.ts'
import { buildJobRows, externalJobId } from './ingest-lib.ts'
import { fetchSourceRow } from './sources.ts'

const RUN_AT = '2026-07-05T00:00:00.000Z'

function job(overrides: Partial<NormalizedJob>): NormalizedJob {
  return {
    id: 'greenhouse:1',
    source: 'greenhouse',
    title: 'Software Engineer',
    company: 'Acme',
    location: 'Remote',
    description: 'Build things.',
    url: 'https://example.com/1',
    salaryMin: null,
    salaryMax: null,
    created: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

Deno.test('externalJobId strips the source prefix, keeping colon-bearing ids intact', () => {
  assertEquals(externalJobId(job({ id: 'greenhouse:12345', source: 'greenhouse' })), '12345')
  // Simplify/Jooble ids are URLs that themselves contain colons — slice by source
  // length, don't split on ':'.
  assertEquals(
    externalJobId(job({ id: 'simplify:https://jobs.co/x', source: 'simplify' })),
    'https://jobs.co/x'
  )
})

Deno.test('buildJobRows drops non-tech roles from an ats_board dump', () => {
  const rows = buildJobRows(
    [
      job({ id: 'greenhouse:1', title: 'Backend Engineer' }),
      job({ id: 'greenhouse:2', title: 'Account Executive' }),
      job({ id: 'greenhouse:3', title: 'Data Analyst' }),
    ],
    'ats_board',
    RUN_AT
  )
  assertEquals(rows.map((r) => r.title), ['Backend Engineer', 'Data Analyst'])
})

Deno.test('buildJobRows keeps all rows for a query-targeted search_query source', () => {
  // A search_query source is already narrowed by its query, so we don't re-filter
  // (even a non-tech-looking title is kept — the API matched it to the query).
  const rows = buildJobRows(
    [
      job({ id: 'adzuna:1', source: 'adzuna', title: 'Software Engineer' }),
      job({ id: 'adzuna:2', source: 'adzuna', title: 'Analyst Programmer Trainee' }),
    ],
    'search_query',
    RUN_AT
  )
  assertEquals(rows.length, 2)
})

Deno.test('buildJobRows de-dupes within a batch and respects the cap', () => {
  const dupes = buildJobRows(
    [job({ id: 'greenhouse:9', title: 'Engineer' }), job({ id: 'greenhouse:9', title: 'Engineer' })],
    'ats_board',
    RUN_AT
  )
  assertEquals(dupes.length, 1)

  const many = Array.from({ length: 10 }, (_, i) =>
    job({ id: `greenhouse:${i}`, title: 'Engineer' })
  )
  assertEquals(buildJobRows(many, 'ats_board', RUN_AT, 3).length, 3)
})

Deno.test('buildJobRows maps fields, flags early-career, stamps last_seen_at', () => {
  const [row] = buildJobRows(
    [
      job({
        id: 'greenhouse:42',
        source: 'greenhouse',
        title: 'Junior Backend Engineer',
        company: 'Acme',
        location: 'NYC',
        url: 'https://acme.com/42',
        salaryMin: 90000,
        salaryMax: 120000,
        created: '2026-06-30T00:00:00Z',
      }),
    ],
    'ats_board',
    RUN_AT
  )
  assertEquals(row.source, 'greenhouse')
  assertEquals(row.external_job_id, '42')
  assertEquals(row.is_early_career, true) // "Junior" → early-career
  assertEquals(row.salary_min, 90000)
  assertEquals(row.posted_at, '2026-06-30T00:00:00Z')
  assertEquals(row.last_seen_at, RUN_AT)
  assertEquals(row.is_active, true)
  assertEquals(row.closed_at, null)
})

Deno.test('fetchSourceRow defers HN with a SkippedError (no network)', async () => {
  let skipped = false
  try {
    await fetchSourceRow({ kind: 'scrape', source: 'hn', token: null, query: null }, { country: 'us' })
  } catch (e) {
    skipped = e instanceof SkippedError
  }
  assertEquals(skipped, true)
})
