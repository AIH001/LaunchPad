import { createClient } from '../utils/supabase/client'

// Single browser client instance for the whole app. Import this everywhere —
// never call createClient() ad hoc (see CLAUDE.md conventions).
export const supabase = createClient()
