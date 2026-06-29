// jobs: proxy to the Adzuna job-search API.
// The browser calls THIS (with the user's auth token), and this function calls
// Adzuna using the secret app_id/app_key — so those keys never reach the client.
import { corsHeaders, json } from '../_shared/cors.ts'

// The subset of Adzuna's response we actually use.
interface AdzunaJob {
  id: string | number
  title: string
  company?: { display_name?: string }
  location?: { display_name?: string }
  description: string
  redirect_url: string
  salary_min?: number
  salary_max?: number
  created: string
}

Deno.serve(async (req) => {
  // Answer the browser's CORS preflight before doing any work.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Inputs from the frontend (all optional). Default country to US.
    const { query = '', location = '', country = 'us' } = await req
      .json()
      .catch(() => ({}))

    const appId = Deno.env.get('ADZUNA_APP_ID')
    const appKey = Deno.env.get('ADZUNA_APP_KEY')
    if (!appId || !appKey) {
      return json({ error: 'Adzuna credentials are not configured.' }, 500)
    }

    // Adzuna passes credentials + filters as query params.
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: '20',
      what: query,
      where: location,
    })
    const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`

    const res = await fetch(url)
    if (!res.ok) {
      const detail = await res.text()
      return json({ error: `Adzuna request failed (${res.status})`, detail }, 502)
    }
    const data = await res.json()

    // Normalize Adzuna's verbose shape into a lean object our UI controls.
    // (Decoupling our frontend from the third-party schema is good practice —
    // if we swap job providers later, only this mapping changes.)
    const jobs = (data.results ?? []).map((j: AdzunaJob) => ({
      id: String(j.id),
      title: j.title,
      company: j.company?.display_name ?? 'Unknown',
      location: j.location?.display_name ?? '',
      description: j.description,
      url: j.redirect_url,
      salaryMin: j.salary_min ?? null,
      salaryMax: j.salary_max ?? null,
      created: j.created,
    }))

    return json({ jobs })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
