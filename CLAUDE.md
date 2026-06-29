# Launchpad

An AI career copilot for early-career developers. Helps users find jobs they're a fit for, draft tailored cover letters, stay current on tech news, and find local networking events. Built as a portfolio project for a Claude Corps fellowship application.

## What this app does

Users sign up, set up a profile once (resume + skills + interests + location), then get:

1. **Job match feed** — real listings scored against their profile by Claude, with a "why you fit / gaps to address" breakdown.
2. **Cover letter drafter** — one-click tailored cover letter for any listing, editable and saved to their account.
3. **Daily tech digest** — top tech stories, summarized and filtered to their stack by Claude.
4. **Networking events** — local events with Claude flagging which are worth attending and why.

## Tech stack

- **Framework:** Vite + React + **TypeScript**
- **Auth:** Supabase Auth (email + Google OAuth)
- **Database:** Supabase Postgres
- **API proxying:** Supabase Edge Functions (Deno) — all third-party API calls go through here
- **Styling:** [fill in once chosen — e.g. Tailwind CSS]
- **AI:** Anthropic Claude API, model `claude-sonnet-4-6`
- **External data:** Adzuna API (jobs), NewsAPI (tech news), Eventbrite or Meetup API (events)
- **Deploy:** Vercel (frontend), Supabase (backend)

## Project structure

```
src/
  components/      # Reusable UI components
  features/        # Feature modules (jobs, coverLetter, news, events, profile, auth)
  lib/             # Supabase client, typed API helpers, shared utils
  hooks/           # Custom React hooks
  types/           # Shared TypeScript types/interfaces
  App.tsx
  main.tsx
supabase/
  functions/       # Edge Functions (claude, jobs, news, events proxies)
  migrations/      # SQL schema migrations
```

Keep each feature self-contained under `features/`. Shared logic and the Supabase client live in `lib/`. Shared types live in `types/`.

## Data model

```
profiles        id (fk auth.users), resume_text, skills[], interests[], location, timestamps
saved_jobs      id, user_id, job_payload (jsonb), match_score, match_reasoning, created_at
cover_letters   id, user_id, job_id (fk saved_jobs), body, timestamps
```

Enable Row Level Security on all tables — users can only read/write their own rows.

## Commands

```bash
npm run dev              # Start dev server
npm run build            # Production build (runs tsc + vite build)
npm run preview          # Preview production build
npm run lint             # Lint
supabase start           # Local Supabase stack
supabase functions serve # Run Edge Functions locally
supabase db push         # Apply migrations
```

## Conventions

- **TypeScript:** no `any` unless genuinely unavoidable, and comment why if so. Share types via `types/`. Prefer `type`/`interface` for all API payloads and DB rows.
- **Components:** functional components with hooks only. No class components.
- **Naming:** PascalCase for components, camelCase for functions/variables, kebab-case for non-component files.
- **API keys:** NEVER in client code. All Anthropic/jobs/news/events keys live as Supabase Edge Function secrets. The browser calls Edge Functions; Edge Functions call the third-party APIs.
- **Supabase client:** single instance in `lib/supabase.ts`. Don't instantiate ad hoc.
- **Claude calls:** centralize in the `claude` Edge Function. Always set `max_tokens` explicitly. Handle errors and loading states in the UI — never let a failed call show a blank screen.
- **RLS:** every table has Row Level Security on, scoped to `auth.uid()`. Never disable it to "make something work" — fix the policy.
- **Styling:** polished and responsive down to mobile. Visible keyboard focus, sensible empty and error states.

## Working agreements

- **Be honest about tradeoffs.** If something's a shortcut, say so and note what it costs — I have to talk about these in interviews.
- **Flag when Claude is doing real work vs. just wrapping an API.** I need to articulate the difference.
- **Don't over-engineer.** This ships in two weeks. Prefer the simple version that works over the clever version that's fragile. Ask before adding heavy dependencies.
- **Security is not optional.** Keys stay server-side, RLS stays on. If a quick path would expose either, flag it instead of taking it.
- **Explain before big changes.** Before adding a dependency, a new pattern, or restructuring folders, tell me what and why first.
- **Small, reviewable steps.** I'm early-career and learning — I want to understand the code, not just receive it. Walk me through non-obvious parts.
## Out of scope for v1

- Native mobile (responsive web only)
- Team/multi-user features (single-user accounts only)
- Payment / subscriptions

## Environment

Frontend (`.env`, gitignored) — only the public-safe Supabase values:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Edge Function secrets (set via `supabase secrets set`, never in the repo):

```
ANTHROPIC_API_KEY
ADZUNA_APP_ID
ADZUNA_APP_KEY
NEWS_API_KEY
EVENTS_API_KEY
```
