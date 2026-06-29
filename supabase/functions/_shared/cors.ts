// Shared CORS headers for all Edge Functions. The browser will refuse to read
// a response from a different origin unless these are present. '*' is fine for
// development; in production you'd lock this to your real frontend domain.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

// Small helper: JSON response with CORS headers attached.
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
