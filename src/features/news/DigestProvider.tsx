import { type ReactNode } from 'react'
import { useDigest } from './useDigest'
import { DigestContext } from './DigestContext'

// Holds the daily digest for the whole session so it survives tab switches. The
// digest hydrates from the ai_cache table on first mount and only re-fetches +
// re-curates when the user hits Refresh (see useDigest).
export function DigestProvider({ children }: { children: ReactNode }) {
  const value = useDigest()
  return <DigestContext.Provider value={value}>{children}</DigestContext.Provider>
}
