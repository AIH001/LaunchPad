// events: proxy to the Eventbrite API for local tech events.
// The browser calls THIS; this calls Eventbrite using the EVENTS_API_KEY secret.
import { corsHeaders, json } from '../_shared/cors.ts'

interface EventbriteVenue {
  name?: string
  address?: {
    city?: string
    localized_address_display?: string
  }
}

interface EventbriteEvent {
  id: string
  name: { text: string }
  description?: { text: string }
  url: string
  start: { local: string }
  is_free?: boolean
  venue?: EventbriteVenue
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { location = '', skills = [] } = await req.json().catch(() => ({}))

    const apiKey = Deno.env.get('EVENTS_API_KEY')
    if (!apiKey) {
      return json({ error: 'Events API key not configured.' }, 500)
    }

    // Use the user's top skills as search keywords; fall back to broad tech terms.
    const query =
      Array.isArray(skills) && skills.length > 0
        ? (skills as string[]).slice(0, 3).join(' ')
        : 'technology developer'

    // Eventbrite needs an ISO datetime with no milliseconds.
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

    const params = new URLSearchParams({
      q: query,
      'location.address': location || 'United States',
      'location.within': '50mi',
      categories: '102', // Technology & Science
      expand: 'venue',
      sort_by: 'date',
      'start_date.range_start': now,
    })

    const res = await fetch(
      `https://www.eventbriteapi.com/v3/events/search/?${params}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    )

    if (!res.ok) {
      const detail = await res.text()
      return json(
        { error: `Eventbrite request failed (${res.status})`, detail },
        502
      )
    }

    const data = await res.json()

    const events = ((data.events ?? []) as EventbriteEvent[])
      .slice(0, 12)
      .map((e) => ({
        id: e.id,
        title: e.name.text,
        description: (e.description?.text ?? '').slice(0, 800),
        venue: e.venue?.name ?? '',
        city:
          e.venue?.address?.city ??
          e.venue?.address?.localized_address_display ??
          '',
        dateLocal: e.start.local,
        url: e.url,
        isFree: e.is_free ?? false,
      }))

    return json({ events })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
