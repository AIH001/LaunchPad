import { describe, it, expect } from 'vitest'
import { deriveQueries } from './derive-queries'
import type { Profile } from '../../types'

type DeriveInput = Pick<Profile, 'target_role' | 'skills' | 'resume_parsed'>

const base: DeriveInput = { target_role: null, skills: [], resume_parsed: null }

describe('deriveQueries', () => {
  it('uses the target role and a top-skill query together', () => {
    expect(
      deriveQueries({ ...base, target_role: 'Frontend Engineer', skills: ['React', 'TypeScript'] })
    ).toEqual(['Frontend Engineer', 'React developer'])
  })

  it('falls back to skills when target role is unset', () => {
    expect(deriveQueries({ ...base, skills: ['Python'] })).toEqual(['Python developer'])
  })

  it('falls back to resume-parsed skills when no explicit skills', () => {
    expect(
      deriveQueries({
        ...base,
        resume_parsed: {
          summary: '',
          skills: ['Go'],
          education: [],
          experience: [],
          qualifications: [],
          years_experience: 0,
        },
      })
    ).toEqual(['Go developer'])
  })

  it('defaults to "software developer" for a bare profile', () => {
    expect(deriveQueries(base)).toEqual(['software developer'])
  })

  it('dedupes case-insensitively, keeping first casing', () => {
    // target role "React Developer" and top-skill query "React developer" collapse.
    expect(
      deriveQueries({ ...base, target_role: 'React Developer', skills: ['React'] })
    ).toEqual(['React Developer'])
  })

  it('caps at two queries', () => {
    expect(
      deriveQueries({ ...base, target_role: 'ML Engineer', skills: ['PyTorch', 'CUDA'] }).length
    ).toBeLessThanOrEqual(2)
  })

  it('prepends an internship qualifier to the target role for students', () => {
    expect(
      deriveQueries({ ...base, target_role: 'Frontend Engineer', skills: ['React'] }, 'student')
    ).toEqual(['internship Frontend Engineer', 'React developer'])
  })

  it('prepends an entry-level qualifier for new grads', () => {
    expect(deriveQueries({ ...base, target_role: 'Backend Engineer' }, 'new_grad')).toEqual([
      'entry level Backend Engineer',
    ])
  })

  it('qualifies the bare fallback query too', () => {
    expect(deriveQueries(base, 'junior')).toEqual(['junior software developer'])
  })

  it('adds no qualifier when stage is null', () => {
    expect(deriveQueries({ ...base, target_role: 'Data Engineer' }, null)).toEqual([
      'Data Engineer',
    ])
  })
})
