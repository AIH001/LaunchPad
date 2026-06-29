import { useNavigate } from 'react-router-dom'
import { useSavedJobs } from './useSavedJobs'
import type { ScoredJob } from './useJobs'
import type { SavedJob } from '../../types'

const glyph = (company?: string) => (company?.[0] ?? '?').toUpperCase()

// Thin wrapper that owns its own data — used by the standalone /saved route.
export function SavedJobsList() {
  const { saved, loading, error, unsave } = useSavedJobs()
  return <SavedJobsView saved={saved} loading={loading} error={error} unsave={unsave} />
}

// Presentational list. Takes data as props so the Job Matches screen can render
// it from the same useSavedJobs instance that powers the Save buttons + tab count.
export function SavedJobsView({
  saved,
  loading,
  error,
  unsave,
}: {
  saved: SavedJob[]
  loading: boolean
  error: string | null
  unsave: (externalId: string) => void
}) {
  const navigate = useNavigate()
  if (loading) return <p className="text-[14px] text-muted">Loading saved jobs…</p>
  if (error) return <p className="text-[14px] text-[#b4452f]">{error}</p>
  if (saved.length === 0) {
    return (
      <div className="rounded-[18px] border border-dashed border-[#d8cdbb] p-12 text-center">
        <h3 className="font-display text-[19px] font-semibold text-ink">
          No saved jobs yet
        </h3>
        <p className="mx-auto mt-2 max-w-[380px] text-[14px] text-muted">
          Save matches from the Job Matches page to revisit them here.
        </p>
      </div>
    )
  }

  return (
    <ul className="flex max-w-[760px] flex-col gap-[11px]">
      {saved.map((row) => {
        const job = row.job_payload as Partial<ScoredJob>
        return (
          <li
            key={row.id}
            className="rounded-[14px] border border-line bg-surface p-[18px]"
          >
            <div className="flex items-start gap-[14px]">
              <div className="flex h-11 w-11 flex-none items-center justify-center rounded-[11px] bg-ink font-display text-[18px] font-semibold text-app">
                {glyph(job.company)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold tracking-[-.01em]">
                  {job.title}
                </div>
                <div className="mt-[2px] text-[13px] text-muted">
                  {job.company} · {job.location || 'Remote / N/A'}
                </div>
                {row.match_reasoning && (
                  <p className="mt-[10px] text-[13.5px] leading-[1.45] text-[#5a5347]">
                    {row.match_reasoning}
                  </p>
                )}
              </div>
              {row.match_score !== null && (
                <div className="flex-none font-display text-[22px] font-bold leading-none">
                  {row.match_score}
                  <span className="text-[12px] font-medium text-faint2">%</span>
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center gap-4 pl-[58px]">
              {job.url && (
                <a
                  href={job.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] font-medium text-accent-ink underline underline-offset-2"
                >
                  View &amp; apply →
                </a>
              )}
              <button
                type="button"
                onClick={() =>
                  navigate('/cover', {
                    state: {
                      job: {
                        title: job.title,
                        company: job.company,
                        description: job.description,
                      },
                    },
                  })
                }
                className="rounded-[10px] border border-line-soft2 px-3 py-[6px] text-[13px] font-medium text-muted transition-colors hover:bg-field"
              >
                Draft cover letter
              </button>
              <button
                type="button"
                onClick={() => job.id && unsave(job.id)}
                className="rounded-[10px] border border-line-soft2 px-3 py-[6px] text-[13px] font-medium text-muted transition-colors hover:bg-field"
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
