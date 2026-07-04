import { useContext } from 'react'
import { ProfileContext } from './context'

// Read the shared profile. All the fetch/save logic lives in <ProfileProvider>;
// this just hands consumers the single app-wide instance.
export function useProfile() {
  const ctx = useContext(ProfileContext)
  if (!ctx) {
    throw new Error('useProfile must be used within a <ProfileProvider>')
  }
  return ctx
}

export type { ProfileUpdate } from './context'
