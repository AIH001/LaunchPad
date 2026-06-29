import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth'
import { useProfile } from '../profile'
import type { CoverLetter } from '../../types'

export type DraftJob = { title: string; company: string; description?: string }

export function useCoverLetters() {
  const { user } = useAuth()
  const { profile, loading: profileLoading } = useProfile()
  const [letters, setLetters] = useState<CoverLetter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load the user's saved letters (RLS returns only theirs).
  useEffect(() => {
    if (!user) return
    let active = true
    setLoading(true)
    supabase
      .from('cover_letters')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return
        if (error) setError(error.message)
        else setLetters((data ?? []) as CoverLetter[])
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [user])

  // Ask the claude function to draft a letter; returns the body text.
  const draft = useCallback(
    async (job: DraftJob) => {
      const { data, error } = await supabase.functions.invoke('claude', {
        body: {
          task: 'draft_cover_letter',
          job: {
            title: job.title,
            company: job.company,
            description: job.description ?? '',
          },
          profile: {
            summary: profile?.resume_parsed?.summary ?? null,
            skills: profile?.skills ?? [],
          },
        },
      })
      if (error) throw new Error(error.message)
      return (data?.body ?? '') as string
    },
    [profile]
  )

  const save = useCallback(
    async (jobTitle: string, company: string, body: string) => {
      if (!user) throw new Error('Not signed in')
      const { data, error } = await supabase
        .from('cover_letters')
        .insert({ user_id: user.id, job_title: jobTitle, company, body })
        .select()
        .single()
      if (error) throw new Error(error.message)
      setLetters((prev) => [data as CoverLetter, ...prev])
      return data as CoverLetter
    },
    [user]
  )

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from('cover_letters').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    setLetters((prev) => prev.filter((l) => l.id !== id))
  }, [])

  return { letters, loading, error, profileLoading, draft, save, remove }
}
