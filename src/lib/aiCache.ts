import { supabase } from './supabase'

// The three expensive AI views that persist across reloads via the `ai_cache`
// table (see the create_ai_cache migration). Keep in sync with the table's
// `kind` check constraint.
export type AiCacheKind = 'game_plan' | 'events' | 'digest'

// A cached view read back from the DB: the ready-to-render payload plus when it
// was generated (drives the "updated <time ago>" caption).
export type AiCacheEntry<T> = { payload: T; generatedAt: string }

// Read this user's cached payload for a view, or null if none exists yet.
// Best-effort: a read failure returns null so the caller just regenerates rather
// than surfacing a cache error to the user.
export async function readAiCache<T>(
  userId: string,
  kind: AiCacheKind
): Promise<AiCacheEntry<T> | null> {
  const { data, error } = await supabase
    .from('ai_cache')
    .select('payload, generated_at')
    .eq('user_id', userId)
    .eq('kind', kind)
    .maybeSingle()
  if (error || !data) return null
  return { payload: data.payload as T, generatedAt: data.generated_at as string }
}

// Upsert this user's cached payload for a view, stamping generated_at = now().
// Returns the timestamp written so the caller can update its caption without a
// re-read. Best-effort: a write failure is swallowed (the in-memory state is
// still correct for this session; only cross-reload persistence is lost).
export async function writeAiCache<T>(
  userId: string,
  kind: AiCacheKind,
  payload: T
): Promise<string> {
  const generatedAt = new Date().toISOString()
  await supabase
    .from('ai_cache')
    .upsert(
      { user_id: userId, kind, payload, generated_at: generatedAt },
      { onConflict: 'user_id,kind' }
    )
  return generatedAt
}
