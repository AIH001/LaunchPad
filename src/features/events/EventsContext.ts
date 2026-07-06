import { createContext, useContext } from 'react'
import type { useEvents } from './useEvents'

export type EventsContextValue = ReturnType<typeof useEvents>

export const EventsContext = createContext<EventsContextValue | undefined>(undefined)

// Consume the shared events feed. Because state lives in <EventsProvider>, a feed
// fetched + scored once persists across navigation — returning to the tab shows
// it instantly rather than re-fetching and re-scoring (many Claude calls). The
// feed also survives browser refresh via the ai_cache DB hydrate in useEvents.
export function useEventsFeed() {
  const ctx = useContext(EventsContext)
  if (!ctx) {
    throw new Error('useEventsFeed must be used within an <EventsProvider>')
  }
  return ctx
}
