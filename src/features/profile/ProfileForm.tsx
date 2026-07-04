import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useProfile } from './useProfile'
import { useAuth } from '../auth'
import { supabase } from '../../lib/supabase'
import type { CareerStage, ResumeParsed } from '../../types'
import {
  CAREER_STAGE_LABELS,
  CAREER_STAGE_ORDER,
  resolveCareerStage,
} from './career-stage'

function initials(email: string) {
  if (!email) return '?'
  const local = email.split('@')[0]
  const parts = local.split(/[._-]/).filter(Boolean)
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2)).toUpperCase()
}

const LABEL =
  'mb-[10px] block font-mono text-[11px] uppercase tracking-[.07em] text-faint'
const FIELD =
  'w-full rounded-[11px] border border-line-soft2 bg-field px-[14px] py-3 text-[14px] focus:border-faint focus:outline-none'

function ChipEditor({
  values,
  onChange,
  placeholder,
  tone,
}: {
  values: string[]
  onChange: (next: string[]) => void
  placeholder: string
  tone: 'neutral' | 'warm'
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (v && !values.includes(v)) onChange([...values, v])
    setDraft('')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    }
  }
  const chip =
    tone === 'warm'
      ? 'border-ai-line bg-ai text-warm-ink'
      : 'border-line-soft2 bg-chip text-ink'

  return (
    <div className="flex flex-wrap items-center gap-[7px]">
      {values.map((v) => (
        <span
          key={v}
          className={`inline-flex items-center gap-[7px] rounded-full border py-[6px] pl-3 pr-[8px] font-mono text-[12.5px] ${chip}`}
        >
          {v}
          <button
            type="button"
            onClick={() => onChange(values.filter((x) => x !== v))}
            aria-label={`Remove ${v}`}
            className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-[#e0d6c5] text-[11px] text-muted hover:bg-[#d6cab5]"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        placeholder={placeholder}
        className="rounded-full border border-dashed border-[#d2c8b6] bg-transparent px-3 py-[6px] font-mono text-[12.5px] focus:outline-none"
      />
    </div>
  )
}

// Optional career-stage picker. Clicking the active chip clears the selection,
// which hands the decision back to resume inference (resolveCareerStage).
function StageSelector({
  value,
  onChange,
}: {
  value: CareerStage | null
  onChange: (next: CareerStage | null) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-[7px]">
      {CAREER_STAGE_ORDER.map((stage) => {
        const active = value === stage
        return (
          <button
            key={stage}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? null : stage)}
            className={`rounded-full border py-[6px] px-3 font-mono text-[12.5px] transition-colors ${
              active
                ? 'border-accent bg-ai text-warm-ink'
                : 'border-line-soft2 bg-chip text-muted hover:border-faint'
            }`}
          >
            {CAREER_STAGE_LABELS[stage]}
          </button>
        )
      })}
    </div>
  )
}

function ResumeCard({
  parsed,
  busy,
  error,
  onPick,
}: {
  parsed: ResumeParsed | null
  busy: boolean
  error: string | null
  onPick: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".pdf,.txt"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) onPick(f)
        e.target.value = '' // allow re-uploading the same filename
      }}
    />
  )

  if (busy) {
    return (
      <div className="rounded-[18px] border border-line bg-surface p-6">
        <span className={LABEL}>Resume</span>
        <p className="text-[14px] text-muted">
          Uploading and parsing your resume with Claude…
        </p>
      </div>
    )
  }

  if (!parsed) {
    return (
      <div className="rounded-[18px] border border-dashed border-[#d8cdbb] bg-surface p-8 text-center">
        <h3 className="font-display text-[17px] font-semibold text-ink">
          Upload your resume
        </h3>
        <p className="mx-auto mt-2 max-w-[420px] text-[14px] text-muted">
          PDF or plain text. Claude reads it and extracts your skills,
          experience, and education to power matching.
        </p>
        {error && <p className="mt-3 text-[14px] text-[#b4452f]">{error}</p>}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-4 rounded-[11px] bg-accent px-5 py-3 text-[14px] font-semibold text-white shadow-[0_2px_8px_rgba(190,80,40,.22)] transition-colors hover:brightness-95"
        >
          Choose file
        </button>
        {fileInput}
      </div>
    )
  }

  return (
    <div className="rounded-[18px] border border-line bg-surface p-6">
      <div className="mb-3 flex items-center justify-between">
        <span className={`${LABEL} mb-0`}>Resume — parsed by Claude</span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-[10px] border border-line-soft2 px-3 py-[6px] text-[13px] font-medium text-muted transition-colors hover:bg-field"
        >
          Replace
        </button>
        {fileInput}
      </div>
      {error && <p className="mb-3 text-[14px] text-[#b4452f]">{error}</p>}

      <p className="text-[14px] leading-[1.5] text-ink">{parsed.summary}</p>
      <p className="mt-2 font-mono text-[12px] text-faint">
        ~{parsed.years_experience} yrs experience
      </p>

      {parsed.experience.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[.07em] text-faint">
            Experience
          </div>
          <ul className="flex flex-col gap-2">
            {parsed.experience.map((x, i) => (
              <li key={i} className="text-[13.5px]">
                <span className="font-semibold">{x.title}</span> · {x.company}{' '}
                <span className="text-faint">({x.dates})</span>
                <div className="text-[#5a5347]">{x.highlights}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {parsed.education.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[.07em] text-faint">
            Education
          </div>
          <ul className="flex flex-col gap-1">
            {parsed.education.map((e, i) => (
              <li key={i} className="text-[13.5px]">
                <span className="font-semibold">{e.credential}</span> · {e.school}{' '}
                <span className="text-faint">({e.year})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function ProfileForm() {
  const { profile, loading, save } = useProfile()
  const { user } = useAuth()
  const email = user?.email ?? ''
  const name = email ? email.split('@')[0] : 'You'

  const [skills, setSkills] = useState<string[]>([])
  const [interests, setInterests] = useState<string[]>([])
  const [location, setLocation] = useState('')
  const [targetRole, setTargetRole] = useState('')
  const [careerStage, setCareerStage] = useState<CareerStage | null>(null)
  const [parsed, setParsed] = useState<ResumeParsed | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resumeBusy, setResumeBusy] = useState(false)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!profile) return
    setSkills(profile.skills ?? [])
    setInterests(profile.interests ?? [])
    setLocation(profile.location ?? '')
    setTargetRole(profile.target_role ?? '')
    setCareerStage(profile.career_stage ?? null)
    setParsed(profile.resume_parsed ?? null)
  }, [profile])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 1900)
    return () => clearTimeout(t)
  }, [toast])

  const handleResume = async (file: File) => {
    if (!user) return
    setResumeBusy(true)
    setResumeError(null)
    try {
      const ext = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'txt'
      const path = `${user.id}/resume.${ext}`

      // 1) Store the file (private bucket, RLS-scoped to this user's folder).
      const { error: upErr } = await supabase.storage
        .from('resumes')
        .upload(path, file, { upsert: true })
      if (upErr) throw new Error(upErr.message)

      // 2) Parse it server-side via the claude function (reads from storage).
      const { data, error: pErr } = await supabase.functions.invoke('claude', {
        body: { task: 'parse_resume', path },
      })
      if (pErr) throw new Error(pErr.message)
      const parsedData = data?.parsed as ResumeParsed

      // 3) Merge Claude's extracted skills into the editable chips and persist.
      const mergedSkills = Array.from(
        new Set([...skills, ...(parsedData.skills ?? [])])
      )
      setParsed(parsedData)
      setSkills(mergedSkills)
      await save({
        resume_file_path: path,
        resume_parsed: parsedData,
        skills: mergedSkills,
      })
      setToast('Resume uploaded and parsed')
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : String(err))
    } finally {
      setResumeBusy(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const result = await save({
      skills,
      interests,
      location: location.trim() || null,
      target_role: targetRole.trim() || null,
      career_stage: careerStage,
    })
    if (result.error) setError(result.error)
    else setToast('Profile saved — synced across your devices')
    setSaving(false)
  }

  if (loading) return <p className="text-[14px] text-muted">Loading your profile…</p>

  // Reflect what the rest of the app will actually use — the explicit stage if
  // set, otherwise the one inferred from the resume.
  const resolved = resolveCareerStage({ career_stage: careerStage, resume_parsed: parsed })

  return (
    <div className="max-w-[740px]">
      {/* Identity card */}
      <div className="flex items-center gap-[18px] rounded-[18px] border border-line bg-surface px-6 py-[22px]">
        <div className="flex h-[62px] w-[62px] flex-none items-center justify-center rounded-full bg-ink font-display text-[24px] font-semibold text-app">
          {initials(email)}
        </div>
        <div className="min-w-0">
          <div className="font-display text-[22px] font-semibold">{name}</div>
          <div className="text-[14px] text-muted">
            {targetRole || CAREER_STAGE_LABELS[resolved.stage]}
          </div>
          <div className="mt-[2px] font-mono text-[12px] text-faint">
            {location || 'Location not set'} · {email}
          </div>
        </div>
      </div>

      {/* Resume upload + parsed view */}
      <div className="mt-4">
        <ResumeCard
          parsed={parsed}
          busy={resumeBusy}
          error={resumeError}
          onPick={handleResume}
        />
      </div>

      {/* Editable fields */}
      <form
        onSubmit={handleSubmit}
        className="mt-4 flex flex-col gap-5 rounded-[18px] border border-line bg-surface p-6"
      >
        <div>
          <span className={LABEL}>Career stage · optional</span>
          <StageSelector value={careerStage} onChange={setCareerStage} />
          <p className="mt-[10px] text-[13px] text-faint">
            {careerStage
              ? 'Claude tailors matches and your game plan to this stage.'
              : `Leave blank and we'll read it from your resume — currently reading you as ${CAREER_STAGE_LABELS[resolved.stage]}.`}
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="target_role" className={LABEL}>
              Target role
            </label>
            <input
              id="target_role"
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value)}
              placeholder="Frontend developer"
              className={FIELD}
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <label htmlFor="location" className={LABEL}>
              Location
            </label>
            <input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Seattle, WA"
              className={FIELD}
            />
          </div>
        </div>

        <div>
          <span className={LABEL}>Skills</span>
          <ChipEditor
            values={skills}
            onChange={setSkills}
            placeholder="add skill + ↵"
            tone="neutral"
          />
        </div>

        <div>
          <span className={LABEL}>Interests</span>
          <ChipEditor
            values={interests}
            onChange={setInterests}
            placeholder="add interest + ↵"
            tone="warm"
          />
        </div>

        {error && <p className="text-[14px] text-[#b4452f]">{error}</p>}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={saving}
            className="rounded-[11px] bg-accent px-5 py-3 text-[14px] font-semibold text-white shadow-[0_2px_8px_rgba(190,80,40,.22)] transition-colors hover:brightness-95 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save profile'}
          </button>
          <span className="text-[13px] text-faint">
            Stored on your account — follows you across devices.
          </span>
        </div>
      </form>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[11px] bg-ink px-5 py-3 text-[13.5px] font-medium text-app shadow-[0_8px_28px_rgba(0,0,0,.22)]">
          {toast}
        </div>
      )}
    </div>
  )
}
