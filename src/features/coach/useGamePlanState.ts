import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { readAiCache, writeAiCache } from '../../lib/aiCache'
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

// The game-plan state machine. Deliberately does NOT auto-run Claude: it lives
// inside an always-mounted provider, so auto-running would fire an expensive
// Sonnet call at login. On mount it only does a cheap DB read to hydrate any
// previously-saved plan (survives browser refresh + new logins). The GamePlan
// screen triggers generate() the first time it's viewed *and no cached plan
// exists*; once generated, the plan is persisted and only re-run on the explicit
// Regenerate button.
export function useGamePlanState() {
  const { profile } = useProfile()
  const [plan, setPlan] = useState<GamePlanData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasGenerated, setHasGenerated] = useState(false)
  // When the persisted plan was last built (ISO); drives the "updated <ago>"
  // caption. null until a plan is hydrated or generated.
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  // True during the initial cache read. The screen waits on this before deciding
  // whether to auto-generate, so a cached plan is never clobbered by a fresh run.
  const [hydrating, setHydrating] = useState(true)

  // Hydrate the saved plan once the profile (and thus user id) is known. Cheap
  // read, not a Claude call — safe to run in the always-mounted provider.
  useEffect(() => {
    if (!profile) return
    let cancelled = false
    void (async () => {
      const entry = await readAiCache<GamePlanData>(profile.id, 'game_plan')
      if (cancelled) return
      if (entry) {
        setPlan(entry.payload)
        setGeneratedAt(entry.generatedAt)
        setHasGenerated(true) // suppress the screen's first-view auto-generate
      }
      setHydrating(false)
    })()
    return () => {
      cancelled = true
    }
  }, [profile])

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
      const nextPlan = (data?.plan ?? null) as GamePlanData | null
      setPlan(nextPlan)
      setHasGenerated(true)
      // Persist so it survives refresh/re-login; only Regenerate rebuilds it.
      if (nextPlan) setGeneratedAt(await writeAiCache(profile.id, 'game_plan', nextPlan))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      // Mark generated so the screen shows the error instead of retry-looping.
      setHasGenerated(true)
    } finally {
      setLoading(false)
    }
  }, [profile])

  return { plan, loading, error, hasGenerated, hydrating, generatedAt, regenerate: generate }
}
