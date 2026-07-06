// Pure, dependency-free parser: turn an ATS job-posting URL into the
// (source, token) pair our per-board fetchers in sources.ts expect. The ingest
// worker's tooling (mine-ats-boards / theirstack-ats-boards) uses this to
// DISCOVER boards from posting URLs and populate job_sources. Zero imports so it
// runs under both Deno (the functions runtime) and Node/tsx (the tooling).
//
// `token` MUST match the identifier each fetcher in sources.ts puts in its API
// path, so a discovered board is immediately fetchable:
//   greenhouse      boards-api.greenhouse.io/v1/boards/<token>/jobs
//   lever           api.lever.co/v0/postings/<token>
//   ashby           api.ashbyhq.com/posting-api/job-board/<token>
//   smartrecruiters api.smartrecruiters.com/v1/companies/<token>/postings
//   workable        apply.workable.com/api/v1/widget/accounts/<token>

export type AtsSource = 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters' | 'workable'

export interface AtsBoard {
  source: AtsSource
  token: string
}

// A board token / slug / companyId: starts alphanumeric, then alphanumerics plus
// - _ . — never a space or slash. SmartRecruiters ids keep their case and trailing
// digits (e.g. `NBCUniversal3`), so we do NOT lowercase.
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function firstSegment(pathname: string): string {
  const seg = pathname.split('/').filter(Boolean)[0] ?? ''
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
}

const valid = (token: string): boolean => TOKEN_RE.test(token)

export function extractAtsBoard(rawUrl: string): AtsBoard | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null

  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    // Tolerate protocol-less inputs like "boards.greenhouse.io/acme/jobs/1".
    try {
      url = new URL(`https://${rawUrl.trim()}`)
    } catch {
      return null
    }
  }

  const host = url.hostname.toLowerCase()

  // Greenhouse — canonical boards.greenhouse.io, the newer job-boards.greenhouse.io,
  // and regional boards.eu.greenhouse.io. Embedded application forms carry the
  // board slug in the `for` query param instead of the path.
  if (host.endsWith('greenhouse.io')) {
    if (url.pathname.toLowerCase().startsWith('/embed')) {
      const forParam = url.searchParams.get('for') ?? ''
      return valid(forParam) ? { source: 'greenhouse', token: forParam } : null
    }
    const token = firstSegment(url.pathname)
    return valid(token) ? { source: 'greenhouse', token } : null
  }

  // Lever — jobs.lever.co/<slug>/<uuid> (and regional jobs.eu.lever.co).
  if (host.endsWith('lever.co')) {
    const token = firstSegment(url.pathname)
    return valid(token) ? { source: 'lever', token } : null
  }

  // Ashby — jobs.ashbyhq.com/<slug>[/<uuid>].
  if (host.endsWith('ashbyhq.com')) {
    const token = firstSegment(url.pathname)
    return valid(token) ? { source: 'ashby', token } : null
  }

  // SmartRecruiters — jobs.smartrecruiters.com/<companyId>/<postingId>. companyId
  // keeps its case and trailing digits (the API path is case-sensitive).
  if (host.endsWith('smartrecruiters.com')) {
    const token = firstSegment(url.pathname)
    return valid(token) ? { source: 'smartrecruiters', token } : null
  }

  // Workable — account-hosted apply.workable.com/<account>/... (account is the
  // first path segment; `/j/` is the posting shortcode, not the account) or the
  // older subdomain form <account>.workable.com.
  if (host.endsWith('workable.com')) {
    if (host === 'apply.workable.com' || host === 'jobs.workable.com' || host === 'www.workable.com') {
      const token = firstSegment(url.pathname)
      return valid(token) && token.toLowerCase() !== 'j' ? { source: 'workable', token } : null
    }
    const sub = host.split('.')[0]
    return valid(sub) && sub !== 'apply' && sub !== 'jobs' && sub !== 'www'
      ? { source: 'workable', token: sub }
      : null
  }

  return null
}
