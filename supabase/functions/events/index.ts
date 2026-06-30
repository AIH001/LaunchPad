// events: aggregates tech / networking events from multiple sources into ONE
// normalized feed, then returns it to the client. The browser calls this; this
// calls the third-party APIs so keys stay server-side.
//
// Design:
//  - Each source has a mapper that converts its raw payload into NormalizedEvent.
//  - Sources fan out concurrently via Promise.allSettled, so one source failing
//    (or being slow) never blanks the feed — we return whatever succeeded plus a
//    per-source status map.
//  - Results are deduped across sources (same title + day + venue) and sorted by
//    soonest start.
//
// Sources:
//  - Ticketmaster Discovery (official; needs TICKETMASTER_API_KEY). Broad geo
//    coverage for larger conferences / convention events.
//  - Luma discover feed (UNOFFICIAL, keyless — see lumaSource). Startup / AI /
//    founder / dev community events; the best fit for the target audience.
//  - Meetup (STUB; see meetupSource). Gated behind a paid Meetup Pro subscription,
//    so it's wired structurally but disabled for v1.
//
// NOTE: NormalizedEvent here must stay in sync with the `Event` type in
// src/types/index.ts (different module systems — Deno vs. the Vite app — so it
// can't be imported across the boundary).
import { corsHeaders, json } from '../_shared/cors.ts'

type EventSource = 'ticketmaster' | 'luma' | 'meetup'

interface NormalizedEvent {
  id: string
  source: EventSource
  title: string
  description: string
  startDate: string
  endDate: string | null
  location: { lat: number | null; lng: number | null; display: string }
  url: string
  isVirtual: boolean
  category: string
  imageUrl: string | null
}

// Everything a source needs to run its query, derived once from the request.
interface SourceInput {
  city: string // first segment of the user's location string, e.g. "San Francisco"
  interests: string[]
  radiusMiles: number
  startISO: string
  endISO: string
}

// ---------------------------------------------------------------------------
// Ticketmaster Discovery API
// ---------------------------------------------------------------------------

interface TmEvent {
  id: string
  name?: string
  url?: string
  info?: string
  images?: Array<{ url: string; ratio?: string; width?: number }>
  dates?: { start?: { dateTime?: string; localDate?: string }; end?: { dateTime?: string } }
  classifications?: Array<{ segment?: { name?: string } }>
  _embedded?: {
    venues?: Array<{
      name?: string
      city?: { name?: string }
      state?: { stateCode?: string }
      location?: { latitude?: string; longitude?: string }
    }>
  }
}

// Pick a reasonably large 16:9 image, falling back to whatever's available.
function pickTmImage(images?: TmEvent['images']): string | null {
  if (!Array.isArray(images) || images.length === 0) return null
  const wide = images.find((i) => i.ratio === '16_9' && (i.width ?? 0) >= 640)
  return (wide ?? images[0])?.url ?? null
}

function mapTicketmaster(e: TmEvent): NormalizedEvent {
  const venue = e._embedded?.venues?.[0]
  const cityState = [venue?.city?.name, venue?.state?.stateCode].filter(Boolean).join(', ')
  const display = [venue?.name, cityState].filter(Boolean).join(' · ')
  const start = e.dates?.start
  // Discovery gives either a full dateTime (UTC) or a date-only localDate.
  const startDate = start?.dateTime ?? (start?.localDate ? `${start.localDate}T00:00:00Z` : '')
  const lat = venue?.location?.latitude
  const lng = venue?.location?.longitude

  return {
    id: `tm-${e.id}`,
    source: 'ticketmaster',
    title: e.name ?? 'Untitled event',
    description: e.info ?? '',
    startDate,
    endDate: e.dates?.end?.dateTime ?? null,
    location: {
      lat: lat ? Number(lat) : null,
      lng: lng ? Number(lng) : null,
      display: display || cityState,
    },
    url: e.url ?? '',
    isVirtual: false,
    category: e.classifications?.[0]?.segment?.name ?? 'Event',
    imageUrl: pickTmImage(e.images),
  }
}

async function ticketmasterSource(input: SourceInput): Promise<NormalizedEvent[]> {
  const apiKey = Deno.env.get('TICKETMASTER_API_KEY')
  if (!apiKey) throw new Error('TICKETMASTER_API_KEY not configured')

  const params = new URLSearchParams({
    apikey: apiKey,
    radius: String(input.radiusMiles),
    unit: 'miles',
    size: '20',
    sort: 'date,asc',
    startDateTime: input.startISO,
    endDateTime: input.endISO,
  })
  if (input.city) params.set('city', input.city)
  if (input.interests.length > 0) params.set('keyword', input.interests.slice(0, 3).join(' '))

  const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`)
  if (!res.ok) throw new Error(`Ticketmaster request failed (${res.status})`)
  const data = await res.json()
  const events = (data?._embedded?.events ?? []) as TmEvent[]
  return events.map(mapTicketmaster)
}

// ---------------------------------------------------------------------------
// Luma discover feed
// ---------------------------------------------------------------------------
// UNOFFICIAL: this is the endpoint lu.ma's own web app calls. No API key, no
// public docs, no support guarantee — it can change shape or disappear without
// notice, which is why any failure here just drops Luma from the feed rather than
// erroring the whole request. It also can't be reliably filtered by city
// server-side (the place params are ignored), so we pull the future feed and
// filter to the user's city in mapLuma's caller. Honest tradeoff: rich for dense
// startup/AI hubs (esp. SF/Bay Area), thin elsewhere — Ticketmaster carries the
// geographic breadth.

interface LumaEvent {
  api_id?: string
  name?: string
  url?: string
  cover_url?: string
  social_image_url?: string
  start_at?: string
  end_at?: string
  location_type?: string
  coordinate?: { latitude?: number; longitude?: number }
  geo_address_info?: { city?: string; city_state?: string; full_address?: string }
}

function mapLuma(ev: LumaEvent | undefined): NormalizedEvent | null {
  if (!ev?.api_id || !ev.name) return null
  const geo = ev.geo_address_info ?? {}
  const coord = ev.coordinate ?? {}
  const isVirtual = ev.location_type !== 'offline'

  return {
    id: `luma-${ev.api_id}`,
    source: 'luma',
    title: ev.name,
    description: '', // the discover feed carries no description
    startDate: ev.start_at ?? '',
    endDate: ev.end_at ?? null,
    location: {
      lat: typeof coord.latitude === 'number' ? coord.latitude : null,
      lng: typeof coord.longitude === 'number' ? coord.longitude : null,
      display: geo.full_address ?? geo.city_state ?? (isVirtual ? 'Virtual' : ''),
    },
    // `url` is the lu.ma slug; the public event page is lu.ma/<slug>.
    url: ev.url ? `https://lu.ma/${ev.url}` : '',
    isVirtual,
    category: 'Community',
    imageUrl: ev.cover_url ?? ev.social_image_url ?? null,
  }
}

async function lumaSource(input: SourceInput): Promise<NormalizedEvent[]> {
  const params = new URLSearchParams({ period: 'future', pagination_limit: '50' })
  const res = await fetch(`https://api.lu.ma/discover/get-paginated-events?${params}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Luma request failed (${res.status})`)
  const data = await res.json()
  const entries = (data?.entries ?? []) as Array<{ event?: LumaEvent }>
  const cityNeedle = input.city.toLowerCase()

  return entries
    .map((entry) => mapLuma(entry?.event))
    .filter((e): e is NormalizedEvent => e !== null)
    .filter(
      (e) =>
        // Keep virtual events, and (when we know the user's city) in-person events
        // whose location matches it. No city => keep everything.
        e.isVirtual || !cityNeedle || e.location.display.toLowerCase().includes(cityNeedle)
    )
}

// ---------------------------------------------------------------------------
// Meetup (stub)
// ---------------------------------------------------------------------------
// Intentionally disabled for v1: creating a Meetup OAuth consumer requires the
// creator to hold a paid Meetup Pro subscription, so there's no free path to
// query the GraphQL API. The signature is here so enabling it later is a
// localized change — add the OAuth token exchange + GraphQL query, map hits into
// NormalizedEvent, and add `meetup` to SOURCES below.
// eslint-disable-next-line no-unused-vars -- intentional stub; enabled once Meetup Pro is available
async function meetupSource(_input: SourceInput): Promise<NormalizedEvent[]> {
  return []
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

// Dedupe across sources on a coarse key: same title + same day + same venue. The
// same conference can surface from more than one aggregator.
function dedupe(events: NormalizedEvent[]): NormalizedEvent[] {
  const seen = new Set<string>()
  const out: NormalizedEvent[] = []
  for (const e of events) {
    const key = [
      e.title.trim().toLowerCase(),
      e.startDate.slice(0, 10),
      e.location.display.trim().toLowerCase(),
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

const SOURCES: Array<{ name: EventSource; run: (i: SourceInput) => Promise<NormalizedEvent[]> }> = [
  { name: 'ticketmaster', run: ticketmasterSource },
  { name: 'luma', run: lumaSource },
  // Meetup is gated behind Meetup Pro — wired but disabled for v1. To enable:
  // { name: 'meetup', run: meetupSource },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const location = String(body.location ?? '')
    const interests = Array.isArray(body.interests) ? (body.interests as string[]) : []
    const radiusMiles = Number(body.radiusMiles ?? 50)
    const daysAhead = Number(body.daysAhead ?? 60)

    // Ticketmaster wants ISO with no milliseconds (e.g. 2026-06-30T00:00:00Z).
    const now = new Date()
    const end = new Date(now.getTime() + daysAhead * 86_400_000)
    const stripMs = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

    const input: SourceInput = {
      city: location.split(',')[0].trim(),
      interests,
      radiusMiles,
      startISO: stripMs(now),
      endISO: stripMs(end),
    }

    // Fan out. allSettled => one source failing can't blank the feed.
    const settled = await Promise.allSettled(SOURCES.map((s) => s.run(input)))

    const collected: NormalizedEvent[] = []
    const sources: Record<string, 'ok' | 'error'> = {}
    settled.forEach((result, i) => {
      const name = SOURCES[i].name
      if (result.status === 'fulfilled') {
        sources[name] = 'ok'
        collected.push(...result.value)
      } else {
        sources[name] = 'error'
        console.error(`[events] source "${name}" failed:`, result.reason)
      }
    })

    const events = dedupe(collected)
      .filter((e) => e.startDate) // drop anything we couldn't date
      .sort((a, b) => a.startDate.localeCompare(b.startDate))

    return json({ events, sources })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
