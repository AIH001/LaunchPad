import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { readAiCache, writeAiCache } from '../../lib/aiCache'
import { useProfile } from '../profile'
import type { Event, ScoredEvent } from '../../types'

export function useEvents() {
  const { profile, loading: profileLoading } = useProfile()
  const [events, setEvents] = useState<ScoredEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Sources that failed this load (e.g. ['luma']) — surfaced as a soft notice so
  // the user knows the feed is partial without the whole screen erroring.
  const [degradedSources, setDegradedSources] = useState<string[]>([])
  // When the shown feed was generated (ISO); drives the "updated <ago>" caption.
  // Set both when hydrating from cache and after a fresh load finishes scoring.
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  // True during the initial cache read. The screen waits on this before deciding
  // whether to run the first fetch, so a cached feed is never clobbered.
  const [hydrating, setHydrating] = useState(true)
  // True once a feed exists (from cache or a completed load). The EventsFeed
  // screen triggers the first load only when this is false — keeping the
  // expensive fetch+score lazy even though the provider is always mounted.
  const [hasLoaded, setHasLoaded] = useState(false)
  // Guards the mount hydrate so it runs once per session.
  const initialized = useRef(false)

  // Full fetch + score. Always ignores the cache and overwrites it on success —
  // this is what the Refresh button (and the first-ever load) runs.
  const load = useCallback(async () => {
    if (!profile) return

    setLoading(true)
    setError(null)
    setEvents([])
    setDegradedSources([])

    try {
      // 1) Aggregate the normalized feed from the events Edge Function (fans out
      //    to Ticketmaster + Luma server-side and merges them).
      const { data, error: fetchErr } = await supabase.functions.invoke('events', {
        body: {
          location: profile.location ?? '',
          interests: profile.interests ?? [],
        },
      })
      if (fetchErr) throw new Error(fetchErr.message)

      const raw = (data?.events ?? []) as Event[]
      const sources = (data?.sources ?? {}) as Record<string, 'ok' | 'error'>
      setDegradedSources(Object.entries(sources).filter(([, s]) => s === 'error').map(([n]) => n))

      // 2) Render immediately with a "scoring" flag while Claude evaluates them.
      setEvents(raw.map((e) => ({ ...e, verdict: null, take: null, tags: [], scoring: true })))
      setLoading(false)
      setHasLoaded(true)
      if (raw.length === 0) {
        // Persist the empty result too, so a genuinely-empty feed doesn't re-fetch
        // on every reload.
        setGeneratedAt(await writeAiCache<ScoredEvent[]>(profile.id, 'events', []))
        return
      }

      const profilePayload = {
        skills: profile.skills ?? [],
        interests: profile.interests ?? [],
        location: profile.location ?? null,
      }

      // 3) Fan out: rate each event in its own call, in parallel. Update each
      //    card the moment its verdict lands — no waiting for the slowest. We also
      //    collect the finished cards so we can persist the whole scored feed once.
      const scored = await Promise.all(
        raw.map(async (e): Promise<ScoredEvent> => {
          const base: ScoredEvent = { ...e, verdict: null, take: null, tags: [], scoring: false }
          try {
            const { data, error: scoreErr } = await supabase.functions.invoke('claude', {
              body: {
                task: 'score_events',
                events: [
                  {
                    id: e.id,
                    title: e.title,
                    description: e.description,
                    venue: e.location.display,
                    category: e.category,
                    isVirtual: e.isVirtual,
                  },
                ],
                profile: profilePayload,
              },
            })
            if (scoreErr) throw new Error(scoreErr.message)
            const v = (data?.verdicts ?? [])[0]
            const done: ScoredEvent = v
              ? { ...base, verdict: v.verdict, take: v.take, tags: v.tags }
              : base
            setEvents((prev) => prev.map((ev) => (ev.id === e.id ? done : ev)))
            return done
          } catch {
            // Clear this card's spinner even if its scoring call failed.
            setEvents((prev) => prev.map((ev) => (ev.id === e.id ? base : ev)))
            return base
          }
        })
      )

      // Persist the fully-scored feed so returning to the tab or refreshing the
      // browser rehydrates it instantly instead of re-fetching + re-scoring.
      setGeneratedAt(await writeAiCache<ScoredEvent[]>(profile.id, 'events', scored))
    } catch (err) {
      setError(String(err))
      setLoading(false)
      setHasLoaded(true) // don't retry-loop; the screen shows the error + Refresh
    }
  }, [profile])

  // On first profile availability: hydrate the saved feed if one exists (instant,
  // no fetch, no Claude). Does NOT auto-fetch — the EventsFeed screen triggers the
  // first load on first view, keeping the expensive fetch+score lazy even though
  // this provider is always mounted. Runs once per session.
  useEffect(() => {
    if (profileLoading || !profile || initialized.current) return
    initialized.current = true
    void (async () => {
      const entry = await readAiCache<ScoredEvent[]>(profile.id, 'events')
      if (entry) {
        setEvents(entry.payload)
        setGeneratedAt(entry.generatedAt)
        setHasLoaded(true)
      }
      setHydrating(false)
    })()
  }, [profileLoading, profile])

  return { events, loading, error, degradedSources, generatedAt, hydrating, hasLoaded, refresh: load }
}
