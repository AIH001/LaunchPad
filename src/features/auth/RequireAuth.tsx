import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'

// Route guard for the logged-in area. NOTE: this is UX only — it just hides
// the UI from logged-out users. Real data access control is enforced by
// Row Level Security on every Supabase table (see CLAUDE.md). The browser is
// never trusted.
export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">
        Loading…
      </div>
    )
  }

  if (!user) {
    // Remember where they were headed so we can send them back after login.
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}
