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

export type Event = {
  id: string
  title: string
  description: string
  venue: string
  city: string
  dateLocal: string
  url: string
  isFree: boolean
  verdict: 'worth_it' | 'optional' | null
  take: string | null
  tags: string[]
  scoring: boolean
}
