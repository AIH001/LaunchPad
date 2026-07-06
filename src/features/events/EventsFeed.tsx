import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfile } from '../profile'
import { timeAgo } from '../../lib/timeAgo'
import { useEventsFeed } from './EventsContext'
import type { EventSource, ScoredEvent } from '../../types'

type EventTab = 'all' | 'worth_it'

const SOURCE_LABEL: Record<EventSource, string> = {
  ticketmaster: 'Ticketmaster',
  luma: 'Luma',
  meetup: 'Meetup',
}

// Format an ISO 8601 instant (UTC) into the date-block parts, rendered in the
// viewer's local timezone.
function formatEventDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return { dow: '', mon: '', day: '', time: '' }
  }
  return {
    dow: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
    mon: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
    day: d.getDate(),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  }
}

function AccentDiamond() {
  return (
    <span
      className="inline-block h-2 w-2 flex-none rotate-45 bg-accent"
      aria-hidden="true"
    />
  )
}

function EventCard({ event }: { event: ScoredEvent }) {
  const { dow, mon, day, time } = formatEventDate(event.startDate)
  const isWorthIt = event.verdict === 'worth_it'
  const venueLine = [
    event.isVirtual ? 'Virtual' : event.location.display,
    `via ${SOURCE_LABEL[event.source]}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex items-start gap-[18px] rounded-[16px] border border-line bg-surface p-[20px_22px] shadow-[0_6px_24px_rgba(40,30,15,.05)]">
      {/* Date block */}
      <div className="w-24 flex-none rounded-[12px] bg-ink px-3 py-[11px] text-center font-mono leading-[1.45] text-app">
        <div className="text-[11px]">{dow}</div>
        <div className="text-[12px] font-medium">
          {mon} {day}
        </div>
        <div className="mt-1 text-[11px]">{time}</div>
      </div>

      {/* Right content */}
      <div className="min-w-0 flex-1">
        {/* Title + verdict badge */}
        <div className="flex flex-wrap items-start gap-2">
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-display text-[17px] font-semibold leading-tight hover:underline"
          >
            {event.title}
          </a>

          {event.scoring && (
            <span className="inline-flex items-center gap-[6px] rounded-full border border-line-soft2 bg-chip px-[9px] py-[3px] font-mono text-[11px] text-faint">
              <span className="inline-block h-[6px] w-[6px] animate-pulse rounded-full bg-accent" />
              rating…
            </span>
          )}
          {!event.scoring && event.verdict && (
            <span
              className={`inline-flex items-center rounded-full px-[9px] py-[3px] font-mono text-[11px] ${
                isWorthIt
                  ? 'border border-[#d2e0cb] bg-[#eef3ec] text-success-ink'
                  : 'border border-line-soft2 bg-chip text-faint'
              }`}
            >
              {isWorthIt ? 'Worth it' : 'Optional'}
            </span>
          )}
        </div>

        {/* Venue · source */}
        {venueLine && <p className="mt-1 text-[13px] text-muted">{venueLine}</p>}

        {/* Claude's take box */}
        {!event.scoring && event.take && (
          <div className="mt-[11px] rounded-[11px] border border-ai-line bg-ai p-[12px_14px]">
            <div className="mb-[7px] flex items-center gap-[7px]">
              <AccentDiamond />
              <span className="font-mono text-[10.5px] uppercase tracking-[.06em] text-warm-ink">
                Claude's take
              </span>
            </div>
            <p className="text-[13.5px] leading-[1.55] text-[#5a5347]">{event.take}</p>
          </div>
        )}

        {/* Tags (category + Claude's topic tags) */}
        <div className="mt-[13px] flex flex-wrap gap-[7px]">
          {event.category && (
            <span className="rounded-[7px] border border-line-soft bg-chip px-[9px] py-1 font-mono text-[11px] text-muted">
              {event.category}
            </span>
          )}
          {event.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-[7px] border border-line-soft bg-chip px-[9px] py-1 font-mono text-[11px] text-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'inline-flex items-center gap-[6px] rounded-[10px] px-[14px] py-[7px] font-mono text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
        (active
          ? 'border border-line bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,.03)]'
          : 'border border-transparent text-muted hover:bg-chip')
      }
    >
      {label}
      {typeof count === 'number' && (
        <span className="rounded-[6px] bg-chip px-[6px] py-[1px] text-[11px] text-faint">
          {count}
        </span>
      )}
    </button>
  )
}

function SkeletonCard() {
  return (
    <div className="flex animate-pulse items-start gap-[18px] rounded-[16px] border border-line bg-surface p-[20px_22px]">
      <div className="h-[90px] w-24 flex-none rounded-[12px] bg-[#e8e0d2]" />
      <div className="flex-1 space-y-2 pt-1">
        <div className="h-5 w-2/3 rounded bg-[#e8e0d2]" />
        <div className="h-4 w-1/3 rounded bg-[#e8e0d2]" />
        <div className="mt-3 h-16 w-full rounded-[11px] bg-[#f0e8dc]" />
      </div>
    </div>
  )
}

export function EventsFeed() {
  const { profile } = useProfile()
  const { events, loading, error, degradedSources, generatedAt, hydrating, hasLoaded, refresh } =
    useEventsFeed()
  const [tab, setTab] = useState<EventTab>('all')

  // Trigger the first fetch when this screen is first opened and nothing is
  // cached — keeps the expensive fetch+score lazy (the provider only hydrates).
  // Reruns are prevented by hasLoaded; returning to the tab reuses the feed.
  useEffect(() => {
    if (profile?.location && !hydrating && !hasLoaded && !loading) {
      void refresh()
    }
  }, [profile?.location, hydrating, hasLoaded, loading, refresh])

  const worthItCount = events.filter((e) => e.verdict === 'worth_it').length
  const visibleEvents =
    tab === 'worth_it' ? events.filter((e) => e.verdict === 'worth_it') : events

  if (!profile?.location) {
    return (
      <div className="max-w-[820px] rounded-[18px] border border-dashed border-[#d8cdbb] p-12 text-center">
        <h3 className="font-display text-[19px] font-semibold">No location set</h3>
        <p className="mx-auto mt-2 max-w-[380px] text-[14px] text-muted">
          Add your city in your profile and we'll find tech events near you.
        </p>
        <Link
          to="/profile"
          className="mt-5 inline-block rounded-[11px] bg-accent px-5 py-3 text-[14px] font-semibold text-white shadow-[0_2px_8px_rgba(190,80,40,.22)]"
        >
          Set your location
        </Link>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-[820px] rounded-[18px] border border-dashed border-[#d8cdbb] p-12 text-center">
        <h3 className="font-display text-[19px] font-semibold">Could not load events</h3>
        <p className="mx-auto mt-2 max-w-[380px] text-[14px] text-muted">{error}</p>
        <button
          type="button"
          onClick={refresh}
          className="mt-5 rounded-[11px] bg-accent px-5 py-3 text-[14px] font-semibold text-white shadow-[0_2px_8px_rgba(190,80,40,.22)]"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-[820px]">
      {/* Tabs + refresh */}
      <div className="mb-[13px] flex items-center justify-between gap-3">
        <div className="flex items-center gap-[6px]">
          <TabButton active={tab === 'all'} onClick={() => setTab('all')} label="All" />
          <TabButton
            active={tab === 'worth_it'}
            onClick={() => setTab('worth_it')}
            label="Worth it"
            count={loading ? undefined : worthItCount}
          />
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="rounded-[8px] border border-line-soft2 px-3 py-[5px] text-[12px] font-medium text-muted transition-colors hover:bg-chip disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {/* Caption */}
      <p className="mb-[13px] font-mono text-[12px] text-faint">
        {tab === 'worth_it'
          ? `Worth attending · near ${profile.location}`
          : `Near ${profile.location}`}
        {generatedAt && !loading && (
          <span className="text-faint2"> · updated {timeAgo(generatedAt)}</span>
        )}
      </p>

      {/* Soft notice when a source degraded — feed is still usable. */}
      {!loading && degradedSources.length > 0 && (
        <p className="mb-[13px] rounded-[10px] border border-ai-line bg-ai px-[12px] py-2 font-mono text-[11px] text-warm-ink">
          Couldn't reach{' '}
          {degradedSources
            .map((s) => SOURCE_LABEL[s as EventSource] ?? s)
            .join(', ')}{' '}
          — showing results from the other sources.
        </p>
      )}

      <div className="flex flex-col gap-[13px]">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : visibleEvents.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-[#d8cdbb] p-12 text-center">
            <h3 className="font-display text-[19px] font-semibold">
              {tab === 'worth_it' ? 'Nothing flagged worth it' : 'No events found'}
            </h3>
            <p className="mx-auto mt-2 max-w-[380px] text-[14px] text-muted">
              {tab === 'worth_it'
                ? `Claude hasn't flagged any upcoming events near ${profile.location} as worth attending yet. Check the All tab for the full list.`
                : `No upcoming tech events near ${profile.location}. Try refreshing or updating your location.`}
            </p>
          </div>
        ) : (
          visibleEvents.map((event) => <EventCard key={event.id} event={event} />)
        )}
      </div>
    </div>
  )
}
