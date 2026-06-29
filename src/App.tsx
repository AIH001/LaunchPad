import { Routes, Route, Navigate } from 'react-router-dom'
import { Login, RequireAuth, useAuth } from './features/auth'

// Temporary landing page for logged-in users. Real feature routes
// (jobs, profile, news, events) get added under RequireAuth as they're built.
function Dashboard() {
  const { user, signOut } = useAuth()
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto flex max-w-3xl items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">LaunchPad</h1>
        <button
          type="button"
          onClick={signOut}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Sign out
        </button>
      </div>
      <p className="mx-auto mt-8 max-w-3xl text-gray-600">
        Signed in as {user?.email}
      </p>
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Dashboard />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
