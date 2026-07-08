// Shared CORS headers for all Edge Functions. The browser will refuse to read
// a response from a different origin unless these are present.
//
// The allowed origin comes from the ALLOWED_ORIGIN secret (set it to the
// deployed frontend URL, e.g. https://launchpad.vercel.app). When unset —
// local dev, `supabase functions serve` — we fall back to '*'. Honest
// tradeoff: the fallback fails OPEN so a missing secret degrades to dev
// behavior instead of breaking the app; the deploy checklist in
// docs/PRODUCTION_READINESS.md includes setting it.
const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') ?? '*'

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  // When locked to one origin, tell caches the response varies by Origin.
  ...(allowedOrigin === '*' ? {} : { Vary: 'Origin' }),
}

// Small helper: JSON response with CORS headers attached.
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
