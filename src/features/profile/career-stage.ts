import type { CareerStage, Profile } from '../../types'

// Human-readable labels for the selector and profile card.
export const CAREER_STAGE_LABELS: Record<CareerStage, string> = {
  student: 'Student',
  internship: 'Seeking internship',
  new_grad: 'New grad',
  junior: 'Junior developer',
  career_switcher: 'Career switcher',
}

// Order the selector renders them in — roughly earliest → latest in the journey.
export const CAREER_STAGE_ORDER: CareerStage[] = [
  'student',
  'internship',
  'new_grad',
  'junior',
  'career_switcher',
]

// A phrase describing the candidate, injected into Claude prompts so scoring and
// coaching reason about the right early-career context.
export function careerStageDescriptor(stage: CareerStage): string {
  switch (stage) {
    case 'student':
      return 'a student seeking an internship or their first role'
    case 'internship':
      return 'seeking an internship'
    case 'new_grad':
      return 'a recent graduate seeking their first full-time role'
    case 'junior':
      return 'a junior developer with limited professional experience (roughly 0-2 years)'
    case 'career_switcher':
      return 'switching into tech from another field, with transferable but limited direct experience'
  }
}

// Resolve the user's career stage: the explicit field wins; otherwise infer it
// from the parsed resume. Inference is a deliberate heuristic over
// years_experience + education — it can misread nonlinear paths (e.g. a career
// switcher with prior senior non-dev experience), which is exactly why the
// explicit field exists as an override. `source` lets the UI show whether the
// stage was set by the user or guessed.
export function resolveCareerStage(
  profile: Pick<Profile, 'career_stage' | 'resume_parsed'> | null | undefined
): { stage: CareerStage; source: 'set' | 'inferred' } {
  if (profile?.career_stage) {
    return { stage: profile.career_stage, source: 'set' }
  }

  const parsed = profile?.resume_parsed
  // No resume to reason about yet — assume the app's core audience.
  if (!parsed) return { stage: 'junior', source: 'inferred' }

  const years = parsed.years_experience ?? 0
  const hasEducation = (parsed.education?.length ?? 0) > 0

  if (years <= 0) {
    // Fresh out of (or still in) school. Education on file reads as a new grad;
    // none reads as a student who hasn't listed it yet.
    return { stage: hasEducation ? 'new_grad' : 'student', source: 'inferred' }
  }

  // Any professional experience puts them at junior for our purposes.
  return { stage: 'junior', source: 'inferred' }
}
