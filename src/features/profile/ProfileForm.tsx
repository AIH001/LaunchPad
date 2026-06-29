import { useEffect, useState, type FormEvent } from 'react'
import { useProfile } from './useProfile'

// Helpers to convert between the DB's text[] and a comma-separated input box.
const toList = (s: string) =>
  s.split(',').map((x) => x.trim()).filter(Boolean)
const fromList = (xs: string[]) => xs.join(', ')

export function ProfileForm() {
  const { profile, loading, save } = useProfile()

  const [resume, setResume] = useState('')
  const [skills, setSkills] = useState('')
  const [interests, setInterests] = useState('')
  const [location, setLocation] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Once the profile loads from the DB, seed the form fields with it.
  useEffect(() => {
    if (!profile) return
    setResume(profile.resume_text ?? '')
    setSkills(fromList(profile.skills))
    setInterests(fromList(profile.interests))
    setLocation(profile.location ?? '')
  }, [profile])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)

    const result = await save({
      resume_text: resume.trim() || null,
      skills: toList(skills),
      interests: toList(interests),
      location: location.trim() || null,
    })

    if (result.error) setError(result.error)
    else setSaved(true)
    setSaving(false)
  }

  if (loading) {
    return <p className="text-gray-500">Loading your profile…</p>
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="resume" className="mb-1 block text-sm font-medium text-gray-700">
          Resume
        </label>
        <textarea
          id="resume"
          rows={8}
          value={resume}
          onChange={(e) => setResume(e.target.value)}
          placeholder="Paste your resume text here…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
        />
      </div>

      <div>
        <label htmlFor="skills" className="mb-1 block text-sm font-medium text-gray-700">
          Skills <span className="text-gray-400">(comma-separated)</span>
        </label>
        <input
          id="skills"
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          placeholder="React, TypeScript, Postgres"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
        />
      </div>

      <div>
        <label htmlFor="interests" className="mb-1 block text-sm font-medium text-gray-700">
          Interests <span className="text-gray-400">(comma-separated)</span>
        </label>
        <input
          id="interests"
          value={interests}
          onChange={(e) => setInterests(e.target.value)}
          placeholder="AI, fintech, developer tools"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
        />
      </div>

      <div>
        <label htmlFor="location" className="mb-1 block text-sm font-medium text-gray-700">
          Location
        </label>
        <input
          id="location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Seattle, WA"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-green-700">Profile saved.</p>}

      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  )
}
