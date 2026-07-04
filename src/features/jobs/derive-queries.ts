import type { CareerStage, Profile } from '../../types'

// The early-career qualifier we prepend to the target-role query so the feed
// leans toward roles the user can actually land. Plain string logic (no Claude) —
// it just biases the source search terms; Claude's per-job score is still the
// real relevance gate. `null` (or an unknown stage) adds no qualifier.
const STAGE_QUALIFIER: Record<CareerStage, string> = {
  student: 'internship',
  internship: 'internship',
  new_grad: 'entry level',
  junior: 'junior',
  career_switcher: 'junior',
}

// Build the search queries for the proactive job feed from the profile — a mix
// of the user-entered target role and a skills/resume-derived term, so the feed
// works whether or not the user set a target role. Deliberately simple string
// logic (no Claude call) to keep page loads fast; if feed relevance disappoints,
// this is the seam to swap in a `derive_search_queries` Claude task.
export function deriveQueries(
  profile: Pick<Profile, 'target_role' | 'skills' | 'resume_parsed'>,
  stage?: CareerStage | null
): string[] {
  const queries: string[] = []
  const qualifier = stage ? STAGE_QUALIFIER[stage] : undefined

  const target = profile.target_role?.trim()
  if (target) queries.push(qualifier ? `${qualifier} ${target}` : target)

  // A skills-derived query broadens coverage beyond the exact target role. Left
  // unqualified so it stays a wide net if the qualified target query is too narrow.
  const topSkill = profile.skills?.[0] ?? profile.resume_parsed?.skills?.[0]
  if (topSkill) queries.push(`${topSkill} developer`)

  if (queries.length === 0) {
    queries.push(qualifier ? `${qualifier} software developer` : 'software developer')
  }

  // Dedupe case-insensitively, keeping the first casing seen (target role wins
  // over the skills-derived query). Cap at 2 (the jobs fn caps at 3 as an abuse
  // guard, but 2 keeps rate-limited sources light).
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const q of queries) {
    const key = q.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(q)
  }
  return deduped.slice(0, 2)
}
