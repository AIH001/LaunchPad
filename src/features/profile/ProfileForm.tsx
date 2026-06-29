import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useProfile } from './useProfile'
import { useAuth } from '../auth'

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

// A reusable add-on-Enter / remove chip editor for a string[] field.
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

export function ProfileForm() {
  const { profile, loading, save } = useProfile()
  const { user } = useAuth()
  const email = user?.email ?? ''
  const name = email ? email.split('@')[0] : 'You'

  const [resume, setResume] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [interests, setInterests] = useState<string[]>([])
  const [location, setLocation] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  // Seed the form once the profile loads.
  useEffect(() => {
    if (!profile) return
    setResume(profile.resume_text ?? '')
    setSkills(profile.skills ?? [])
    setInterests(profile.interests ?? [])
    setLocation(profile.location ?? '')
  }, [profile])

  // Auto-dismiss the toast.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 1900)
    return () => clearTimeout(t)
  }, [toast])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const result = await save({
      resume_text: resume.trim() || null,
      skills,
      interests,
      location: location.trim() || null,
    })
    if (result.error) setError(result.error)
    else setToast('Profile saved — synced across your devices')
    setSaving(false)
  }

  if (loading) return <p className="text-[14px] text-muted">Loading your profile…</p>

  return (
    <div className="max-w-[740px]">
      {/* Identity card */}
      <div className="flex items-center gap-[18px] rounded-[18px] border border-line bg-surface px-6 py-[22px]">
        <div className="flex h-[62px] w-[62px] flex-none items-center justify-center rounded-full bg-ink font-display text-[24px] font-semibold text-app">
          {initials(email)}
        </div>
        <div className="min-w-0">
          <div className="font-display text-[22px] font-semibold">{name}</div>
          <div className="text-[14px] text-muted">{email}</div>
          <div className="mt-[2px] font-mono text-[12px] text-faint">
            {location || 'Location not set'} · Early-career developer
          </div>
        </div>
      </div>

      {/* Form card */}
      <form
        onSubmit={handleSubmit}
        className="mt-4 flex flex-col gap-5 rounded-[18px] border border-line bg-surface p-6"
      >
        <div>
          <label htmlFor="resume" className={LABEL}>
            About / pasted resume
          </label>
          <textarea
            id="resume"
            rows={4}
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            placeholder="Paste your resume or write a short summary…"
            className={`${FIELD} leading-[1.5]`}
          />
        </div>

        <div className="flex flex-wrap gap-4">
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

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[11px] bg-ink px-5 py-3 text-[13.5px] font-medium text-app shadow-[0_8px_28px_rgba(0,0,0,.22)]">
          {toast}
        </div>
      )}
    </div>
  )
}
