import { Routes, Route, Navigate } from 'react-router-dom'
import { Login, RequireAuth } from './features/auth'
import { ProfileForm } from './features/profile'
import { JobsFeed, SavedJobsList } from './features/jobs'
import { CoverLetters } from './features/coverLetter'
import { DailyDigest } from './features/news'
import { EventsFeed } from './features/events'
import { AppShell } from './components/AppShell'

function JobsPage() {
  return (
    <AppShell
      kicker="YOUR FEED"
      title="Job matches"
      subtitle="Ranked by how well each role fits your profile."
    >
      <JobsFeed />
    </AppShell>
  )
}

function ProfilePage() {
  return (
    <AppShell
      kicker="ACCOUNT"
      title="Your profile"
      subtitle="Set it once — Claude uses this everywhere. Synced across devices."
    >
      <ProfileForm />
    </AppShell>
  )
}

function SavedPage() {
  return (
    <AppShell
      kicker="YOUR FEED"
      title="Saved jobs"
      subtitle="Roles you've saved to revisit."
    >
      <SavedJobsList />
    </AppShell>
  )
}

function CoverPage() {
  return (
    <AppShell
      kicker="DRAFTING"
      title="Cover letters"
      subtitle="One click from any role. Claude tailors it, you edit."
    >
      <CoverLetters />
    </AppShell>
  )
}

function DigestPage() {
  return (
    <AppShell
      kicker="STAY SHARP"
      title="Daily digest"
      subtitle="Today's tech news, filtered to your stack and summarized."
    >
      <DailyDigest />
    </AppShell>
  )
}

function EventsPage() {
  return (
    <AppShell
      kicker="NEARBY"
      title="Events worth attending"
      subtitle="Pulled by location — Claude flags which ones are worth your time."
    >
      <EventsFeed />
    </AppShell>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Navigate to="/jobs" replace />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/saved" element={<SavedPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/cover" element={<CoverPage />} />
        <Route path="/digest" element={<DigestPage />} />
        <Route path="/events" element={<EventsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
