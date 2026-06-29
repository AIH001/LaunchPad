import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { Login, RequireAuth, useAuth } from './features/auth'
import { ProfileForm } from './features/profile'
import { JobsFeed } from './features/jobs'

// Shared shell for logged-in pages: header with nav + sign-out.
function AppShell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth()
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <nav className="flex items-center gap-4">
            <Link to="/" className="text-lg font-semibold text-gray-900">
              LaunchPad
            </Link>
            <Link to="/jobs" className="text-sm text-gray-600 hover:text-gray-900">
              Jobs
            </Link>
            <Link to="/profile" className="text-sm text-gray-600 hover:text-gray-900">
              Profile
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-gray-500 sm:inline">{user?.email}</span>
            <button
              type="button"
              onClick={signOut}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </div>
  )
}

function Dashboard() {
  return (
    <AppShell>
      <h2 className="text-xl font-semibold text-gray-900">Welcome</h2>
      <p className="mt-2 text-gray-600">
        Set up your <Link to="/profile" className="underline">profile</Link> to get started.
      </p>
    </AppShell>
  )
}

function ProfilePage() {
  return (
    <AppShell>
      <h2 className="mb-6 text-xl font-semibold text-gray-900">Your profile</h2>
      <ProfileForm />
    </AppShell>
  )
}

function JobsPage() {
  return (
    <AppShell>
      <h2 className="mb-6 text-xl font-semibold text-gray-900">Job matches</h2>
      <JobsFeed />
    </AppShell>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
