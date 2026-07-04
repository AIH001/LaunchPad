import { type ReactNode } from 'react'
import { useJobs } from './useJobs'
import { JobsContext } from './JobsContext'

// Runs the jobs feed once for the whole authed session. The auto-load fires when
// the profile is ready and won't re-run on navigation, so switching tabs and
// coming back shows the already-loaded feed instantly (no re-fetch, no re-score).
export function JobsProvider({ children }: { children: ReactNode }) {
  const value = useJobs()
  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>
}
