// news: proxy to the Hacker News (Algolia) front-page API.
// HN needs no API key, so unlike the jobs/claude functions there's no secret to
// protect here — this proxy exists so the browser has one consistent, CORS-clean
// way to fetch news, and so swapping the news source later only touches this file.
//
// The one HTTP call returns ~30 front-page stories. The browser hands these to
// the `claude` function (task: summarize_digest) to filter + tag them — that's
// where the real AI work happens; this file is a thin, key-less fetch.
import { corsHeaders, json } from '../_shared/cors.ts'

// The subset of Algolia's HN response we use. (Full shape has more fields.)
interface HnHit {
  objectID: string
  title: string | null
  url: string | null
  points: number | null
  num_comments: number | null
  author: string | null
  created_at: string | null
}

// Pull a readable source label from the story URL ("github.com/x" -> "github.com").
// Front-page "Ask HN"/"Show HN" posts have no URL — those are from HN itself.
function sourceFrom(url: string | null): string {
  if (!url) return 'Hacker News'
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Hacker News'
  }
}

Deno.serve(async (req) => {
  // Answer the browser's CORS preflight before doing any work.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // How many front-page stories to pull. The frontend/Claude trims further.
    const { limit = 30 } = await req.json().catch(() => ({}))

    const params = new URLSearchParams({
      tags: 'front_page',
      hitsPerPage: String(limit),
    })
    const url = `https://hn.algolia.com/api/v1/search?${params}`

    const res = await fetch(url)
    if (!res.ok) {
      const detail = await res.text()
      return json({ error: `Hacker News request failed (${res.status})`, detail }, 502)
    }
    const data = await res.json()

    // Normalize HN's shape into a lean object our UI + Claude prompt control.
    // A story with no URL links to its HN discussion page instead.
    const stories = ((data.hits ?? []) as HnHit[])
      .filter((h) => h.title) // drop the occasional title-less hit
      .map((h) => ({
        id: h.objectID,
        title: h.title as string,
        url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
        source: sourceFrom(h.url),
        points: h.points ?? 0,
        comments: h.num_comments ?? 0,
        author: h.author ?? '',
        created: h.created_at ?? '',
      }))

    return json({ stories })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
