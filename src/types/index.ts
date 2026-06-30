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

export type Profile = {
  id: string
  resume_file_path: string | null
  resume_parsed: ResumeParsed | null
  skills: string[]
  interests: string[]
  location: string | null
  created_at: string
  updated_at: string
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
