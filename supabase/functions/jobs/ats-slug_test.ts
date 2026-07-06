// Unit tests for the pure ATS-URL → (source, token) parser. Run with
// `npm run test:functions`.
import { assertEquals } from 'jsr:@std/assert'
import { extractAtsBoard } from './ats-slug.ts'

Deno.test('extractAtsBoard resolves real ATS posting URLs to (source, token)', () => {
  const cases: Array<[string, ReturnType<typeof extractAtsBoard>]> = [
    // Greenhouse — canonical, newer host, regional, and embedded-form variants.
    ['https://boards.greenhouse.io/stripe/jobs/5678', { source: 'greenhouse', token: 'stripe' }],
    ['https://job-boards.greenhouse.io/figma/jobs/1', { source: 'greenhouse', token: 'figma' }],
    ['https://boards.eu.greenhouse.io/airbnb/jobs/9', { source: 'greenhouse', token: 'airbnb' }],
    [
      'https://boards.greenhouse.io/embed/job_app?for=dropbox&token=42',
      { source: 'greenhouse', token: 'dropbox' },
    ],
    // Lever.
    ['https://jobs.lever.co/kraken/abc-123-uuid', { source: 'lever', token: 'kraken' }],
    ['https://jobs.lever.co/voleon/uuid/apply', { source: 'lever', token: 'voleon' }],
    // Ashby — with and without a posting id.
    ['https://jobs.ashbyhq.com/ramp/some-uuid', { source: 'ashby', token: 'ramp' }],
    ['https://jobs.ashbyhq.com/linear', { source: 'ashby', token: 'linear' }],
    // SmartRecruiters — companyId keeps case + trailing digits (the URL the user found).
    [
      'https://jobs.smartrecruiters.com/NBCUniversal3/744000135778519',
      { source: 'smartrecruiters', token: 'NBCUniversal3' },
    ],
    // Workable — account path form and legacy subdomain form.
    ['https://apply.workable.com/acme-inc/j/ABC123/', { source: 'workable', token: 'acme-inc' }],
    ['https://acme.workable.com/jobs/123', { source: 'workable', token: 'acme' }],
    // Protocol-less input is tolerated.
    ['boards.greenhouse.io/gitlab/jobs/1', { source: 'greenhouse', token: 'gitlab' }],
  ]
  for (const [url, expected] of cases) {
    assertEquals(extractAtsBoard(url), expected, url)
  }
})

Deno.test('extractAtsBoard returns null for non-ATS or malformed URLs', () => {
  const nulls = [
    'https://simplify.jobs/p/some-posting', // Simplify redirect, not an ATS board
    'https://www.linkedin.com/jobs/view/123',
    'https://example.com/careers',
    'https://boards.greenhouse.io/', // no slug
    'https://apply.workable.com/j/ABC123/', // only the posting shortcode, no account
    'not a url',
    '',
  ]
  for (const url of nulls) {
    assertEquals(extractAtsBoard(url), null, url)
  }
})
