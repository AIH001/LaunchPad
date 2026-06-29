import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

type Mode = 'signin' | 'signup'

export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  // Where to return after a successful login (set by RequireAuth), default home.
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/'

  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const handleEmailAuth = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setNotice(null)

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else navigate(from, { replace: true })
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setNotice('Check your email to confirm your account, then sign in.')
    }

    setLoading(false)
  }

  const handleGoogle = async () => {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setError(error.message)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-4 font-sans text-ink">
      <div className="w-full max-w-sm rounded-[18px] border border-line bg-surface p-8 shadow-[0_6px_24px_rgba(40,30,15,.05)]">
        <div className="mb-6 flex items-center gap-[11px]">
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-accent text-[18px] font-bold text-white shadow-[0_2px_6px_rgba(0,0,0,.12)]">
            ↗
          </div>
          <div>
            <div className="font-display text-[17px] font-bold tracking-[-.01em]">
              Launchpad
            </div>
            <div className="font-mono text-[10px] tracking-[.06em] text-faint">
              AI CAREER COPILOT
            </div>
          </div>
        </div>

        <p className="mb-6 text-[14px] text-muted">
          {mode === 'signin' ? 'Sign in to your account' : 'Create your account'}
        </p>

        <button
          type="button"
          onClick={handleGoogle}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-[11px] border border-line-soft2 bg-surface px-4 py-3 text-[14px] font-medium text-ink transition-colors hover:bg-field"
        >
          Continue with Google
        </button>

        <div className="my-4 flex items-center gap-3 font-mono text-[11px] text-faint">
          <span className="h-px flex-1 bg-line-soft" />
          or
          <span className="h-px flex-1 bg-line-soft" />
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-[10px] block font-mono text-[11px] uppercase tracking-[.07em] text-faint">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-[11px] border border-line-soft2 bg-field px-[14px] py-3 text-[14px] focus:border-faint focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-[10px] block font-mono text-[11px] uppercase tracking-[.07em] text-faint">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-[11px] border border-line-soft2 bg-field px-[14px] py-3 text-[14px] focus:border-faint focus:outline-none"
            />
          </div>

          {error && <p className="text-[14px] text-[#b4452f]">{error}</p>}
          {notice && <p className="text-[14px] text-success-ink">{notice}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-[11px] bg-accent px-4 py-3 text-[14px] font-semibold text-white shadow-[0_2px_8px_rgba(190,80,40,.22)] transition-colors hover:brightness-95 disabled:opacity-60"
          >
            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
          </button>
        </form>

        <p className="mt-6 text-center text-[14px] text-muted">
          {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setError(null)
              setNotice(null)
            }}
            className="font-semibold text-accent-ink underline underline-offset-2"
          >
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}
