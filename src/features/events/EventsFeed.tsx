import { Link } from 'react-router-dom'
import { useProfile } from '../profile'
import { useEvents } from './useEvents'
import type { EventSource, ScoredEvent } from '../../types'

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
  const { events, loading, error, degradedSources, refresh } = useEvents()

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
      {/* Caption + refresh */}
      <div className="mb-[13px] flex items-center justify-between">
        <p className="font-mono text-[12px] text-faint">Near {profile.location}</p>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="rounded-[8px] border border-line-soft2 px-3 py-[5px] text-[12px] font-medium text-muted transition-colors hover:bg-chip disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

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
        ) : events.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-[#d8cdbb] p-12 text-center">
            <h3 className="font-display text-[19px] font-semibold">No events found</h3>
            <p className="mx-auto mt-2 max-w-[380px] text-[14px] text-muted">
              No upcoming tech events near {profile.location}. Try refreshing or updating
              your location.
            </p>
          </div>
        ) : (
          events.map((event) => <EventCard key={event.id} event={event} />)
        )}
      </div>
    </div>
  )
}
