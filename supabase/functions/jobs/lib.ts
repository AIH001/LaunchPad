// Pure logic for the multi-source jobs function: types, per-source mappers, and
// aggregation helpers. No network, no Deno.serve — everything here is unit-
// testable with `deno test` without booting the function.
//
// NOTE: NormalizedJob must stay in sync with the `Job` type in
// src/types/index.ts (different module systems — Deno vs. the Vite app — so it
// can't be imported across the boundary).

export type JobSource =
  | 'adzuna'
  | 'remotive'
  | 'themuse'
  | 'jooble'
  | 'hn'
  | 'greenhouse'
  | 'lever'
  | 'wwr'

export interface NormalizedJob {
  id: string // ALWAYS `${source}:${externalId}` — globally unique + stable
  source: JobSource
  title: string
  company: string
  location: string
  description: string
  url: string
  salaryMin: number | null
  salaryMax: number | null
  created: string // ISO 8601; '' if unknown
}

// A source throws this (instead of Error) when it is deliberately not
// configured — e.g. its API key hasn't been provisioned yet. The fan-out
// reports it as 'skipped' rather than 'error' so the UI doesn't show a
// false-alarm degraded banner.
export class SkippedError extends Error {}

export type SourceStatus = 'ok' | 'error' | 'skipped'

// Everything a source needs to run its query, derived once from the request.
export interface SourceInput {
  queries: string[] // derived from profile (target role, skills) or typed search
  location: string
  country: string // ISO code for sources that want it (Adzuna)
  skills: string[]
  // The caller's Authorization header, forwarded to the claude function by
  // sources that need server-to-server Claude calls (HN extraction). Null when
  // absent — those sources then skip.
  authHeader: string | null
}

export const DESCRIPTION_LIMIT = 2000

// Race a source against a deadline so one hung API can't stall the whole feed.
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ])
}

// Decode the handful of HTML entities job boards actually emit.
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

// Strip tags + decode entities + collapse whitespace. Good enough for feed
// descriptions; not a general HTML parser.
export function stripHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

// Some boards (Greenhouse) double-escape: the description is HTML whose tags are
// themselves entity-encoded (e.g. "&lt;p&gt;"). Decode entities first to recover
// the real markup, then strip it.
export function stripEscapedHtml(html: string): string {
  return stripHtml(decodeHtmlEntities(html))
}

// Does a job title plausibly match any of the search queries? Token-overlap
// (not exact phrase) so "Frontend Engineer" matches "frontend developer". Crude
// by design — the Claude match score is the real relevance gate; this just keeps
// company-wide board dumps (sales, HR, ops) out of a dev feed.
export function titleMatchesQueries(title: string, queries: string[]): boolean {
  const words = new Set(title.toLowerCase().match(/[a-z0-9]+/g) ?? [])
  // Generic words that shouldn't count as a match on their own.
  const stop = new Set(['developer', 'engineer', 'senior', 'junior', 'staff', 'the', 'and'])
  for (const q of queries) {
    const terms = (q.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !stop.has(t))
    if (terms.length > 0 && terms.some((t) => words.has(t))) return true
    // Also match generic dev roles when the query itself is generic.
    if (terms.length === 0 && (words.has('engineer') || words.has('developer'))) return true
  }
  return false
}

// Dedupe across sources on a coarse key: normalized title + company. The same
// posting often surfaces from multiple aggregators. First-seen wins, so order
// sources richer-description-first when collecting.
// Known limitation: won't catch company-name variants ("Acme" vs "Acme Inc").
export function dedupe(jobs: NormalizedJob[]): NormalizedJob[] {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const seen = new Set<string>()
  const out: NormalizedJob[] = []
  for (const j of jobs) {
    const key = `${normalize(j.title)}|${normalize(j.company)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(j)
  }
  return out
}

// Round-robin across sources so no single source dominates the top of the feed
// (the Claude match score does the real ranking client-side, but the pre-score
// render order should still look mixed).
export function interleaveBySource(jobs: NormalizedJob[], cap: number): NormalizedJob[] {
  const buckets = new Map<JobSource, NormalizedJob[]>()
  for (const j of jobs) {
    const bucket = buckets.get(j.source) ?? []
    bucket.push(j)
    buckets.set(j.source, bucket)
  }
  const out: NormalizedJob[] = []
  const lists = [...buckets.values()]
  for (let i = 0; out.length < cap; i++) {
    let added = false
    for (const list of lists) {
      if (i < list.length && out.length < cap) {
        out.push(list[i])
        added = true
      }
    }
    if (!added) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Adzuna
// ---------------------------------------------------------------------------

// The subset of Adzuna's response we actually use.
export interface AdzunaJob {
  id: string | number
  title: string
  company?: { display_name?: string }
  location?: { display_name?: string }
  description: string
  redirect_url: string
  salary_min?: number
  salary_max?: number
  created: string
}

export function mapAdzuna(j: AdzunaJob): NormalizedJob {
  return {
    id: `adzuna:${j.id}`,
    source: 'adzuna',
    title: j.title,
    company: j.company?.display_name ?? 'Unknown',
    location: j.location?.display_name ?? '',
    description: stripHtml(j.description ?? '').slice(0, DESCRIPTION_LIMIT),
    url: j.redirect_url,
    salaryMin: j.salary_min ?? null,
    salaryMax: j.salary_max ?? null,
    created: j.created ?? '',
  }
}

// ---------------------------------------------------------------------------
// Remotive (keyless official API)
// ---------------------------------------------------------------------------

// The subset of Remotive's response we use.
export interface RemotiveJob {
  id: number
  title: string
  company_name?: string
  candidate_required_location?: string
  description: string
  url: string
  publication_date?: string
}

export function mapRemotive(j: RemotiveJob): NormalizedJob {
  return {
    id: `remotive:${j.id}`,
    source: 'remotive',
    title: j.title,
    company: j.company_name ?? 'Unknown',
    // Remotive is remote-only; the field is a region string like "Worldwide".
    location: j.candidate_required_location || 'Remote',
    description: stripHtml(j.description ?? '').slice(0, DESCRIPTION_LIMIT),
    url: j.url,
    // Remotive's `salary` is free text (e.g. "$12K", "up to $80k") with no
    // reliable min/max — dropped rather than mis-parsed. (Flagged tradeoff.)
    salaryMin: null,
    salaryMax: null,
    created: j.publication_date ?? '',
  }
}

// ---------------------------------------------------------------------------
// The Muse (official API; key optional)
// ---------------------------------------------------------------------------
// No free-text search — filtered by category only, so it ignores the derived
// query and acts as a curated early-career firehose. Honest caveat: The Muse's
// own category tagging is noisy (retail roles occasionally carry a "Software
// Engineering" tag), and its category+level filters don't compose well, so we
// filter by category alone and let Claude's match score be the real relevance
// gate downstream.

export interface TheMuseJob {
  id: number | string
  name: string
  contents?: string
  company?: { name?: string }
  locations?: Array<{ name?: string }>
  refs?: { landing_page?: string }
  publication_date?: string
}

export function mapTheMuse(j: TheMuseJob): NormalizedJob {
  const location = (j.locations ?? [])
    .map((l) => l.name)
    .filter(Boolean)
    .join(', ')
  return {
    id: `themuse:${j.id}`,
    source: 'themuse',
    title: j.name,
    company: j.company?.name ?? 'Unknown',
    location: location || 'Remote',
    description: stripHtml(j.contents ?? '').slice(0, DESCRIPTION_LIMIT),
    url: j.refs?.landing_page ?? '',
    salaryMin: null, // The Muse doesn't expose structured salary.
    salaryMax: null,
    created: j.publication_date ?? '',
  }
}

// ---------------------------------------------------------------------------
// Jooble (official aggregator API; key required, approval ~a day)
// ---------------------------------------------------------------------------
// Until JOOBLE_API_KEY is provisioned the source throws SkippedError, so the
// feed reports it as 'skipped' (no error banner) rather than failing.

export interface JoobleJob {
  id?: number | string
  title: string
  company?: string
  location?: string
  snippet?: string
  link: string
  updated?: string
}

export function mapJooble(j: JoobleJob): NormalizedJob {
  // Jooble ids aren't always present/stable; fall back to the link so the
  // normalized id stays unique.
  const external = j.id != null ? String(j.id) : j.link
  return {
    id: `jooble:${external}`,
    source: 'jooble',
    title: j.title,
    company: j.company || 'Unknown',
    location: j.location ?? '',
    description: stripHtml(j.snippet ?? '').slice(0, DESCRIPTION_LIMIT),
    url: j.link,
    salaryMin: null, // Jooble salary is free text — dropped.
    salaryMax: null,
    created: j.updated ?? '',
  }
}

// ---------------------------------------------------------------------------
// Greenhouse (keyless public board JSON, per company)
// ---------------------------------------------------------------------------

export interface GreenhouseJob {
  id: number
  title: string
  absolute_url: string
  location?: { name?: string }
  updated_at?: string
  content?: string // double-escaped HTML
}

export function mapGreenhouse(j: GreenhouseJob, company: string): NormalizedJob {
  return {
    id: `greenhouse:${j.id}`,
    source: 'greenhouse',
    title: j.title,
    company,
    location: j.location?.name ?? '',
    description: stripEscapedHtml(j.content ?? '').slice(0, DESCRIPTION_LIMIT),
    url: j.absolute_url,
    salaryMin: null,
    salaryMax: null,
    created: j.updated_at ?? '',
  }
}

// ---------------------------------------------------------------------------
// Lever (keyless public postings JSON, per company)
// ---------------------------------------------------------------------------

export interface LeverJob {
  id: string
  text: string // the title
  categories?: { location?: string; team?: string; commitment?: string }
  descriptionPlain?: string
  hostedUrl: string
  createdAt?: number // epoch ms
}

export function mapLever(j: LeverJob, company: string): NormalizedJob {
  return {
    id: `lever:${j.id}`,
    source: 'lever',
    title: j.text,
    company,
    location: j.categories?.location ?? '',
    // descriptionPlain is already plain text; strip defensively.
    description: stripHtml(j.descriptionPlain ?? '').slice(0, DESCRIPTION_LIMIT),
    url: j.hostedUrl,
    salaryMin: null,
    salaryMax: null,
    created: j.createdAt ? new Date(j.createdAt).toISOString() : '',
  }
}

// ---------------------------------------------------------------------------
// Hacker News "Who is hiring?" (Algolia API + Claude extraction)
// ---------------------------------------------------------------------------
// The monthly thread is hundreds of freeform comments in a loose "Location |
// Company | Role | ..." format. We prefilter to comments that mention the
// user's query/skill terms, then Claude structures them into job postings —
// genuine unstructured-text extraction the API can't do on its own.

const HN_COMMENT_LIMIT = 1200

export interface AlgoliaStoryHit {
  objectID: string
  title: string
}

export interface HnComment {
  id: number
  text?: string | null
  created_at?: string
}

// Comment text + id, trimmed, that we hand to Claude for extraction.
export interface HnCommentForExtraction {
  id: number
  text: string
}

// What the claude `extract_jobs_from_text` task returns per posting.
export interface HnExtractedJob {
  comment_id: number | string
  title: string
  company: string
  location: string
  url: string
  summary: string
}

// Pick the newest "Ask HN: Who is hiring?" thread, skipping the sibling
// "Who wants to be hired?" / "Freelancer?" posts. Hits are newest-first.
export function pickWhoIsHiringThread(hits: AlgoliaStoryHit[]): AlgoliaStoryHit | null {
  return hits.find((h) => /^ask hn: who is hiring/i.test(h.title)) ?? null
}

// Keep top-level comments that (a) still exist and (b) mention any query/skill
// term; strip HTML and truncate; cap the count so the Claude call stays cheap.
export function prefilterHnComments(
  comments: HnComment[],
  queries: string[],
  skills: string[],
  cap = 20
): HnCommentForExtraction[] {
  const terms = [...queries, ...skills]
    .flatMap((s) => s.toLowerCase().match(/[a-z0-9+#.]+/g) ?? [])
    .filter((t) => t.length > 1)
  const termSet = [...new Set(terms)]

  const out: HnCommentForExtraction[] = []
  for (const c of comments) {
    if (out.length >= cap) break
    if (!c.text) continue
    const text = stripHtml(c.text)
    const hay = text.toLowerCase()
    if (termSet.length > 0 && !termSet.some((t) => hay.includes(t))) continue
    out.push({ id: c.id, text: text.slice(0, HN_COMMENT_LIMIT) })
  }
  return out
}

// ---------------------------------------------------------------------------
// We Work Remotely (real HTML scraping)
// ---------------------------------------------------------------------------
// The only tier that parses raw HTML rather than a JSON/RSS API. Honest
// constraints: Supabase Edge Functions can't run a headless browser, so
// JS-rendered boards (LinkedIn, Indeed) are out of reach here (and prohibit
// scraping anyway). WWR is server-rendered and simple, which makes it the one
// viable real-scrape target. It also publishes an RSS feed at the same path —
// that's the fallback if this markup breaks (and markup WILL break eventually;
// the parser test is what pages us when it does). Description is title+company
// only: pulling real descriptions means an extra fetch per listing, skipped for
// this lowest-priority source, so WWR jobs score on a thinner signal.

// Matches one server-rendered listing block: the unlocked listing anchor, then
// its title span, then its company-name paragraph.
const WWR_LISTING_RE =
  /<a class="listing-link--unlocked" href="(\/remote-jobs\/[^"]+)">[\s\S]*?__title__text">([^<]+)<\/span>[\s\S]*?new-listing__company-name">\s*([^<]+?)\s*(?:<img|<\/p>)/g

export function parseWwrHtml(html: string): NormalizedJob[] {
  const out: NormalizedJob[] = []
  for (const m of html.matchAll(WWR_LISTING_RE)) {
    const [, path, title, company] = m
    const slug = path.replace('/remote-jobs/', '')
    out.push({
      id: `wwr:${slug}`,
      source: 'wwr',
      title: decodeHtmlEntities(title).trim(),
      company: decodeHtmlEntities(company).trim(),
      location: 'Remote',
      // No detail-page fetch — description is the headline only. (Flagged.)
      description: `${decodeHtmlEntities(title).trim()} at ${decodeHtmlEntities(company).trim()}`,
      url: `https://weworkremotely.com${path}`,
      salaryMin: null,
      salaryMax: null,
      created: '',
    })
  }
  return out
}

export function mapHnExtracted(
  extracted: HnExtractedJob[],
  commentsById: Map<number, HnComment>
): NormalizedJob[] {
  return extracted
    .filter((e) => e.title && e.company)
    .map((e) => {
      const commentId = Number(e.comment_id)
      const comment = commentsById.get(commentId)
      return {
        id: `hn:${e.comment_id}`,
        source: 'hn' as const,
        title: e.title,
        company: e.company,
        location: e.location ?? '',
        description: (e.summary ?? '').slice(0, DESCRIPTION_LIMIT),
        // Prefer an apply link Claude found; else the comment permalink.
        url: e.url || `https://news.ycombinator.com/item?id=${e.comment_id}`,
        salaryMin: null,
        salaryMax: null,
        created: comment?.created_at ?? '',
      }
    })
}
