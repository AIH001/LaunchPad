import { useSavedJobs } from './useSavedJobs'
import type { ScoredJob } from './useJobs'

export function SavedJobsList() {
  const { saved, loading, error, unsave } = useSavedJobs()

  if (loading) return <p className="text-sm text-gray-500">Loading saved jobs…</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (saved.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No saved jobs yet. Save matches from the Jobs page.
      </p>
    )
  }

  return (
    <ul className="space-y-4">
      {saved.map((row) => {
        const job = row.job_payload as Partial<ScoredJob>
        return (
          <li
            key={row.id}
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-gray-900">{job.title}</h3>
                <p className="text-sm text-gray-500">
                  {job.company} · {job.location || 'Location N/A'}
                </p>
              </div>
              {row.match_score !== null && (
                <span className="shrink-0 rounded-full bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-700">
                  {row.match_score}
                </span>
              )}
            </div>

            {row.match_reasoning && (
              <p className="mt-3 text-sm text-gray-700">{row.match_reasoning}</p>
            )}

            <div className="mt-4 flex items-center gap-4">
              {job.url && (
                <a
                  href={job.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-gray-900 underline underline-offset-2"
                >
                  View &amp; apply →
                </a>
              )}
              <button
                type="button"
                onClick={() => job.id && unsave(job.id)}
                className="rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Remove
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
