import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'

export async function updateSession(request: Request) {
  const headers = new Headers(request.headers)

  const supabase = createServerClient(
    import.meta.env.VITE_SUPABASE_URL!,
    import.meta.env.VITE_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(request.headers.get('Cookie') ?? '')
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            headers.append('Set-Cookie', serializeCookieHeader(name, value, options))
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  return { supabase, headers, user }
}
