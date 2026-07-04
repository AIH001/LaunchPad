import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth'
import type { Profile } from '../../types'
import { ProfileContext, type ProfileUpdate } from './context'

// Holds the single, app-wide profile. Mounted once above the authed routes so
// the profile is fetched a single time per session — not re-fetched every time a
// screen mounts. This is what lets the jobs feed and game plan persist across
// navigation instead of reloading on every tab switch.
export function ProfileProvider({ children }: { children: ReactNode }) {
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
    async (updates: ProfileUpdate): Promise<{ error?: string; data?: Profile }> => {
      if (!user) return { error: 'Not signed in' }

      const { data, error } = await supabase
        .from('profiles')
        .upsert({ id: user.id, ...updates })
        .select()
        .single()

      if (error) return { error: error.message }
      setProfile(data as Profile)

      // Cached job match scores are profile-relative, so they're stale the
      // moment the profile changes. Drop this user's cache (fire-and-forget) so
      // the next feed load re-scores against the updated profile.
      void supabase.from('job_scores').delete().eq('user_id', user.id)

      return { data: data as Profile }
    },
    [user]
  )

  return (
    <ProfileContext.Provider value={{ profile, loading, error, save }}>
      {children}
    </ProfileContext.Provider>
  )
}
