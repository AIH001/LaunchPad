import { type ReactNode } from 'react'
import { useEvents } from './useEvents'
import { EventsContext } from './EventsContext'

// Holds the events feed for the whole session so it survives tab switches. The
// feed hydrates from the ai_cache table on first mount and only re-fetches +
// re-scores when the user hits Refresh (see useEvents).
export function EventsProvider({ children }: { children: ReactNode }) {
  const value = useEvents()
  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>
}
