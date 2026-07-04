import { useCallback, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../profile'
import { resolveCareerStage } from '../profile/career-stage'

// Claude's synthesized route to the user's first (or next) role.
export type GamePlanData = {
  standing: string
  priority_gaps: Array<{ skill: string; why: string; how: string }>
  next_actions: string[]
  encouragement: string
}

// How many cached match-gaps we feed Claude to ground the plan in the user's real
// job feed. Enough to reveal recurring themes without bloating the prompt.
const MATCH_GAP_LIMIT = 30

// The game-plan state machine. Deliberately does NOT auto-run: it lives inside
// an always-mounted provider, so auto-running would fire an expensive Sonnet call
// at login. The GamePlan screen triggers generate() the first time it's viewed,
// and because this state persists in the provider, returning to the tab shows the
// existing plan instead of regenerating.
export function useGamePlanState() {
  const { profile } = useProfile()
  const [plan, setPlan] = useState<GamePlanData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasGenerated, setHasGenerated] = useState(false)

  const generate = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    setError(null)
    try {
      // Ground the plan in the gaps Claude already flagged across this user's
      // scored jobs (RLS scopes the read to them). Best-effort — the plan still
      // works from the profile alone if the cache is empty or the read fails.
      let matchGaps: string[] = []
      const { data: gapRows } = await supabase
        .from('job_scores')
        .select('gaps')
        .eq('user_id', profile.id)
        .not('gaps', 'is', null)
        .limit(MATCH_GAP_LIMIT)
      matchGaps = (gapRows ?? [])
        .map((r) => (r as { gaps: string | null }).gaps)
        .filter((g): g is string => Boolean(g))

      const { data, error: fnErr } = await supabase.functions.invoke('claude', {
        body: {
          task: 'game_plan',
          profile: {
            summary: profile.resume_parsed?.summary ?? null,
            skills: profile.skills ?? [],
            interests: profile.interests ?? [],
            target_role: profile.target_role ?? null,
            career_stage: resolveCareerStage(profile).stage,
            years_experience: profile.resume_parsed?.years_experience ?? null,
            education: profile.resume_parsed?.education ?? [],
          },
          match_gaps: matchGaps,
        },
      })
      if (fnErr) throw new Error(fnErr.message)
      setPlan((data?.plan ?? null) as GamePlanData | null)
      setHasGenerated(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      // Mark generated so the screen shows the error instead of retry-looping.
      setHasGenerated(true)
    } finally {
      setLoading(false)
    }
  }, [profile])

  return { plan, loading, error, hasGenerated, regenerate: generate }
}
