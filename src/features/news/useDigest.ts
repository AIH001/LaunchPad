import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { readAiCache, writeAiCache } from '../../lib/aiCache'
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

// What we persist per user in ai_cache: both tabs' data, so a reload rehydrates
// the instant General feed and the Claude-curated For-you feed without re-fetching
// HN or re-running the curation call.
type DigestCache = { stories: Story[]; items: DigestItem[] }

// How many front-page stories we pull before Claude filters them down.
const FETCH_LIMIT = 30

export function useDigest() {
  const { profile, loading: profileLoading } = useProfile()

  // Raw news feed (fast path, no Claude).
  const [stories, setStories] = useState<Story[]>([])
  const [storiesLoading, setStoriesLoading] = useState(false)
  const [storiesError, setStoriesError] = useState<string | null>(null)

  // Claude-curated "For you" feed (slow path). Built lazily on first open.
  const [items, setItems] = useState<DigestItem[]>([])
  const [curating, setCurating] = useState(false)
  const [curateError, setCurateError] = useState<string | null>(null)
  const [hasCurated, setHasCurated] = useState(false) // true once Claude has run
  // When the shown digest was built (ISO); drives the "updated <ago>" caption.
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  // True during the initial cache read; the screen waits on it before fetching.
  const [hydrating, setHydrating] = useState(true)
  // True once a digest exists (from cache or a completed news load). The
  // DailyDigest screen triggers the first news fetch only when this is false —
  // keeping the fetch lazy even though the provider is always mounted.
  const [hasLoaded, setHasLoaded] = useState(false)
  // Guards the mount hydrate so it runs once per session.
  const initialized = useRef(false)

  // 1) Fetch front-page stories via the news proxy. No Claude — this is what
  // makes the General tab appear instantly. Runs on the first no-cache load and
  // whenever the user hits Refresh.
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
      setHasLoaded(true)
    } catch (e) {
      setStoriesError(e instanceof Error ? e.message : String(e))
      setHasLoaded(true) // don't retry-loop; the screen shows the error + Refresh
    } finally {
      setStoriesLoading(false)
    }
  }, [])

  // 2) Have Claude filter the already-fetched stories to the profile's stack,
  // rank, summarize, and tag. Runs against whatever `stories` are loaded, so the
  // General fetch must finish first.
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
      // Persist both feeds so a reload / tab return rehydrates instantly instead
      // of re-fetching HN and re-running this curation call.
      if (profile) {
        setGeneratedAt(
          await writeAiCache<DigestCache>(profile.id, 'digest', { stories, items: merged })
        )
      }
    } catch (e) {
      setCurateError(e instanceof Error ? e.message : String(e))
    } finally {
      setCurating(false)
    }
  }, [stories, profile])

  // On first profile availability: hydrate the saved digest if one exists
  // (instant, no fetch, no Claude). Does NOT auto-fetch — the DailyDigest screen
  // triggers the first news load on first view, keeping the fetch lazy even
  // though this provider is always mounted. Runs once per session.
  useEffect(() => {
    if (profileLoading || initialized.current) return
    initialized.current = true
    void (async () => {
      if (profile) {
        const entry = await readAiCache<DigestCache>(profile.id, 'digest')
        if (entry) {
          setStories(entry.payload.stories)
          setItems(entry.payload.items)
          setHasCurated(true)
          setGeneratedAt(entry.generatedAt)
          setHasLoaded(true)
        }
      }
      setHydrating(false)
    })()
  }, [profileLoading, profile])

  return {
    stories,
    storiesLoading,
    storiesError,
    reloadNews: loadNews,
    items,
    curating,
    curateError,
    hasCurated,
    generatedAt,
    hydrating,
    hasLoaded,
    curate,
  }
}
