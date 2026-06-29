import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth'
import type { Profile } from '../../types'

// The editable slice of a profile — everything except the server-managed
// columns (id comes from the auth user; timestamps are set by the DB).
export type ProfileInput = {
  resume_text: string | null
  skills: string[]
  interests: string[]
  location: string | null
}

export function useProfile() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // READ: load the current user's profile once we know who they are.
  // .maybeSingle() returns one row OR null (no error) — perfect for a profile
  // that may not exist yet. (.single() would error on zero rows.)
  useEffect(() => {
    if (!user) return
    let active = true // guards against setting state after unmount
    setLoading(true)

    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        if (error) setError(error.message)
        else setProfile(data as Profile | null)
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [user])

  // WRITE: upsert = insert if missing, update if present. We don't know or care
  // whether this is the user's first save. RLS makes this safe: the insert/update
  // policies both require id = auth.uid(), so a user can only write their own row.
  const save = useCallback(
    async (input: ProfileInput) => {
      if (!user) return { error: 'Not signed in' }

      const { data, error } = await supabase
        .from('profiles')
        .upsert({ id: user.id, ...input })
        .select()
        .single()

      if (error) return { error: error.message }
      setProfile(data as Profile)
      return { data: data as Profile }
    },
    [user]
  )

  return { profile, loading, error, save }
}
