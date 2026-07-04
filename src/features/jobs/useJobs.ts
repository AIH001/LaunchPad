import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../profile'
import { resolveCareerStage } from '../profile/career-stage'
import { deriveQueries } from './derive-queries'
import type { Job, ScoredJob } from '../../types'

// Re-export so feature-internal imports keep working.
export type { ScoredJob }

// How many listings we fetch + score per load. Each scored job is one Haiku
// call, so this bounds cost/latency; the job_scores cache makes repeat visits
// cheap. More sources → a slightly deeper feed than the original 10.
const SCORE_LIMIT = 15

export function useJobs() {
  const { profile, loading: profileLoading } = useProfile()
  const [jobs, setJobs] = useState<ScoredJob[]>([])
  const [loading, setLoading] = useState(false) // true only while fetching listings
  const [error, setError] = useState<string | null>(null)
  // Sources that failed this load (e.g. ['adzuna']) — surfaced as a soft notice
  // so the user knows the feed is partial without the whole screen erroring.
  // 'skipped' sources (deliberately unconfigured) are NOT included.
  const [degradedSources, setDegradedSources] = useState<string[]>([])

  // The core loader: fetch the aggregated feed for one or more queries, render
  // immediately, then fan out per-job Claude scoring. Both the proactive
  // auto-load and the manual search funnel through here.
  const load = useCallback(
    async (queries: string[], location: string) => {
      setLoading(true)
      setError(null)
      setJobs([])
      setDegradedSources([])

      try {
        // 1) Fetch the aggregated multi-source feed. invoke() attaches the
        //    user's token.
        const { data: jobsData, error: jobsErr } = await supabase.functions.invoke(
          'jobs',
          { body: { queries, location, skills: profile?.skills ?? [] } }
        )
        if (jobsErr) throw new Error(jobsErr.message)

        const sources = (jobsData?.sources ?? {}) as Record<
          string,
          'ok' | 'error' | 'skipped'
        >
        setDegradedSources(
          Object.entries(sources)
            .filter(([, s]) => s === 'error')
            .map(([n]) => n)
        )

        const listings = ((jobsData?.jobs ?? []) as Job[]).slice(0, SCORE_LIMIT)

        // 2) Show the listings immediately, each marked as still scoring.
        setJobs(
          listings.map((j) => ({
            ...j,
            score: null,
            why_fit: null,
            gaps: null,
            stretch: null,
            scoring: true,
          }))
        )
        setLoading(false)
        if (listings.length === 0) return

        const profilePayload = {
          summary: profile?.resume_parsed?.summary ?? null,
          skills: profile?.skills ?? [],
          interests: profile?.interests ?? [],
          location: profile?.location ?? null,
          // Early-career signal: the resolved stage (explicit or inferred) plus
          // the resume's experience estimate give the scorer the seniority
          // context it needs to judge fit — and to flag over-reach roles.
          career_stage: resolveCareerStage(profile).stage,
          years_experience: profile?.resume_parsed?.years_experience ?? null,
        }
        const userId = profile?.id ?? null

        // 3) Apply cached scores instantly (RLS scopes the read to this user),
        // so only cache misses go to Claude. Skip the cache entirely if we don't
        // have a user id (manual search before the profile loaded).
        const cached = new Map<
          string,
          {
            score: number
            why_fit: string | null
            gaps: string | null
            stretch: boolean | null
          }
        >()
        if (userId) {
          const { data: cachedRows } = await supabase
            .from('job_scores')
            .select('job_id, score, why_fit, gaps, stretch')
            .in(
              'job_id',
              listings.map((j) => j.id)
            )
          for (const row of cachedRows ?? []) {
            cached.set(row.job_id as string, {
              score: row.score as number,
              why_fit: (row.why_fit as string | null) ?? null,
              gaps: (row.gaps as string | null) ?? null,
              stretch: (row.stretch as boolean | null) ?? null,
            })
          }
          if (cached.size > 0) {
            setJobs((prev) =>
              prev.map((job) => {
                const c = cached.get(job.id)
                return c ? { ...job, ...c, scoring: false } : job
              })
            )
          }
        }

        // 4) Fan out: score each cache-miss listing in its own call, in
        // parallel. Update each card the moment its score lands — no waiting for
        // the slowest — and write the score back to the cache (fire-and-forget).
        const misses = listings.filter((j) => !cached.has(j.id))
        await Promise.all(
          misses.map(async (j) => {
            try {
              const { data, error: scoreErr } = await supabase.functions.invoke(
                'claude',
                {
                  body: {
                    task: 'score_jobs',
                    profile: profilePayload,
                    jobs: [
                      {
                        id: j.id,
                        title: j.title,
                        company: j.company,
                        location: j.location,
                        description: j.description,
                      },
                    ],
                  },
                }
              )
              if (scoreErr) throw new Error(scoreErr.message)
              const s = (data?.scores ?? [])[0]
              setJobs((prev) =>
                prev.map((job) =>
                  job.id === j.id
                    ? {
                        ...job,
                        score: s?.score ?? null,
                        why_fit: s?.why_fit ?? null,
                        gaps: s?.gaps ?? null,
                        stretch: s?.stretch ?? null,
                        scoring: false,
                      }
                    : job
                )
              )
              // Cache the score for next time. Fire-and-forget — a failed write
              // just means we re-score this job on the next visit.
              if (userId && typeof s?.score === 'number') {
                void supabase.from('job_scores').upsert({
                  user_id: userId,
                  job_id: j.id,
                  score: s.score,
                  why_fit: s.why_fit ?? null,
                  gaps: s.gaps ?? null,
                  stretch: s.stretch ?? null,
                })
              }
            } catch {
              // Clear this card's spinner even if its scoring call failed.
              setJobs((prev) =>
                prev.map((job) =>
                  job.id === j.id ? { ...job, scoring: false } : job
                )
              )
            }
          })
        )

        // 5) All scored — reorder best-fit first (one final sort).
        setJobs((prev) =>
          [...prev].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      }
    },
    [profile]
  )

  // Manual search override: the form supplies a single typed query.
  const search = useCallback(
    (query: string, location: string) => load([query], location),
    [load]
  )

  // Proactive feed: once the profile is loaded, auto-load recommendations from
  // it — no search required. Re-fires when the profile changes (e.g. after the
  // user edits their target role/skills), which is desirable since scores are
  // profile-relative. Mirrors the events feature's auto-load.
  useEffect(() => {
    if (!profileLoading && profile) {
      load(deriveQueries(profile, resolveCareerStage(profile).stage), profile.location ?? '')
    }
  }, [profileLoading, profile, load])

  const scoring = jobs.some((j) => j.scoring)
  return { jobs, loading, scoring, error, degradedSources, search }
}
