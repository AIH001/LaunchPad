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
  | 'ashby'
  | 'smartrecruiters'
  | 'workable'
  | 'simplify'

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
  let timer: number | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  // Clear the timer once the race settles — otherwise the fast path leaves it
  // pending for the full `ms` (Deno's test leak sanitizer rightly flags this).
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
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

// Ingest-time relevance heuristics (used by the background worker, not the live
// feed). When ingesting a whole company board there's no user query to filter
// against, so these keep the jobs table focused on tech / early-career roles
// instead of storing every sales/HR/ops listing.

const TECH_ROLE_RE =
  /\b(engineer|engineering|developer|programmer|software|frontend|front[- ]?end|backend|back[- ]?end|full[- ]?stack|data|machine learning|ml|ai|devops|sre|mobile|ios|android|web|qa|security|infrastructure|platform|cloud|firmware|hardware|systems)\b/i

const EARLY_CAREER_RE =
  /\b(intern|internship|junior|jr|entry[- ]?level|new[- ]?grad|graduate|associate|apprentice|trainee|early[- ]?career|campus|co-?op)\b/i

// Seniority markers that disqualify a role from the early-career flag. Matched
// against the TITLE only (a description often mentions "you'll work with senior
// engineers" without the role itself being senior).
const SENIOR_ROLE_RE =
  /\b(senior|sr|staff|principal|lead|director|vp|head of|manager|architect|expert)\b/i

// Is this title a tech role at all? Used to drop non-eng roles from big ATS
// boards at ingest.
export function isTechRole(title: string): boolean {
  return TECH_ROLE_RE.test(title)
}

// Best-effort early-career signal, stored on the jobs row. True when the posting
// explicitly reads early-career, or when it's an unqualified tech IC role with no
// seniority marker (plausibly open to early-career candidates). The Claude
// per-user match score remains the real gate — this is just a coarse filter/sort
// signal. (Honest heuristic; a Claude classifier is the deferred upgrade.)
export function isEarlyCareer(title: string, description = ''): boolean {
  if (EARLY_CAREER_RE.test(`${title} ${description}`)) return true
  if (SENIOR_ROLE_RE.test(title)) return false
  return isTechRole(title)
}

// Turn the (<=2) derived search queries into a Postgres websearch_to_tsquery
// string: unique significant word tokens OR'd together, so the DB-backed feed is
// broad and the Claude per-user score does the fine ranking. Returns '' when
// there are no usable terms — the caller then skips the text filter and returns
// recent early-career jobs instead of nothing.
export function toWebsearchQuery(queries: string[]): string {
  const stop = new Set(['the', 'and', 'or', 'a', 'an', 'of', 'in', 'for', 'to', 'with'])
  const terms = new Set<string>()
  for (const q of queries) {
    for (const t of q.toLowerCase().match(/[a-z0-9+#.]+/g) ?? []) {
      if (t.length > 1 && !stop.has(t)) terms.add(t)
    }
  }
  return [...terms].join(' or ')
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
// Ashby (keyless public job-board JSON, per company)
// ---------------------------------------------------------------------------
// Shape confirmed live against api.ashbyhq.com/posting-api/job-board/ashby —
// location is a plain string (no nested address object needed), and both
// jobUrl and applyUrl are present; jobUrl is the listing page.

export interface AshbyJob {
  id: string
  title: string
  location?: string
  publishedAt?: string
  jobUrl: string
  descriptionHtml?: string
}

export function mapAshby(j: AshbyJob, company: string): NormalizedJob {
  return {
    id: `ashby:${j.id}`,
    source: 'ashby',
    title: j.title,
    company,
    location: j.location ?? '',
    description: stripHtml(j.descriptionHtml ?? '').slice(0, DESCRIPTION_LIMIT),
    url: j.jobUrl,
    salaryMin: null, // Ashby's compensation field is a free-text summary when present — dropped, same tradeoff as Remotive.
    salaryMax: null,
    created: j.publishedAt ?? '',
  }
}

// ---------------------------------------------------------------------------
// SmartRecruiters (keyless public postings JSON, per company)
// ---------------------------------------------------------------------------
// Shape confirmed live against api.smartrecruiters.com/v1/companies/Visa/postings.
// The list endpoint has no description field at all (unlike Greenhouse's
// ?content=true) — a real one needs a second per-posting fetch, which we're
// deliberately not doing to avoid N+1 fan-out on top of the per-company one.
// Description is thin (title + company) until proven worth the extra fetch.
// `ref` is an api.smartrecruiters.com URL (JSON, not a candidate-facing page);
// the public apply page is jobs.smartrecruiters.com/{companyIdentifier}/{id}
// (confirmed live to resolve).

export interface SmartRecruitersJob {
  id: string
  name: string
  location?: { city?: string; region?: string; country?: string; fullLocation?: string }
  releasedDate?: string
}

export function mapSmartRecruiters(j: SmartRecruitersJob, companyIdentifier: string): NormalizedJob {
  return {
    id: `smartrecruiters:${j.id}`,
    source: 'smartrecruiters',
    title: j.name,
    company: companyIdentifier,
    location: j.location?.fullLocation ?? '',
    description: `${j.name} at ${companyIdentifier}`,
    url: `https://jobs.smartrecruiters.com/${companyIdentifier}/${j.id}`,
    salaryMin: null,
    salaryMax: null,
    created: j.releasedDate ?? '',
  }
}

// ---------------------------------------------------------------------------
// Workable (keyless public widget JSON, per company)
// ---------------------------------------------------------------------------
// NOTE: unlike Ashby/SmartRecruiters above, this shape is NOT confirmed
// against a live example with open postings (every real account tried had
// zero current jobs) — it's built from Workable's own widget/API docs
// (shortcode, title, url, location, state fields). VERIFY against a live
// account with open roles before relying on this in production. `location` is
// handled defensively since its exact sub-shape wasn't observable live.

export interface WorkableJob {
  title: string
  shortcode: string
  url?: string
  location?: string | { location_str?: string; city?: string; country?: string }
  published_on?: string
}

function workableLocationText(loc: WorkableJob['location']): string {
  if (!loc) return ''
  if (typeof loc === 'string') return loc
  return loc.location_str ?? [loc.city, loc.country].filter(Boolean).join(', ')
}

export function mapWorkable(j: WorkableJob, account: string): NormalizedJob {
  return {
    id: `workable:${j.shortcode}`,
    source: 'workable',
    title: j.title,
    company: account,
    location: workableLocationText(j.location),
    description: `${j.title} at ${account}`,
    url: j.url ?? `https://apply.workable.com/${account}/j/${j.shortcode}/`,
    salaryMin: null,
    salaryMax: null,
    created: j.published_on ?? '',
  }
}

// ---------------------------------------------------------------------------
// SimplifyJobs Summer2026-Internships (community-maintained GitHub README —
// real HTML scraping, same risk tier as WWR)
// ---------------------------------------------------------------------------
// The README's role tables are raw HTML <table> markup embedded in the
// markdown (confirmed live), not markdown pipe tables — so this parses <tr>/
// <td> blocks with regexes, mirroring parseWwrHtml's approach rather than a
// full HTML parser. Quirks handled, all confirmed against the live file:
//  - Consecutive roles at the same company reuse a bare "↳" in the company
//    cell instead of repeating the name — must carry the last company forward
//    or these rows would silently attribute to "Unknown".
//  - The location cell is sometimes a <details><summary>N locations</summary>
//    list rather than plain text — we surface just the summary text.
//  - The application cell has two links (the real apply link, then a
//    simplify.jobs tracking link) — we take the one whose <img alt="Apply">,
//    falling back to the first href if that marker ever changes.
//  - The repo pulls closed listings out into a separate README-Inactive.md
//    file rather than marking them 🔒 inline (confirmed: no inline 🔒 in the
//    live table body), but we still defensively skip any row that does
//    contain 🔒, in case that changes.
//  - The "Age" column (e.g. "3d") has no absolute date — left as created: ''
//    rather than guessing a year, same honest tradeoff as Remotive/Jooble
//    dropping free-text salary.

const SIMPLIFY_ROW_RE = /<tr>([\s\S]*?)<\/tr>/g
const SIMPLIFY_CELL_RE = /<td>([\s\S]*?)<\/td>/g

export function parseSimplifyReadme(markdown: string): NormalizedJob[] {
  const out: NormalizedJob[] = []
  let lastCompany = ''

  for (const rowMatch of markdown.matchAll(SIMPLIFY_ROW_RE)) {
    const cells = [...rowMatch[1].matchAll(SIMPLIFY_CELL_RE)].map((m) => m[1])
    if (cells.length !== 5) continue // not a data row (e.g. the <thead> row uses <th>, not <td>)
    const [companyCell, roleCell, locationCell, applicationCell] = cells

    if (companyCell.includes('🔒') || applicationCell.includes('🔒')) continue

    const companyText = stripHtml(companyCell).trim()
    const company = companyText === '↳' || companyText === '' ? lastCompany : companyText
    if (!company) continue
    lastCompany = company

    const title = stripHtml(roleCell).trim()
    if (!title) continue

    const detailsSummary = locationCell.match(/<summary>([\s\S]*?)<\/summary>/)
    const location = stripHtml(detailsSummary ? detailsSummary[1] : locationCell).trim()

    const applyLink =
      applicationCell.match(/<a href="(https?:\/\/[^"]+)"[^>]*>\s*<img[^>]*alt="Apply"/) ??
      applicationCell.match(/href="(https?:\/\/[^"]+)"/)
    if (!applyLink) continue // no working apply link — nothing worth surfacing

    out.push({
      id: `simplify:${applyLink[1]}`,
      source: 'simplify',
      title,
      company,
      location,
      description: `${title} at ${company}`,
      url: applyLink[1],
      salaryMin: null,
      salaryMax: null,
      created: '',
    })
  }

  return out
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
