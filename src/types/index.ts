export type Profile = {
  id: string
  resume_text: string | null
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
  job_id: string
  body: string
  created_at: string
  updated_at: string
}
