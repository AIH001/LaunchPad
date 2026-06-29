import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCoverLetters, type DraftJob } from './useCoverLetters'

export function CoverLetters() {
  const location = useLocation()
  const navigate = useNavigate()
  const { letters, loading, profileLoading, draft, save, remove } = useCoverLetters()

  // A job may be handed in from the Job Matches "Draft cover letter" button.
  const jobFromNav = (location.state as { job?: DraftJob } | null)?.job

  const [job, setJob] = useState<DraftJob | undefined>(jobFromNav)
  const [status, setStatus] = useState<'idle' | 'drafting' | 'done'>(
    jobFromNav ? 'drafting' : 'idle'
  )
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 1900)
    return () => clearTimeout(t)
  }, [toast])

  // Kick off a draft for the handed-in job, once — but only after the profile
  // has finished loading, so Claude gets the candidate's real data (not null).
  useEffect(() => {
    if (started.current || !jobFromNav || profileLoading) return
    started.current = true
    runDraft(jobFromNav)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobFromNav, profileLoading])

  async function runDraft(j: DraftJob) {
    setJob(j)
    setStatus('drafting')
    setError(null)
    try {
      const body = await draft(j)
      setText(body)
      setStatus('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('idle')
    }
  }

  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setToast('Copied to clipboard')
  }

  const handleSave = async () => {
    if (!job) return
    try {
      await save(job.title, job.company, text)
      setToast('Cover letter saved')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // DRAFTING
  if (status === 'drafting' && job) {
    return (
      <div className="max-w-[760px]">
        <div className="flex flex-col items-center rounded-[18px] border border-line bg-surface p-12 text-center">
          <div className="h-[34px] w-[34px] animate-spin rounded-full border-[3px] border-line-soft border-t-accent" />
          <h3 className="mt-4 font-display text-[17px] font-semibold text-ink">
            Claude is drafting your letter…
          </h3>
          <p className="mt-1 text-[13px] text-faint">
            Tailoring to {job.title} at {job.company}
          </p>
        </div>
      </div>
    )
  }

  // DONE
  if (status === 'done' && job) {
    return (
      <div className="max-w-[760px]">
        <div className="rounded-[18px] border border-line bg-surface p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] tracking-[.09em] text-faint2">
                TAILORED FOR
              </div>
              <div className="font-display text-[18px] font-semibold">
                {job.title} · {job.company}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={copy}
                className="rounded-[9px] bg-accent px-4 py-[9px] text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(190,80,40,.22)] hover:brightness-95"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => runDraft(job)}
                className="rounded-[9px] border border-line-soft2 px-4 py-[9px] text-[13px] font-medium text-muted hover:bg-field"
              >
                Regenerate
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded-[9px] border border-line-soft2 px-4 py-[9px] text-[13px] font-medium text-muted hover:bg-field"
              >
                Save
              </button>
            </div>
          </div>

          {error && <p className="mb-3 text-[14px] text-[#b4452f]">{error}</p>}

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={16}
            className="w-full rounded-[13px] border border-line-soft2 bg-field px-5 py-[18px] text-[14px] leading-[1.65] focus:border-faint focus:outline-none"
          />

          <div className="mt-3 flex items-center gap-[7px] text-[12.5px] text-warm-ink">
            <span className="inline-block h-[8px] w-[8px] rotate-45 bg-accent" />
            Claude tailored this to your background — edit freely before you send.
          </div>
        </div>

        {toast && (
          <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[11px] bg-ink px-5 py-3 text-[13.5px] font-medium text-app shadow-[0_8px_28px_rgba(0,0,0,.22)]">
            {toast}
          </div>
        )}
      </div>
    )
  }

  // IDLE — show saved letters, or an empty state.
  return (
    <div className="max-w-[760px]">
      {error && <p className="mb-4 text-[14px] text-[#b4452f]">{error}</p>}

      {!loading && letters.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-[#d8cdbb] p-12 text-center">
          <h3 className="font-display text-[19px] font-semibold text-ink">
            No letter drafted yet
          </h3>
          <p className="mx-auto mt-2 max-w-[380px] text-[14px] text-muted">
            Open a role from Job Matches and hit “Draft cover letter” — Claude
            tailors it to your profile, then you edit.
          </p>
          <button
            type="button"
            onClick={() => navigate('/jobs')}
            className="mt-4 rounded-[11px] bg-accent px-5 py-3 text-[14px] font-semibold text-white shadow-[0_2px_8px_rgba(190,80,40,.22)] hover:brightness-95"
          >
            Go to job matches
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-[11px]">
          {letters.map((l) => (
            <li key={l.id} className="rounded-[14px] border border-line bg-surface p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="font-display text-[16px] font-semibold">
                  {l.job_title} · {l.company}
                </div>
                <button
                  type="button"
                  onClick={() => remove(l.id)}
                  className="rounded-[10px] border border-line-soft2 px-3 py-[6px] text-[13px] font-medium text-muted hover:bg-field"
                >
                  Delete
                </button>
              </div>
              <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-[13.5px] leading-[1.5] text-[#5a5347]">
                {l.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
