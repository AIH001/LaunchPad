import { useEffect } from 'react'
import { useProfile } from '../profile'
import { timeAgo } from '../../lib/timeAgo'
import { useGamePlan } from './GamePlanContext'

// The accent diamond that marks the AI layer across the app ("Claude's take").
function AccentDiamond({ size = 9 }: { size?: number }) {
  return (
    <span
      className="inline-block flex-none rotate-45 bg-accent"
      style={{ height: size, width: size }}
    />
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-[7px]">
      <AccentDiamond />
      <span className="font-mono text-[11px] uppercase tracking-[.06em] text-warm-ink">
        {children}
      </span>
    </div>
  )
}

export function GamePlan() {
  const { profile, loading: profileLoading } = useProfile()
  const { plan, loading, error, hasGenerated, hydrating, generatedAt, regenerate } =
    useGamePlan()

  // Generate on first view once the profile is ready AND the cache read has
  // settled. Guarded by hasGenerated (set true either by a prior generate or by
  // a hydrated cache) so it runs at most once — a saved plan is reused instead of
  // rebuilt on every login/refresh.
  useEffect(() => {
    if (!profileLoading && profile && !hydrating && !hasGenerated && !loading) {
      void regenerate()
    }
  }, [profileLoading, profile, hydrating, hasGenerated, loading, regenerate])

  // No profile row yet — nudge setup rather than spin forever on a plan we can't
  // build.
  if (!profileLoading && !profile) {
    return (
      <div className="max-w-[820px] rounded-[16px] border border-dashed border-[#d8cdbb] p-12 text-center">
        <h3 className="font-display text-[18px] font-semibold text-ink">
          Set up your profile first
        </h3>
        <p className="mx-auto mt-2 max-w-[380px] text-[14px] text-muted">
          Add a target role and a few skills on the Profile tab, and Claude will
          build your game plan from there.
        </p>
      </div>
    )
  }

  return (
    <div className="flex max-w-[820px] flex-col gap-[13px]">
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-[12px] text-faint">
          Synthesized from your profile and the gaps across your job matches.
          {generatedAt && !loading && (
            <span className="text-faint2"> · updated {timeAgo(generatedAt)}</span>
          )}
        </div>
        <button
          type="button"
          onClick={regenerate}
          disabled={loading}
          className="rounded-full border border-line-soft2 px-3 py-[6px] text-[12px] font-medium text-muted transition-colors hover:bg-chip disabled:opacity-60"
        >
          {loading ? 'Building…' : 'Regenerate'}
        </button>
      </div>

      {(loading || profileLoading) && (
        <div className="flex items-center gap-3 py-2 text-[14px] text-muted">
          <span className="inline-block h-[18px] w-[18px] animate-spin rounded-full border-2 border-line-soft border-t-accent" />
          Claude is building your game plan…
        </div>
      )}

      {error && <p className="text-[14px] text-[#b4452f]">{error}</p>}

      {!loading && !error && plan && (
        <>
          {/* Where you stand */}
          <section className="rounded-[16px] border border-ai-line bg-ai px-[22px] py-5">
            <SectionLabel>Where you stand</SectionLabel>
            <p className="text-[14.5px] leading-[1.6] text-[#5a5347]">{plan.standing}</p>
          </section>

          {/* Skills to close */}
          {plan.priority_gaps.length > 0 && (
            <section className="rounded-[16px] border border-line bg-surface px-[22px] py-5">
              <SectionLabel>Skills to close · ranked</SectionLabel>
              <ol className="flex flex-col gap-4">
                {plan.priority_gaps.map((g, i) => (
                  <li key={g.skill} className="flex gap-[14px]">
                    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-ink font-display text-[13px] font-semibold text-app">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="font-display text-[16px] font-semibold">{g.skill}</div>
                      <p className="mt-1 text-[13.5px] leading-[1.55] text-muted">{g.why}</p>
                      <div className="mt-2 flex items-start gap-[7px] rounded-[10px] border border-ai-line bg-ai px-[10px] py-[7px] text-[13px] leading-[1.5] text-warm-ink">
                        <span className="mt-[6px] inline-block h-[6px] w-[6px] flex-none rounded-full bg-accent" />
                        <span>
                          <span className="font-semibold">How: </span>
                          {g.how}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Do this next */}
          {plan.next_actions.length > 0 && (
            <section className="rounded-[16px] border border-line bg-surface px-[22px] py-5">
              <SectionLabel>Do this next</SectionLabel>
              <ul className="flex flex-col gap-[10px]">
                {plan.next_actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-[10px] text-[14px] leading-[1.5]">
                    <span className="mt-[2px] flex-none font-mono text-[12px] text-faint2">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Encouragement */}
          {plan.encouragement && (
            <div className="flex items-start gap-[9px] px-1 text-[13.5px] leading-[1.55] text-warm-ink">
              <AccentDiamond size={8} />
              <span>{plan.encouragement}</span>
            </div>
          )}
        </>
      )}

      {/* First-load empty state (before the auto-generate resolves). */}
      {!loading && !error && !plan && hasGenerated && (
        <div className="rounded-[16px] border border-dashed border-[#d8cdbb] p-12 text-center">
          <h3 className="font-display text-[18px] font-semibold text-ink">
            No game plan yet
          </h3>
          <p className="mx-auto mt-2 max-w-[380px] text-[14px] text-muted">
            Add a target role and a few skills to your profile, then regenerate for
            a plan tailored to where you're headed.
          </p>
        </div>
      )}
    </div>
  )
}
