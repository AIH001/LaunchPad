import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
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
      if (raw.length === 0) return

      const profilePayload = {
        skills: profile.skills ?? [],
        interests: profile.interests ?? [],
        location: profile.location ?? null,
      }

      // 3) Fan out: rate each event in its own call, in parallel. Update each
      //    card the moment its verdict lands — no waiting for the slowest.
      await Promise.all(
        raw.map(async (e) => {
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
            setEvents((prev) =>
              prev.map((ev) =>
                ev.id === e.id
                  ? v
                    ? { ...ev, verdict: v.verdict, take: v.take, tags: v.tags, scoring: false }
                    : { ...ev, scoring: false }
                  : ev
              )
            )
          } catch {
            // Clear this card's spinner even if its scoring call failed.
            setEvents((prev) =>
              prev.map((ev) => (ev.id === e.id ? { ...ev, scoring: false } : ev))
            )
          }
        })
      )
    } catch (err) {
      setError(String(err))
      setLoading(false)
    }
  }, [profile])

  // Load once the profile is ready.
  useEffect(() => {
    if (!profileLoading && profile) {
      load()
    }
  }, [profileLoading, profile, load])

  return { events, loading, error, degradedSources, refresh: load }
}
