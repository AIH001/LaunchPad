import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../profile'

// A Hacker News story as returned by the `news` Edge Function. This is the raw
// feed — no Claude involved — and powers the instant "General" tab.
export type Story = {
  id: string
  title: string
  url: string
  source: string
  points: number
  comments: number
  author: string
  created: string
}

// A story plus the Claude-generated digest fields, rendered on the "For you" tab.
export type DigestItem = Story & {
  summary: string
  relevance: string
  tags: string[]
}

// How many front-page stories we pull before Claude filters them down.
const FETCH_LIMIT = 30

export function useDigest() {
  const { profile } = useProfile()

  // Raw news feed (fast path, no Claude). Loads on mount.
  const [stories, setStories] = useState<Story[]>([])
  const [storiesLoading, setStoriesLoading] = useState(false)
  const [storiesError, setStoriesError] = useState<string | null>(null)

  // Claude-curated "For you" feed (slow path). Built lazily on first open.
  const [items, setItems] = useState<DigestItem[]>([])
  const [curating, setCurating] = useState(false)
  const [curateError, setCurateError] = useState<string | null>(null)
  const [hasCurated, setHasCurated] = useState(false) // true once Claude has run

  // 1) Fetch front-page stories via the news proxy. No Claude — this is what
  // makes the General tab appear instantly.
  const loadNews = useCallback(async () => {
    setStoriesLoading(true)
    setStoriesError(null)
    // A fresh feed invalidates the previous Claude curation — drop it so "For
    // you" re-curates against the new stories next time it's viewed.
    setHasCurated(false)
    setItems([])
    try {
      const { data, error } = await supabase.functions.invoke('news', {
        body: { limit: FETCH_LIMIT },
      })
      if (error) throw new Error(error.message)
      setStories((data?.stories ?? []) as Story[])
    } catch (e) {
      setStoriesError(e instanceof Error ? e.message : String(e))
    } finally {
      setStoriesLoading(false)
    }
  }, [])

  // 2) Have Claude filter the already-fetched stories to the profile's stack,
  // rank, summarize, and tag. Runs against whatever `stories` are loaded, so the
  // General fetch must finish first (it does — it kicks off on mount).
  const curate = useCallback(async () => {
    if (stories.length === 0) return
    setCurating(true)
    setCurateError(null)
    try {
      const { data, error } = await supabase.functions.invoke('claude', {
        body: {
          task: 'summarize_digest',
          profile: { skills: profile?.skills ?? [] },
          stories: stories.map((s) => ({
            id: s.id,
            title: s.title,
            source: s.source,
          })),
        },
      })
      if (error) throw new Error(error.message)

      // Join Claude's ranked subset back to the full story by id. Claude controls
      // the order; we drop any id that didn't come back from the fetch.
      const byId = new Map(stories.map((s) => [s.id, s]))
      type Curated = { id: string; summary: string; relevance: string; tags: string[] }
      const curated = (data?.items ?? []) as Curated[]
      const merged = curated
        .map((c) => {
          const story = byId.get(c.id)
          if (!story) return null
          return { ...story, summary: c.summary, relevance: c.relevance, tags: c.tags }
        })
        .filter((x): x is DigestItem => x !== null)

      setItems(merged)
      setHasCurated(true)
    } catch (e) {
      setCurateError(e instanceof Error ? e.message : String(e))
    } finally {
      setCurating(false)
    }
  }, [stories, profile])

  // Fetch the raw feed once on mount. Curation is triggered by the UI when the
  // "For you" tab is first opened (see DailyDigest), not here.
  useEffect(() => {
    void loadNews()
  }, [loadNews])

  return {
    stories,
    storiesLoading,
    storiesError,
    reloadNews: loadNews,
    items,
    curating,
    curateError,
    hasCurated,
    curate,
  }
}
