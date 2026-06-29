import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth'
import type { SavedJob } from '../../types'
import type { ScoredJob } from './useJobs'

export function useSavedJobs() {
  const { user } = useAuth()
  const [saved, setSaved] = useState<SavedJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load the user's saved jobs once we know who they are.
  useEffect(() => {
    if (!user) return
    let active = true
    setLoading(true)

    supabase
      .from('saved_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return
        if (error) setError(error.message)
        else setSaved((data ?? []) as SavedJob[])
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [user])

  // Quick lookup: is this external job id already saved?
  const isSaved = useCallback(
    (externalId: string) =>
      saved.some((s) => (s.job_payload as { id?: string }).id === externalId),
    [saved]
  )

  const save = useCallback(
    async (job: ScoredJob) => {
      if (!user) return
      const row = {
        user_id: user.id,
        job_payload: job,
        match_score: job.score,
        match_reasoning: job.why_fit,
      }
      const { data, error } = await supabase
        .from('saved_jobs')
        .insert(row)
        .select()
        .single()
      if (error) {
        setError(error.message)
        return
      }
      setSaved((prev) => [data as SavedJob, ...prev])
    },
    [user]
  )

  // Remove by the external (Adzuna) job id — what the job cards know about.
  const unsave = useCallback(
    async (externalId: string) => {
      const target = saved.find(
        (s) => (s.job_payload as { id?: string }).id === externalId
      )
      if (!target) return
      const { error } = await supabase.from('saved_jobs').delete().eq('id', target.id)
      if (error) {
        setError(error.message)
        return
      }
      setSaved((prev) => prev.filter((s) => s.id !== target.id))
    },
    [saved]
  )

  return { saved, loading, error, isSaved, save, unsave }
}
