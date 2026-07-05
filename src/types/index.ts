// Structured resume data Claude extracts from an uploaded PDF/text file.
export type ResumeParsed = {
  summary: string
  skills: string[]
  education: Array<{ school: string; credential: string; year: string }>
  experience: Array<{
    title: string
    company: string
    dates: string
    highlights: string
  }>
  qualifications: string[]
  years_experience: number
}

// Where the user is in their early-career journey. Optional in the profile — when
// unset the app infers it from the parsed resume (see resolveCareerStage).
export type CareerStage =
  | 'student'
  | 'internship'
  | 'new_grad'
  | 'junior'
  | 'career_switcher'

export type Profile = {
  id: string
  resume_file_path: string | null
  resume_parsed: ResumeParsed | null
  skills: string[]
  interests: string[]
  location: string | null
  target_role: string | null
  career_stage: CareerStage | null
  created_at: string
  updated_at: string
}

// Which aggregator/board a normalized job came from. Each source has a mapper in
// the `jobs` Edge Function that converts its raw payload into the `Job` shape.
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

// The single normalized job shape every source maps into. Source-agnostic and
// free of any AI fields — Claude's match score is layered on separately
// (ScoredJob). NOTE: must stay in sync with `NormalizedJob` in
// supabase/functions/jobs/lib.ts (Deno vs. Vite — can't import across).
export type Job = {
  id: string // ALWAYS `${source}:${externalId}` — globally unique + stable
  source: JobSource
  title: string
  company: string
  location: string // '' or 'Remote' when the source is remote-only
  description: string // plain text (HTML stripped server-side), ~2000 chars
  url: string
  salaryMin: number | null
  salaryMax: number | null
  created: string // ISO 8601; '' if the source doesn't say
}

// A Job enriched with Claude's match verdict, used by the UI.
// `scoring` is true while the Claude call is in flight for this job.
export type ScoredJob = Job & {
  score: number | null
  why_fit: string | null
  gaps: string | null
  // true when the role needs materially more experience than the user's stage —
  // shown as a "Stretch" badge, never used to hide the listing. null = unscored.
  stretch: boolean | null
  scoring: boolean
}

export type SavedJob = {
  id: string
  user_id: string
  job_payload: Record<string, unknown>
  match_score: number | null
  match_reasoning: string | null
  created_at: string
}

export type CoverLetter = {
  id: string
  user_id: string
  job_title: string
  company: string
  body: string
  created_at: string
  updated_at: string
}

// Which aggregator a normalized event came from. Each source has a mapper in the
// `events` Edge Function that converts its raw payload into the `Event` shape.
export type EventSource = 'ticketmaster' | 'luma' | 'meetup'

export type EventLocation = {
  lat: number | null
  lng: number | null
  display: string // human-readable, e.g. "Moscone West · San Francisco, CA"
}

// The single normalized event shape every source maps into. Source-agnostic and
// free of any AI fields — Claude's verdict is layered on separately (ScoredEvent).
export type Event = {
  id: string
  source: EventSource
  title: string
  description: string
  startDate: string // ISO 8601 (UTC)
  endDate: string | null
  location: EventLocation
  url: string
  isVirtual: boolean
  category: string
  imageUrl: string | null
}

// An Event enriched with Claude's "worth attending?" verdict, used by the UI.
// `scoring` is true while the Claude call is in flight for this event.
export type ScoredEvent = Event & {
  verdict: 'worth_it' | 'optional' | null
  take: string | null
  tags: string[]
  scoring: boolean
}
