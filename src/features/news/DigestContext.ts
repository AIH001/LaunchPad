import { createContext, useContext } from 'react'
import type { useDigest } from './useDigest'

export type DigestContextValue = ReturnType<typeof useDigest>

export const DigestContext = createContext<DigestContextValue | undefined>(undefined)

// Consume the shared digest. Because state lives in <DigestProvider>, the fetched
// stories and Claude-curated items persist across navigation — returning to the
// tab shows them instantly rather than re-fetching HN and re-running curation.
// The digest also survives browser refresh via the ai_cache DB hydrate.
export function useDigestFeed() {
  const ctx = useContext(DigestContext)
  if (!ctx) {
    throw new Error('useDigestFeed must be used within a <DigestProvider>')
  }
  return ctx
}
