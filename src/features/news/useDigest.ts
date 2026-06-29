import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../profile'

// A Hacker News story as returned by the `news` Edge Function.
type Story = {
  id: string
  title: string
  url: string
  source: string
  points: number
  comments: number
  author: string
  created: string
}

// A story plus the Claude-generated digest fields, ready to render.
export type DigestItem = Story & {
  summary: string
  relevance: string
  tags: string[]
}

// How many front-page stories we pull before Claude filters them down.
const FETCH_LIMIT = 30

export function useDigest() {
  const { profile } = useProfile()
  const [items, setItems] = useState<DigestItem[]>([])
  const [loading, setLoading] = useState(false) // fetching + summarizing
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setItems([])

    try {
      // 1) Fetch front-page stories via the news proxy.
      const { data: newsData, error: newsErr } = await supabase.functions.invoke(
        'news',
        { body: { limit: FETCH_LIMIT } }
      )
      if (newsErr) throw new Error(newsErr.message)

      const stories = (newsData?.stories ?? []) as Story[]
      if (stories.length === 0) {
        setLoading(false)
        return
      }

      // 2) Have Claude filter to the profile's stack, rank, summarize, and tag.
      const { data: digestData, error: digestErr } = await supabase.functions.invoke(
        'claude',
        {
          body: {
            task: 'summarize_digest',
            profile: { skills: profile?.skills ?? [] },
            stories: stories.map((s) => ({
              id: s.id,
              title: s.title,
              source: s.source,
            })),
          },
        }
      )
      if (digestErr) throw new Error(digestErr.message)

      // 3) Join Claude's ranked subset back to the full story by id. Claude
      // controls the order; we drop any id that didn't come back from the fetch.
      const byId = new Map(stories.map((s) => [s.id, s]))
      type Curated = { id: string; summary: string; relevance: string; tags: string[] }
      const curated = (digestData?.items ?? []) as Curated[]
      const merged = curated
        .map((c) => {
          const story = byId.get(c.id)
          if (!story) return null
          return { ...story, summary: c.summary, relevance: c.relevance, tags: c.tags }
        })
        .filter((x): x is DigestItem => x !== null)

      setItems(merged)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [profile])

  // Auto-load once we have the profile (so the filter reflects their skills).
  useEffect(() => {
    void load()
  }, [load])

  return { items, loading, error, reload: load }
}
