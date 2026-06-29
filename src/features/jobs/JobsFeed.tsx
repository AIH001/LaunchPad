import { useState, type FormEvent } from 'react'
import { useJobs, type ScoredJob } from './useJobs'
import { useSavedJobs } from './useSavedJobs'

// Color the score badge by band so the feed is scannable.
function scoreColor(score: number | null) {
  if (score === null) return 'bg-gray-100 text-gray-500'
  if (score >= 75) return 'bg-green-100 text-green-800'
  if (score >= 50) return 'bg-amber-100 text-amber-800'
  return 'bg-red-100 text-red-700'
}

function JobCard({
  job,
  saved,
  onToggleSave,
}: {
  job: ScoredJob
  saved: boolean
  onToggleSave: () => void
}) {
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-gray-900">{job.title}</h3>
          <p className="text-sm text-gray-500">
            {job.company} · {job.location || 'Location N/A'}
          </p>
        </div>
        {job.scoring ? (
          <span className="shrink-0 animate-pulse rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
            Scoring…
          </span>
        ) : (
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${scoreColor(job.score)}`}
          >
            {job.score ?? '—'}
          </span>
        )}
      </div>

      {job.why_fit && (
        <p className="mt-3 text-sm">
          <span className="font-medium text-green-700">Why you fit: </span>
          <span className="text-gray-700">{job.why_fit}</span>
        </p>
      )}
      {job.gaps && (
        <p className="mt-1 text-sm">
          <span className="font-medium text-amber-700">Gaps: </span>
          <span className="text-gray-700">{job.gaps}</span>
        </p>
      )}

      <div className="mt-4 flex items-center gap-4">
        <a
          href={job.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-gray-900 underline underline-offset-2"
        >
          View &amp; apply →
        </a>
        <button
          type="button"
          onClick={onToggleSave}
          className={`rounded-lg border px-3 py-1 text-sm font-medium transition ${
            saved
              ? 'border-gray-900 bg-gray-900 text-white hover:bg-gray-800'
              : 'border-gray-300 text-gray-700 hover:bg-gray-100'
          }`}
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
    </li>
  )
}

export function JobsFeed() {
  const { jobs, loading, scoring, error, search } = useJobs()
  const { isSaved, save, unsave } = useSavedJobs()
  const [query, setQuery] = useState('developer')
  const [location, setLocation] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    search(query.trim(), location.trim())
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="mb-6 flex flex-wrap gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Role, e.g. frontend developer"
          className="min-w-48 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
        />
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Location (optional)"
          className="min-w-40 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
        />
        <button
          type="submit"
          disabled={loading || scoring}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:opacity-60"
        >
          {loading ? 'Searching…' : scoring ? 'Scoring…' : 'Find matches'}
        </button>
      </form>

      {loading && (
        <p className="text-sm text-gray-500">Fetching listings…</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !error && jobs.length === 0 && (
        <p className="text-sm text-gray-500">
          Search to see jobs scored against your profile.
        </p>
      )}

      <ul className="space-y-4">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            saved={isSaved(job.id)}
            onToggleSave={() => (isSaved(job.id) ? unsave(job.id) : save(job))}
          />
        ))}
      </ul>
    </div>
  )
}
