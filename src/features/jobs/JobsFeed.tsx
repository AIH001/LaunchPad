import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { type ScoredJob } from './useJobs'
import { useJobsFeed } from './JobsContext'
import { useSavedJobs } from './useSavedJobs'
import { SavedJobsView } from './SavedJobsList'

// Score band → progress-bar color + detail-panel label, per the design doc.
function band(score: number | null) {
  if (score === null) return { bar: '#e6ddcd', label: 'Scoring…', labelColor: '#9a917f' }
  if (score >= 85) return { bar: '#2f8f63', label: 'Strong match', labelColor: '#2f8f63' }
  if (score >= 75) return { bar: '#d4663a', label: 'Good match', labelColor: '#b05a30' }
  return { bar: '#c08a2d', label: 'Worth a look', labelColor: '#9a7a3f' }
}

const glyph = (company: string) => (company?.[0] ?? '?').toUpperCase()

// Claude flagged this role as needing materially more experience than the user's
// stage. It's an honest heads-up, not a filter — the role stays fully visible.
function StretchBadge() {
  return (
    <span
      title="Needs more experience than your stage — a reach, but Claude explains why it could be worth a shot."
      className="inline-flex flex-none items-center rounded-full border border-ai-line bg-ai px-[7px] py-[1px] font-mono text-[10px] uppercase tracking-[.04em] text-warn-ink"
    >
      Stretch
    </span>
  )
}

// Human-readable names for the degraded-sources notice and the per-job source badge.
const SOURCE_LABEL: Record<string, string> = {
  adzuna: 'Adzuna',
  remotive: 'Remotive',
  themuse: 'The Muse',
  jooble: 'Jooble',
  hn: 'HN Who’s Hiring',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  wwr: 'We Work Remotely',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
  simplify: 'SimplifyJobs',
}

function salaryText(min: number | null, max: number | null) {
  if (!min && !max) return 'Salary not listed'
  const f = (n: number) => `$${Math.round(n / 1000)}k`
  if (min && max) return `${f(min)} – ${f(max)}`
  return f((min ?? max) as number)
}

function JobListCard({
  job,
  selected,
  onSelect,
}: {
  job: ScoredJob
  selected: boolean
  onSelect: () => void
}) {
  const b = band(job.score)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-[14px] rounded-[14px] p-[14px] text-left transition-colors ${
        selected
          ? 'border border-accent bg-surface shadow-[0_3px_12px_rgba(40,30,15,.06)]'
          : 'border border-line bg-field hover:border-line-soft2'
      }`}
    >
      <div className="flex h-11 w-11 flex-none items-center justify-center rounded-[11px] bg-ink font-display text-[18px] font-semibold text-app">
        {glyph(job.company)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold tracking-[-.01em]">
            {job.title}
          </span>
          {job.stretch && <StretchBadge />}
        </div>
        <div className="mt-[2px] truncate text-[13px] text-muted">
          {job.company} · {job.location || 'Remote / N/A'}
        </div>
        <div className="mt-[3px] font-mono text-[12px] text-faint">
          {salaryText(job.salaryMin, job.salaryMax)} · via {SOURCE_LABEL[job.source] ?? job.source}
        </div>
      </div>
      <div className="flex flex-none flex-col items-end gap-[6px]">
        {job.scoring ? (
          <span className="animate-pulse font-mono text-[11px] text-faint">scoring…</span>
        ) : (
          <div className="font-display text-[22px] font-bold leading-none">
            {job.score ?? '—'}
            <span className="text-[12px] font-medium text-faint2">%</span>
          </div>
        )}
        <div className="h-[5px] w-[72px] overflow-hidden rounded-[3px] bg-line-soft">
          <div
            className="h-full rounded-[3px] transition-all"
            style={{ width: `${job.score ?? 0}%`, background: b.bar }}
          />
        </div>
      </div>
    </button>
  )
}

function JobDetailPanel({
  job,
  saved,
  onToggleSave,
  onDraft,
}: {
  job: ScoredJob
  saved: boolean
  onToggleSave: () => void
  onDraft: () => void
}) {
  const b = band(job.score)
  return (
    <aside className="sticky top-0 w-[404px] flex-none self-start rounded-[18px] border border-line bg-surface p-6 shadow-[0_6px_24px_rgba(40,30,15,.05)]">
      <div className="font-mono text-[11px] tracking-[.09em] text-faint2">SELECTED ROLE</div>
      <h2 className="mb-1 mt-[7px] font-display text-[21px] font-semibold tracking-[-.01em]">
        {job.title}
      </h2>
      <div className="text-[14px] text-muted">
        {job.company} · {job.location || 'Remote / N/A'}
      </div>
      <div className="mt-[10px] flex flex-wrap items-center gap-2">
        <span className="inline-block rounded-[8px] border border-line-soft bg-chip px-[10px] py-[5px] font-mono text-[12px]">
          {salaryText(job.salaryMin, job.salaryMax)}
        </span>
        <span className="inline-block rounded-[8px] border border-line-soft bg-chip px-[10px] py-[5px] font-mono text-[12px] text-faint">
          via {SOURCE_LABEL[job.source] ?? job.source}
        </span>
      </div>

      {/* Score row */}
      <div className="my-[4px] mt-5 flex items-center gap-[14px]">
        <div className="font-display text-[40px] font-bold leading-none">
          {job.score ?? '—'}
          <span className="text-[18px] font-medium text-faint2">%</span>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold" style={{ color: b.labelColor }}>
              {b.label}
            </span>
            {job.stretch && <StretchBadge />}
          </div>
          <div className="mt-[6px] h-[7px] overflow-hidden rounded-[4px] bg-line-soft">
            <div
              className="h-full rounded-[4px] transition-all"
              style={{ width: `${job.score ?? 0}%`, background: b.bar }}
            />
          </div>
        </div>
      </div>

      {/* Why Claude matched you */}
      {(job.why_fit || job.gaps) && (
        <div className="mt-[18px] rounded-[13px] border border-ai-line bg-ai p-4">
          <div className="mb-[11px] flex items-center gap-[7px]">
            <span className="inline-block h-[9px] w-[9px] rotate-45 bg-accent" />
            <span className="font-mono text-[11px] uppercase tracking-[.06em] text-warm-ink">
              Why Claude matched you
            </span>
          </div>
          {job.why_fit && (
            <div className="flex items-start gap-[9px] text-[13.5px] leading-[1.45]">
              <span className="mt-[6px] h-[6px] w-[6px] flex-none rounded-full bg-success" />
              <span>{job.why_fit}</span>
            </div>
          )}
          {job.gaps && (
            <>
              <div className="my-[13px] h-px bg-[#eaddcd]" />
              <div className="mb-2 font-mono text-[11px] uppercase text-warn-ink">
                Gaps to address
              </div>
              <div className="flex items-start gap-[9px] text-[13.5px] leading-[1.45] text-[#5a5347]">
                <span className="mt-[6px] h-[6px] w-[6px] flex-none rounded-full bg-warn" />
                <span>{job.gaps}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-[18px] flex gap-[10px]">
        <button
          type="button"
          onClick={onDraft}
          className="flex-1 rounded-[11px] bg-accent px-3 py-3 text-[14px] font-semibold text-white shadow-[0_2px_8px_rgba(190,80,40,.22)] transition-colors hover:brightness-95"
        >
          Draft cover letter
        </button>
        <button
          type="button"
          onClick={onToggleSave}
          className={`rounded-[11px] border px-4 py-3 text-[14px] font-medium transition-colors ${
            saved
              ? 'border-ink bg-ink text-app'
              : 'border-line-soft2 bg-surface text-[#3a3329] hover:bg-field'
          }`}
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
    </aside>
  )
}

export function JobsFeed() {
  const { jobs, loading, scoring, error, degradedSources, search } = useJobsFeed()
  const { saved, loading: savedLoading, error: savedError, isSaved, save, unsave } =
    useSavedJobs()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'feed' | 'saved'>('feed')
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Keep a valid selection: default to the top job, and follow re-sorts.
  useEffect(() => {
    if (jobs.length === 0) {
      setSelectedId(null)
    } else if (!jobs.some((j) => j.id === selectedId)) {
      setSelectedId(jobs[0].id)
    }
  }, [jobs, selectedId])

  const selected = jobs.find((j) => j.id === selectedId) ?? null

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    search(query.trim(), location.trim())
  }

  return (
    <div>
      {/* Feed / Saved segmented control */}
      <div className="mb-5 inline-flex gap-1 rounded-[12px] border border-line-soft2 bg-field p-1">
        {([
          { key: 'feed', label: 'Feed' },
          { key: 'saved', label: 'Saved', count: saved.length },
        ] as const).map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 rounded-[9px] px-4 py-2 text-[13px] font-medium transition-colors ${
                active
                  ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,.04)]'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {t.label}
              {'count' in t && t.count > 0 && (
                <span
                  className={`inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] px-[6px] font-mono text-[11px] ${
                    active ? 'bg-accent text-white' : 'bg-line-soft text-faint'
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'saved' ? (
        <SavedJobsView
          saved={saved}
          loading={savedLoading}
          error={savedError}
          unsave={unsave}
        />
      ) : (
        <FeedView
          jobs={jobs}
          loading={loading}
          scoring={scoring}
          error={error}
          degradedSources={degradedSources}
          query={query}
          location={location}
          selectedId={selectedId}
          selected={selected}
          isSaved={isSaved}
          save={save}
          unsave={unsave}
          onQueryChange={setQuery}
          onLocationChange={setLocation}
          onSelect={setSelectedId}
          onSubmit={handleSubmit}
          onDraft={() =>
            selected &&
            navigate('/cover', {
              state: {
                job: {
                  title: selected.title,
                  company: selected.company,
                  description: selected.description,
                },
              },
            })
          }
        />
      )}
    </div>
  )
}

function FeedView({
  jobs,
  loading,
  scoring,
  error,
  degradedSources,
  query,
  location,
  selectedId,
  selected,
  isSaved,
  save,
  unsave,
  onQueryChange,
  onLocationChange,
  onSelect,
  onSubmit,
  onDraft,
}: {
  jobs: ScoredJob[]
  loading: boolean
  scoring: boolean
  error: string | null
  degradedSources: string[]
  query: string
  location: string
  selectedId: string | null
  selected: ScoredJob | null
  isSaved: (id: string) => boolean
  save: (job: ScoredJob) => void
  unsave: (id: string) => void
  onQueryChange: (v: string) => void
  onLocationChange: (v: string) => void
  onSelect: (id: string) => void
  onSubmit: (e: FormEvent) => void
  onDraft: () => void
}) {
  return (
    <div>
      <form onSubmit={onSubmit} className="mb-6 flex flex-wrap gap-3">
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Role, e.g. frontend developer"
          className="min-w-48 flex-1 rounded-[11px] border border-line-soft2 bg-field px-[14px] py-3 text-[14px] focus:border-faint focus:outline-none"
        />
        <input
          value={location}
          onChange={(e) => onLocationChange(e.target.value)}
          placeholder="Location (optional)"
          className="min-w-40 flex-1 rounded-[11px] border border-line-soft2 bg-field px-[14px] py-3 text-[14px] focus:border-faint focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || scoring}
          className="rounded-[11px] bg-accent px-5 py-3 text-[14px] font-semibold text-white shadow-[0_2px_8px_rgba(190,80,40,.22)] transition-colors hover:brightness-95 disabled:opacity-60"
        >
          {loading ? 'Searching…' : scoring ? 'Scoring…' : 'Find matches'}
        </button>
      </form>

      {loading && <p className="text-[14px] text-muted">Fetching listings…</p>}
      {error && <p className="text-[14px] text-[#b4452f]">{error}</p>}

      {/* Soft notice when a source degraded — feed is still usable. */}
      {!loading && degradedSources.length > 0 && (
        <p className="mb-[13px] rounded-[10px] border border-ai-line bg-ai px-[12px] py-2 font-mono text-[11px] text-warm-ink">
          Couldn't reach{' '}
          {degradedSources.map((s) => SOURCE_LABEL[s] ?? s).join(', ')} — showing
          results from the other sources.
        </p>
      )}
      {!loading && !error && jobs.length === 0 && (
        <p className="text-[14px] text-muted">
          No matches yet. Add a target role and skills to your profile — we'll
          pull roles that fit — or search above.
        </p>
      )}

      {jobs.length > 0 && (
        <div className="flex flex-wrap items-start gap-6">
          {/* Left: list */}
          <div className="flex min-w-[340px] flex-1 flex-col gap-[11px]">
            <div className="pl-[2px] font-mono text-[12px] text-faint">
              {jobs.length} roles · ranked by fit
            </div>
            {jobs.map((job) => (
              <JobListCard
                key={job.id}
                job={job}
                selected={job.id === selectedId}
                onSelect={() => onSelect(job.id)}
              />
            ))}
          </div>

          {/* Right: sticky detail */}
          {selected && (
            <JobDetailPanel
              job={selected}
              saved={isSaved(selected.id)}
              onToggleSave={() =>
                isSaved(selected.id) ? unsave(selected.id) : save(selected)
              }
              onDraft={onDraft}
            />
          )}
        </div>
      )}
    </div>
  )
}
