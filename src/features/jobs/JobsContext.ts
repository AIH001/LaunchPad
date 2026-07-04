import { createContext, useContext } from 'react'
import type { useJobs } from './useJobs'

// The jobs feed exposes exactly what the useJobs hook returns.
export type JobsContextValue = ReturnType<typeof useJobs>

export const JobsContext = createContext<JobsContextValue | undefined>(undefined)

// Consume the shared feed. Because the state lives in <JobsProvider> (mounted
// above the routes), the feed and its scores survive tab switches instead of
// reloading every time JobsFeed remounts.
export function useJobsFeed() {
  const ctx = useContext(JobsContext)
  if (!ctx) {
    throw new Error('useJobsFeed must be used within a <JobsProvider>')
  }
  return ctx
}
