import { useCallback, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../profile'

// A listing from the jobs proxy, plus the Claude-assigned match fields.
// `scoring` is true while this job's score is still being fetched.
export type ScoredJob = {
  id: string
  title: string
  company: string
  location: string
  description: string
  url: string
  salaryMin: number | null
  salaryMax: number | null
  created: string
  score: number | null
  why_fit: string | null
  gaps: string | null
  scoring: boolean
}

type RawJob = Omit<ScoredJob, 'score' | 'why_fit' | 'gaps' | 'scoring'>

// How many listings we fetch + score per search.
const SCORE_LIMIT = 10

export function useJobs() {
  const { profile } = useProfile()
  const [jobs, setJobs] = useState<ScoredJob[]>([])
  const [loading, setLoading] = useState(false) // true only while fetching listings
  const [error, setError] = useState<string | null>(null)

  const search = useCallback(
    async (query: string, location: string) => {
      setLoading(true)
      setError(null)
      setJobs([])

      try {
        // 1) Fetch listings via the jobs proxy. invoke() attaches the user's token.
        const { data: jobsData, error: jobsErr } = await supabase.functions.invoke(
          'jobs',
          { body: { query, location } }
        )
        if (jobsErr) throw new Error(jobsErr.message)

        const listings = ((jobsData?.jobs ?? []) as RawJob[]).slice(0, SCORE_LIMIT)

        // 2) Show the listings immediately, each marked as still scoring.
        setJobs(
          listings.map((j) => ({
            ...j,
            score: null,
            why_fit: null,
            gaps: null,
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
        }

        // 3) Fan out: score each listing in its own call, in parallel. Update
        // each card the moment its score lands — no waiting for the slowest.
        await Promise.all(
          listings.map(async (j) => {
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
                        scoring: false,
                      }
                    : job
                )
              )
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

        // 4) All scored — reorder best-fit first (one final sort).
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

  const scoring = jobs.some((j) => j.scoring)
  return { jobs, loading, scoring, error, search }
}
