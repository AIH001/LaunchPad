import { type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../features/auth'
import { useProfile } from '../features/profile/useProfile'
import { CAREER_STAGE_LABELS, resolveCareerStage } from '../features/profile/career-stage'

// Nav items in order. Game Plan sits right after Job Matches — it's the
// early-career coaching companion to the feed (it reasons over match gaps).
// `short` is the label used in the mobile bottom tab bar, where six full
// labels won't fit.
const NAV = [
  { label: 'Job Matches', short: 'Jobs', to: '/jobs' },
  { label: 'Game Plan', short: 'Plan', to: '/coach' },
  { label: 'Profile', short: 'Profile', to: '/profile' },
  { label: 'Cover Letters', short: 'Letters', to: '/cover' },
  { label: 'Daily Digest', short: 'Digest', to: '/digest' },
  { label: 'Events', short: 'Events', to: '/events' },
]

function initialsFromEmail(email: string) {
  if (!email) return '?'
  const local = email.split('@')[0]
  const parts = local.split(/[._-]/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2)
  return chars.toUpperCase()
}

export function AppShell({
  kicker,
  title,
  subtitle,
  jobBadge,
  children,
}: {
  kicker: string
  title: string
  subtitle: string
  jobBadge?: number
  children: ReactNode
}) {
  const { user, signOut } = useAuth()
  const { profile } = useProfile()
  const { pathname } = useLocation()
  const email = user?.email ?? ''
  const name = email ? email.split('@')[0] : 'You'
  const stageLabel = CAREER_STAGE_LABELS[resolveCareerStage(profile).stage]
  // App runtime (browser) — new Date() is fine here.
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

  return (
    <div className="flex h-screen overflow-hidden bg-app font-sans text-ink md:min-h-[640px]">
      {/* Sidebar — desktop only; mobile gets the top bar + bottom tab nav below. */}
      <aside className="hidden w-[250px] flex-none flex-col border-r border-line-sidebar bg-sidebar px-4 py-5 md:flex">
        {/* Logo */}
        <div className="flex items-center gap-[11px] px-2 pb-[18px] pt-1">
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-accent text-[18px] font-bold text-white shadow-[0_2px_6px_rgba(0,0,0,.12)]">
            ↗
          </div>
          <div>
            <div className="font-display text-[17px] font-bold tracking-[-.01em]">
              Launchpad
            </div>
            <div className="font-mono text-[10px] tracking-[.06em] text-faint">
              AI CAREER COPILOT
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-[3px]">
          {NAV.map((item) => {
            const active = pathname === item.to
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex w-full items-center gap-[10px] rounded-[10px] px-3 py-[9px] text-[14px] transition-colors ${
                  active
                    ? 'border border-[#ece4d6] bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,.03)]'
                    : 'border border-transparent font-medium text-muted hover:bg-[#f4eee2]'
                }`}
              >
                <span
                  className={`h-[6px] w-[6px] rounded-[2px] ${active ? 'bg-accent' : 'bg-[#d8cfc0]'}`}
                />
                <span className="flex-1 text-left">{item.label}</span>
                {item.to === '/jobs' && jobBadge != null && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] bg-accent px-[6px] font-mono text-[11px] text-white">
                    {jobBadge}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Profile mini-card (pinned bottom) */}
        <div className="mt-auto pt-4">
          <Link
            to="/profile"
            className="flex w-full items-center gap-[11px] rounded-[12px] border border-line-soft2 bg-field p-[11px] text-left"
          >
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-ink font-display text-[14px] font-semibold text-app">
              {initialsFromEmail(email)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold">{name}</div>
              <div className="truncate text-[11px] text-faint">{stageLabel}</div>
            </div>
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-main">
        {/* Mobile top bar — brand + sign out (the sidebar carries these on desktop). */}
        <div className="flex items-center justify-between border-b border-line-sidebar bg-sidebar px-5 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-accent text-[14px] font-bold text-white shadow-[0_2px_6px_rgba(0,0,0,.12)]">
              ↗
            </div>
            <span className="font-display text-[15px] font-bold tracking-[-.01em]">
              Launchpad
            </span>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="rounded-full border border-line-soft2 px-3 py-[6px] text-[12px] font-medium text-muted"
          >
            Sign out
          </button>
        </div>

        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line-soft px-5 pb-4 pt-4 md:px-[34px] md:pb-5 md:pt-[22px]">
          <div>
            <div className="mb-[5px] font-mono text-[11px] tracking-[.1em] text-faint2">
              {kicker}
            </div>
            <h1 className="font-display text-[25px] font-semibold tracking-[-.02em]">
              {title}
            </h1>
            <p className="mt-[5px] max-w-[560px] text-[14px] text-muted">{subtitle}</p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border border-[#d8e3d2] bg-[#eef3ec] px-3 py-[6px]">
              <span className="h-[7px] w-[7px] rounded-full bg-success" />
              <span className="font-mono text-[11px] text-success-ink">
                synced · {today}
              </span>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="hidden rounded-full border border-line-soft2 px-3 py-[6px] text-[12px] font-medium text-muted transition-colors hover:bg-chip md:block"
            >
              Sign out
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto px-5 pb-[96px] pt-5 md:px-[34px] md:pb-[60px] md:pt-[26px]">
          {children}
        </div>
      </main>

      {/* Mobile bottom tab nav — replaces the sidebar below md. Fixed over the
          shell (the content area reserves pb-[96px] so nothing hides under it);
          safe-area padding keeps it above iPhone home indicators. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line-sidebar bg-sidebar md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {NAV.map((item) => {
          const active = pathname === item.to
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex min-h-[52px] flex-1 flex-col items-center justify-center gap-[5px] text-[10.5px] ${
                active ? 'font-semibold text-ink' : 'font-medium text-muted'
              }`}
            >
              <span className="relative">
                <span
                  className={`block h-[6px] w-[6px] rounded-[2px] ${active ? 'bg-accent' : 'bg-[#d8cfc0]'}`}
                />
                {item.to === '/jobs' && jobBadge != null && jobBadge > 0 && (
                  <span className="absolute -right-[14px] -top-[6px] inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-[4px] bg-accent px-[3px] font-mono text-[9px] leading-none text-white">
                    {jobBadge}
                  </span>
                )}
              </span>
              {item.short}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
