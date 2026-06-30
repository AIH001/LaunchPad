import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../profile'
import type { Event } from '../../types'

type RawEvent = Omit<Event, 'verdict' | 'take' | 'tags' | 'scoring'>

export function useEvents() {
  const { profile, loading: profileLoading } = useProfile()
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!profile) return

    setLoading(true)
    setError(null)
    setEvents([])

    try {
      // 1) Fetch listings from Eventbrite via the events proxy.
      const { data, error: fetchErr } = await supabase.functions.invoke('events', {
        body: {
          location: profile.location ?? '',
          skills: profile.skills ?? [],
        },
      })
      if (fetchErr) throw new Error(fetchErr.message)

      const raw = (data?.events ?? []) as RawEvent[]

      // 2) Show events immediately with a "scoring" flag while Claude evaluates them.
      setEvents(
        raw.map((e) => ({ ...e, verdict: null, take: null, tags: [], scoring: true }))
      )
      setLoading(false)
      if (raw.length === 0) return

      // 3) Ask Claude to rate and explain each event in one batch call.
      const { data: scoreData, error: scoreErr } = await supabase.functions.invoke(
        'claude',
        {
          body: {
            task: 'score_events',
            events: raw,
            profile: {
              skills: profile.skills ?? [],
              interests: profile.interests ?? [],
              location: profile.location ?? null,
            },
          },
        }
      )

      if (scoreErr) {
        // Non-fatal: show events without verdicts rather than hiding the feed.
        setEvents((prev) => prev.map((e) => ({ ...e, scoring: false })))
        return
      }

      const verdicts = (scoreData?.verdicts ?? []) as Array<{
        event_id: string
        verdict: 'worth_it' | 'optional'
        take: string
        tags: string[]
      }>

      setEvents((prev) =>
        prev.map((e) => {
          const v = verdicts.find((v) => v.event_id === e.id)
          return v
            ? { ...e, verdict: v.verdict, take: v.take, tags: v.tags, scoring: false }
            : { ...e, scoring: false }
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

  return { events, loading, error, refresh: load }
}
