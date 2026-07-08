import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

// The one class component in the codebase, by necessity: React only supports
// error boundaries via class lifecycle methods (getDerivedStateFromError) —
// there is no hook equivalent. Without this, any render-time throw (e.g. a
// malformed AI payload dereferenced in JSX) white-screens the whole app,
// which violates the "never let a failed call show a blank screen" rule.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="flex h-screen items-center justify-center bg-app px-6">
        <div className="w-full max-w-[420px] rounded-[18px] border border-line bg-surface px-8 py-9 text-center shadow-[0_6px_24px_rgba(40,30,15,.05)]">
          <h1 className="font-display text-[19px] font-semibold text-ink">
            Something went wrong
          </h1>
          <p className="mt-2 text-[14px] leading-[1.6] text-muted">
            An unexpected error crashed this screen. Reloading usually fixes it
            — your profile, saved jobs, and letters are safe on your account.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-[11px] bg-accent px-6 py-3 text-[14px] font-semibold text-white shadow-[0_2px_8px_rgba(190,80,40,.22)]"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
