import { describe, it, expect } from 'vitest'
import { resolveCareerStage, careerStageDescriptor } from './career-stage'
import type { Profile, ResumeParsed } from '../../types'

const resume = (over: Partial<ResumeParsed>): ResumeParsed => ({
  summary: '',
  skills: [],
  education: [],
  experience: [],
  qualifications: [],
  years_experience: 0,
  ...over,
})

type Input = Pick<Profile, 'career_stage' | 'resume_parsed'>

describe('resolveCareerStage', () => {
  it('uses the explicit field when set', () => {
    const input: Input = { career_stage: 'career_switcher', resume_parsed: resume({ years_experience: 5 }) }
    expect(resolveCareerStage(input)).toEqual({ stage: 'career_switcher', source: 'set' })
  })

  it('defaults to junior when there is no resume', () => {
    expect(resolveCareerStage({ career_stage: null, resume_parsed: null })).toEqual({
      stage: 'junior',
      source: 'inferred',
    })
  })

  it('infers new_grad for zero experience with education on file', () => {
    const input: Input = {
      career_stage: null,
      resume_parsed: resume({
        years_experience: 0,
        education: [{ school: 'State U', credential: 'BS CS', year: '2026' }],
      }),
    }
    expect(resolveCareerStage(input)).toEqual({ stage: 'new_grad', source: 'inferred' })
  })

  it('infers student for zero experience and no education listed', () => {
    const input: Input = { career_stage: null, resume_parsed: resume({ years_experience: 0 }) }
    expect(resolveCareerStage(input)).toEqual({ stage: 'student', source: 'inferred' })
  })

  it('infers junior once there is any professional experience', () => {
    const input: Input = { career_stage: null, resume_parsed: resume({ years_experience: 1 }) }
    expect(resolveCareerStage(input)).toEqual({ stage: 'junior', source: 'inferred' })
  })

  it('handles a null profile gracefully', () => {
    expect(resolveCareerStage(null)).toEqual({ stage: 'junior', source: 'inferred' })
  })
})

describe('careerStageDescriptor', () => {
  it('returns a non-empty phrase for every stage', () => {
    for (const stage of ['student', 'internship', 'new_grad', 'junior', 'career_switcher'] as const) {
      expect(careerStageDescriptor(stage).length).toBeGreaterThan(0)
    }
  })
})
