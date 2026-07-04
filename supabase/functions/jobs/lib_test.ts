// Unit tests for the pure jobs-aggregation logic. Run with `npm run
// test:functions` (deno test). These never ship: Supabase deploys the import
// graph rooted at index.ts, and nothing imports *_test.ts.
import { assertEquals } from 'jsr:@std/assert'
import {
  type NormalizedJob,
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
  stripHtml,
  stripEscapedHtml,
  withTimeout,
  DESCRIPTION_LIMIT,
  type HnComment,
} from './lib.ts'

function job(overrides: Partial<NormalizedJob>): NormalizedJob {
  return {
    id: 'adzuna:1',
    source: 'adzuna',
    title: 'Frontend Developer',
    company: 'Acme',
    location: 'Austin, TX',
    description: 'Build UIs.',
    url: 'https://example.com/1',
    salaryMin: null,
    salaryMax: null,
    created: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

Deno.test('mapAdzuna normalizes the full shape with prefixed id', () => {
  const mapped = mapAdzuna({
    id: 12345,
    title: 'Junior React Developer',
    company: { display_name: 'Acme Corp' },
    location: { display_name: 'Austin, TX' },
    description: '<p>Build &amp; ship UIs</p>',
    redirect_url: 'https://adzuna.com/job/12345',
    salary_min: 70000,
    salary_max: 90000,
    created: '2026-06-30T12:00:00Z',
  })
  assertEquals(mapped.id, 'adzuna:12345')
  assertEquals(mapped.source, 'adzuna')
  assertEquals(mapped.company, 'Acme Corp')
  assertEquals(mapped.description, 'Build & ship UIs')
  assertEquals(mapped.salaryMin, 70000)
  assertEquals(mapped.salaryMax, 90000)
})

Deno.test('mapAdzuna falls back on missing optional fields', () => {
  const mapped = mapAdzuna({
    id: 'abc',
    title: 'Dev',
    description: 'x',
    redirect_url: 'https://a.com',
    created: '',
  })
  assertEquals(mapped.company, 'Unknown')
  assertEquals(mapped.location, '')
  assertEquals(mapped.salaryMin, null)
  assertEquals(mapped.salaryMax, null)
})

Deno.test('mapAdzuna truncates long descriptions', () => {
  const mapped = mapAdzuna({
    id: 1,
    title: 'Dev',
    description: 'x'.repeat(DESCRIPTION_LIMIT + 500),
    redirect_url: 'https://a.com',
    created: '',
  })
  assertEquals(mapped.description.length, DESCRIPTION_LIMIT)
})

Deno.test('mapRemotive normalizes with prefixed id and strips HTML', () => {
  const mapped = mapRemotive({
    id: 2090942,
    title: 'Senior React Developer',
    company_name: 'Clerky, Inc.',
    candidate_required_location: 'Worldwide',
    description: '<p>Build &amp; ship UIs</p>',
    url: 'https://remotive.com/remote-jobs/x-2090942',
    publication_date: '2026-07-02T07:39:11',
  })
  assertEquals(mapped.id, 'remotive:2090942')
  assertEquals(mapped.source, 'remotive')
  assertEquals(mapped.company, 'Clerky, Inc.')
  assertEquals(mapped.location, 'Worldwide')
  assertEquals(mapped.description, 'Build & ship UIs')
  assertEquals(mapped.salaryMin, null) // salary is free text — dropped
  assertEquals(mapped.created, '2026-07-02T07:39:11')
})

Deno.test('mapRemotive falls back to Remote/Unknown on missing fields', () => {
  const mapped = mapRemotive({
    id: 1,
    title: 'Dev',
    description: 'x',
    url: 'https://remotive.com/x',
  })
  assertEquals(mapped.company, 'Unknown')
  assertEquals(mapped.location, 'Remote')
  assertEquals(mapped.created, '')
})

Deno.test('mapTheMuse joins locations and strips HTML contents', () => {
  const mapped = mapTheMuse({
    id: '18840681',
    name: 'Junior Software Engineer',
    contents: '<p>Position Summary &amp; details</p>',
    company: { name: 'Walmart' },
    locations: [{ name: 'West Salem, WI' }, { name: 'Austin, TX' }],
    refs: { landing_page: 'https://www.themuse.com/jobs/walmart/x' },
    publication_date: '2026-08-13T02:59:32Z',
  })
  assertEquals(mapped.id, 'themuse:18840681')
  assertEquals(mapped.source, 'themuse')
  assertEquals(mapped.company, 'Walmart')
  assertEquals(mapped.location, 'West Salem, WI, Austin, TX')
  assertEquals(mapped.description, 'Position Summary & details')
  assertEquals(mapped.url, 'https://www.themuse.com/jobs/walmart/x')
})

Deno.test('mapTheMuse defaults to Remote when no locations', () => {
  const mapped = mapTheMuse({ id: 1, name: 'Dev' })
  assertEquals(mapped.location, 'Remote')
  assertEquals(mapped.company, 'Unknown')
})

Deno.test('mapJooble strips snippet HTML and prefixes id', () => {
  const mapped = mapJooble({
    id: 555,
    title: 'Backend Engineer',
    company: 'Globex',
    location: 'Remote',
    snippet: '<b>Build</b> APIs &amp; services',
    link: 'https://jooble.org/desc/555',
    updated: '2026-07-01T00:00:00Z',
  })
  assertEquals(mapped.id, 'jooble:555')
  assertEquals(mapped.description, 'Build APIs & services')
  assertEquals(mapped.salaryMin, null)
})

Deno.test('mapJooble falls back to link when id is missing', () => {
  const mapped = mapJooble({
    title: 'Dev',
    link: 'https://jooble.org/desc/abc',
  })
  assertEquals(mapped.id, 'jooble:https://jooble.org/desc/abc')
  assertEquals(mapped.company, 'Unknown')
})

Deno.test('mapGreenhouse decodes double-escaped HTML and tags the company', () => {
  const mapped = mapGreenhouse(
    {
      id: 7908701,
      title: 'Senior Frontend Engineer',
      absolute_url: 'https://jobs.dropbox.com/listing/7908701',
      location: { name: 'Remote - US' },
      updated_at: '2026-07-02T13:48:16-04:00',
      // Double-escaped: entity-encoded tags, as Greenhouse actually returns.
      content: '&lt;p&gt;Build UIs &amp;amp; ship&lt;/p&gt;',
    },
    'dropbox'
  )
  assertEquals(mapped.id, 'greenhouse:7908701')
  assertEquals(mapped.company, 'dropbox')
  assertEquals(mapped.location, 'Remote - US')
  assertEquals(mapped.description, 'Build UIs & ship')
})

Deno.test('mapLever maps title/location and converts epoch ms to ISO', () => {
  const mapped = mapLever(
    {
      id: 'abc-123',
      text: 'Backend Engineer',
      categories: { location: 'San Francisco', team: 'Platform' },
      descriptionPlain: 'Build APIs.',
      hostedUrl: 'https://jobs.lever.co/kraken/abc-123',
      createdAt: 1751328000000,
    },
    'kraken'
  )
  assertEquals(mapped.id, 'lever:abc-123')
  assertEquals(mapped.company, 'kraken')
  assertEquals(mapped.location, 'San Francisco')
  assertEquals(mapped.description, 'Build APIs.')
  assertEquals(mapped.created, new Date(1751328000000).toISOString())
})

Deno.test('titleMatchesQueries matches on shared non-generic tokens', () => {
  assertEquals(titleMatchesQueries('Frontend Engineer', ['frontend developer']), true)
  assertEquals(titleMatchesQueries('React Developer', ['react developer']), true)
  // "Account Executive" shares no meaningful token with a dev query.
  assertEquals(titleMatchesQueries('Account Executive', ['frontend developer']), false)
})

Deno.test('titleMatchesQueries keeps generic dev roles for a generic query', () => {
  // Query reduces to no specific tokens → match any engineer/developer title.
  assertEquals(titleMatchesQueries('Software Engineer', ['software developer']), true)
  assertEquals(titleMatchesQueries('Marketing Manager', ['software developer']), false)
})

Deno.test('stripEscapedHtml handles entity-encoded markup', () => {
  assertEquals(stripEscapedHtml('&lt;h2&gt;Role &amp;amp; team&lt;/h2&gt;'), 'Role & team')
})

Deno.test('pickWhoIsHiringThread selects the hiring thread, not siblings', () => {
  const hits = [
    { objectID: '2', title: 'Ask HN: Who wants to be hired? (July 2026)' },
    { objectID: '1', title: 'Ask HN: Who is hiring? (July 2026)' },
    { objectID: '0', title: 'Ask HN: Freelancer? Seeking freelancer? (July 2026)' },
  ]
  assertEquals(pickWhoIsHiringThread(hits)?.objectID, '1')
  assertEquals(pickWhoIsHiringThread([{ objectID: 'x', title: 'Unrelated' }]), null)
})

Deno.test('prefilterHnComments keeps term-matching comments, caps, strips HTML', () => {
  const comments: HnComment[] = [
    { id: 1, text: '<p>SF | Acme | <b>React</b> Developer | Remote</p>' },
    { id: 2, text: 'NYC | Globex | Sales Rep | Onsite' }, // no term match
    { id: 3, text: null }, // deleted
    { id: 4, text: 'Remote | Initech | TypeScript engineer' },
  ]
  const out = prefilterHnComments(comments, ['react developer'], ['typescript'], 20)
  assertEquals(out.map((c) => c.id), [1, 4])
  assertEquals(out[0].text, 'SF | Acme | React Developer | Remote') // HTML stripped
})

Deno.test('prefilterHnComments respects the cap', () => {
  const comments: HnComment[] = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    text: 'react role',
  }))
  assertEquals(prefilterHnComments(comments, ['react'], [], 5).length, 5)
})

Deno.test('parseWwrHtml extracts listings from real server-rendered markup', async () => {
  // Fixture is a trimmed capture of the live WWR category page. This test is
  // what fails first when WWR changes its markup — the canary for the scraper.
  const html = await Deno.readTextFile(
    new URL('./__fixtures__/wwr-listing.html', import.meta.url)
  )
  const jobs = parseWwrHtml(html)
  assertEquals(jobs.length, 3)
  assertEquals(jobs[0].source, 'wwr')
  assertEquals(jobs[0].id, 'wwr:proxify-ab-senior-fullstack-developer-python-3')
  assertEquals(jobs[0].title, 'Senior Fullstack Developer (Python)')
  assertEquals(jobs[0].company, 'Proxify AB')
  assertEquals(jobs[0].location, 'Remote')
  assertEquals(jobs[0].url, 'https://weworkremotely.com/remote-jobs/proxify-ab-senior-fullstack-developer-python-3')
})

Deno.test('parseWwrHtml returns nothing for unrecognized markup', () => {
  assertEquals(parseWwrHtml('<html><body>no listings here</body></html>').length, 0)
})

Deno.test('mapHnExtracted builds ids, falls back to permalink, keeps created_at', () => {
  const commentsById = new Map<number, HnComment>([
    [101, { id: 101, created_at: '2026-07-01T00:00:00Z' }],
  ])
  const out = mapHnExtracted(
    [
      {
        comment_id: '101',
        title: 'React Developer',
        company: 'Acme',
        location: 'Remote',
        url: '',
        summary: 'Build UIs.',
      },
      // Dropped: no company.
      { comment_id: '102', title: 'x', company: '', location: '', url: '', summary: '' },
    ],
    commentsById
  )
  assertEquals(out.length, 1)
  assertEquals(out[0].id, 'hn:101')
  assertEquals(out[0].url, 'https://news.ycombinator.com/item?id=101')
  assertEquals(out[0].created, '2026-07-01T00:00:00Z')
})

Deno.test('stripHtml removes tags, decodes entities, collapses whitespace', () => {
  assertEquals(
    stripHtml('<div>Hello &amp; <b>world</b>\n\n &quot;quoted&quot; &#39;s</div>'),
    'Hello & world "quoted" \'s'
  )
})

Deno.test('dedupe collapses same title+company across sources, first wins', () => {
  const a = job({ id: 'adzuna:1', description: 'rich description' })
  const b = job({ id: 'remotive:9', source: 'remotive', description: 'thin' })
  const c = job({ id: 'adzuna:2', title: 'Backend Developer' })
  const out = dedupe([a, b, c])
  assertEquals(out.length, 2)
  assertEquals(out[0].id, 'adzuna:1') // first-seen kept its richer description
  assertEquals(out[1].id, 'adzuna:2')
})

Deno.test('dedupe treats punctuation/case variants as the same job', () => {
  const a = job({ id: 'adzuna:1', title: 'Front-End Developer', company: 'ACME' })
  const b = job({ id: 'lever:2', source: 'lever', title: 'front end developer', company: 'acme' })
  assertEquals(dedupe([a, b]).length, 1)
})

Deno.test('interleaveBySource round-robins and respects the cap', () => {
  const a1 = job({ id: 'adzuna:1' })
  const a2 = job({ id: 'adzuna:2', title: 'A2' })
  const a3 = job({ id: 'adzuna:3', title: 'A3' })
  const r1 = job({ id: 'remotive:1', source: 'remotive', title: 'R1' })
  const r2 = job({ id: 'remotive:2', source: 'remotive', title: 'R2' })
  const out = interleaveBySource([a1, a2, a3, r1, r2], 4)
  assertEquals(out.map((j) => j.id), ['adzuna:1', 'remotive:1', 'adzuna:2', 'remotive:2'])
})

Deno.test('interleaveBySource drains uneven buckets without stalling', () => {
  const a1 = job({ id: 'adzuna:1' })
  const r1 = job({ id: 'remotive:1', source: 'remotive', title: 'R1' })
  const r2 = job({ id: 'remotive:2', source: 'remotive', title: 'R2' })
  const r3 = job({ id: 'remotive:3', source: 'remotive', title: 'R3' })
  const out = interleaveBySource([a1, r1, r2, r3], 10)
  assertEquals(out.length, 4)
})

Deno.test('withTimeout rejects a hung promise and passes a fast one', async () => {
  const fast = await withTimeout(Promise.resolve('ok'), 1000, 'fast')
  assertEquals(fast, 'ok')

  let timedOut = false
  try {
    await withTimeout(new Promise(() => {}), 10, 'slow')
  } catch (e) {
    timedOut = String(e).includes('slow timed out')
  }
  assertEquals(timedOut, true)
})
