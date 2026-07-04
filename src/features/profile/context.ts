import { createContext } from 'react'
import type { CareerStage, Profile, ResumeParsed } from '../../types'

// A partial update of the editable columns. Partial so different flows can save
// just what they touch — the form saves skills/interests/location, the resume
// upload saves resume_file_path/resume_parsed — without clobbering the rest.
export type ProfileUpdate = Partial<{
  resume_file_path: string | null
  resume_parsed: ResumeParsed | null
  skills: string[]
  interests: string[]
  location: string | null
  target_role: string | null
  career_stage: CareerStage | null
}>

export type ProfileContextValue = {
  profile: Profile | null
  loading: boolean
  error: string | null
  save: (updates: ProfileUpdate) => Promise<{ error?: string; data?: Profile }>
}

// Undefined until a <ProfileProvider> is mounted — useProfile() throws if so, so
// a missing provider is a loud error rather than a silent null.
export const ProfileContext = createContext<ProfileContextValue | undefined>(undefined)
