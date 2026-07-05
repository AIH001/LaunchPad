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
- **Background jobs:** `ingest-jobs` Edge Function on a GitHub Actions cron syncs job sources into the DB (see Jobs architecture)
- **Styling: see the design document below
- **AI:** Anthropic Claude API, model `claude-sonnet-4-6`
- **External data:** jobs ingested from Adzuna + Remotive + Greenhouse/Lever/Ashby/SmartRecruiters/Workable boards + SimplifyJobs; Hacker News (tech news); Ticketmaster Discovery + Luma (events)
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

Per-user tables (RLS scoped to `auth.uid()` — a user reads/writes only their own rows):

```
profiles        id (fk auth.users), resume_text, skills[], interests[], location, timestamps
saved_jobs      id, user_id, job_payload (jsonb), match_score, match_reasoning, created_at
cover_letters   id, user_id, job_id (fk saved_jobs), body, timestamps
job_scores      (user_id, job_id) pk, score, why_fit, gaps, stretch — per-user Claude match cache
```

Global (shared) tables — the database-first jobs pipeline (see below). RLS here is
**authenticated read-only** (`using (true)` + explicit grants); the ONLY writer is
the ingest worker via the service-role key:

```
job_sources     id, kind ('ats_board'|'search_query'|'scrape'), source, token, query, display_name,
                is_active, last_synced_at, last_status, last_error, timestamps  — the WHERE-to-ingest catalog
jobs            id, source, external_job_id, external_id (=`${source}:${externalId}`), title, company,
                location, description, url, salary_min/max, posted_at, is_early_career,
                content_hash/search_tsv (generated), first_seen_at/last_seen_at/closed_at/is_active
ingestion_runs  id, started_at, finished_at, per_source (jsonb)  — sync observability
```

Enable Row Level Security on every table. Per-user tables scope to `auth.uid()`; the
global jobs tables are read-only to authenticated users and written only by the
service-role ingest worker (never disable RLS to "make writes work" — that's what the
service role is for).

### Jobs architecture (database-first)

The `jobs` feed does NOT call source APIs live per search. A scheduled worker
(`ingest-jobs` Edge Function, triggered by a GitHub Actions cron) walks the
`job_sources` catalog, fetches each source (per-company ATS boards, global search
APIs run against standing early-career queries, and scrapes), normalizes via the
mappers in `jobs/lib.ts`, and upserts into the `jobs` table — marking listings that
disappeared as `is_active=false`. The user-facing `jobs` function then just runs a
Postgres full-text query over that table and returns the same
`{ jobs, sources, timings }` shape as before, so the frontend (`useJobs.ts`) and the
per-user Claude scoring (`job_scores`) are unchanged. `sources` now reflects each
source's last **sync** health. Honest tradeoffs: the feed can lag by up to one cron
interval; "full ingestion" of the global search APIs is only as broad as the standing
`search_query` rows in `job_sources`; HN "Who is hiring?" ingestion is currently
deferred (it needs an auth-gated Claude call the service-role worker can't make yet).

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
TICKETMASTER_API_KEY
INGEST_SECRET             # shared secret gating the ingest-jobs worker; also set
                         # as the GitHub Actions repo secret of the same name
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected
by the platform. The service-role key is used ONLY by the `ingest-jobs` worker to
write the global jobs tables — never ship it to the browser. The GitHub Actions
cron also needs two repo secrets: `INGEST_FUNCTION_URL` and `INGEST_SECRET`.

Optional job-source secrets (the `ingest-jobs` worker degrades gracefully without
them — each source row reports `skipped` or `error` in `job_sources.last_status`
and the jobs table still fills from the others):

```
THEMUSE_API_KEY    # optional — The Muse works keyless at a lower rate limit
JOOBLE_API_KEY     # required for Jooble; approval takes ~a day. Until set, the
                   # Jooble source rows report `skipped` (no error banner shown)
```

Keyless sources (no secret needed): tech news uses Hacker News (Algolia); events
also pulls Luma's public discover feed (unofficial endpoint); the `ingest-jobs`
worker syncs the keyless Remotive API, Greenhouse/Lever/Ashby/SmartRecruiters/
Workable public per-company boards, and a scrape of the SimplifyJobs
Summer2026-Internships README into the `jobs` table. Which companies/queries get
ingested is data in the `job_sources` catalog (seeded in `supabase/seed.sql`), not
hardcoded — extend coverage by adding rows. The Ashby/SmartRecruiters/Workable
catalog ships with no rows yet: add real, curl-verified company slugs before they
surface any jobs. HN "Who is hiring?" ingestion is deferred (needs an auth-gated
Claude call). Meetup is a documented stub in the `events` function — enabling it
needs a paid Meetup Pro subscription to create an OAuth consumer.
# Handoff: Launchpad — design document

---

## About the Design Files
The file in this bundle (`Launchpad.dc.html`) found at C:\Users\Ahmad Harris\Desktop\AINCProjects\LaunchPad\src\reference
is a **design reference created in HTML** — a working prototype that demonstrates the intended look, layout, copy, and interaction behavior. **It is not production code to copy directly.**

It was authored as a "Design Component" (a streaming HTML format with a small custom template/logic runtime). **Do not try to port that runtime.** The task is to **recreate the design in your target codebase's existing environment** — React — using that codebase's established components, styling system, routing, and data-fetching patterns.
The prototype uses **hardcoded sample data** (a persona named "Maya Chen", five sample jobs, four digest items, four events) to make the UI feel real. In production these become live data sources + Claude API calls. The sample content is documented below so you can mirror structure and tone, but the strings themselves are placeholders.

---

## Fidelity
**High-fidelity (hifi).** Colors, typography, spacing, border radii, and interactions are final and intentional. Recreate the UI to match — pixel-accurate where your component library allows — then wire it to real data. Where your existing design system has equivalent primitives (buttons, inputs, chips, cards), prefer those but tune them to the tokens below so the warm/developer-native character is preserved.

---

## Global Layout & Shell

App shell is a full-viewport two-pane flex layout:

```
┌──────────────┬─────────────────────────────────────────┐
│  Sidebar     │  Main                                    │
│  250px fixed │  flex:1                                   │
│              │  ┌─────────────────────────────────────┐ │
│  logo        │  │ Header (kicker / title / subtitle)  │ │
│  nav (5)     │  │            + "synced" pill (right)  │ │
│              │  ├─────────────────────────────────────┤ │
│              │  │ Scrollable content area             │ │
│  ──────      │  │ (one of 5 screens)                  │ │
│  profile     │  │                                     │ │
│  mini-card   │  │                                     │ │
└──────────────┴─────────────────────────────────────────┘
```

- Root: `display:flex; height:100vh; min-height:640px; overflow:hidden;` background `#f1ece2`, text color `#211c16`, base font IBM Plex Sans.
- **Sidebar**: `width:250px; flex:none;` background `#ece5d8`, right border `1px solid #ddd3c2`, padding `20px 16px`, vertical flex column.
- **Main**: `flex:1; min-width:0;` background `#f4f0e8`, vertical flex column, its own internal scroll.
- **Header**: `padding:22px 34px 20px;` bottom border `1px solid #e6ddcd`, flex row, `align-items:flex-end; justify-content:space-between`.
- **Content area**: `flex:1; overflow:auto; padding:26px 34px 60px;`

### Sidebar — Logo
- Row, `gap:11px`, padding `4px 8px 18px`.
- Mark: `34×34px`, `border-radius:9px`, background = accent (`#d4663a`), white `↗` glyph at 18px/700, shadow `0 2px 6px rgba(0,0,0,.12)`.
- Wordmark: "Launchpad" — Space Grotesk 700, 17px, letter-spacing `-.01em`.
- Tagline under it: "AI CAREER COPILOT" — IBM Plex Mono, 10px, letter-spacing `.06em`, color `#9a917f`.

### Sidebar — Nav (5 items)
Items in order: **Job Matches, Profile, Cover Letters, Daily Digest, Events**. Vertical stack, `gap:3px`. Each item is a full-width button:
- Base: `display:flex; align-items:center; gap:10px; width:100%; padding:9px 12px; border-radius:10px; font-size:14px; text-align:left; transition:background .12s;`
- **Active**: background `#fffefb`, border `1px solid #ece4d6`, color `#211c16`, font-weight 600, shadow `0 1px 2px rgba(0,0,0,.03)`.
- **Inactive**: transparent background, transparent border, color `#6b6358`, font-weight 500.
- Leading marker dot: `6×6px`, `border-radius:2px`. Accent (`#d4663a`) when active, `#d8cfc0` when inactive.
- **Job Matches** carries a count badge (right-aligned): IBM Plex Mono 11px, `min-width:20px; height:20px; padding:0 6px; border-radius:6px;` background accent, white text — shows the number of jobs currently passing the match filter.

### Sidebar — Profile mini-card (pinned bottom, `margin-top:auto`)
Full-width button, `padding:11px`, `border-radius:12px`, background `#fbf7f0`, border `1px solid #e2dacc`, row with `gap:11px`. Clicking navigates to Profile.
- Avatar: `36×36px` circle, background `#211c16`, text `#f1ece2`, Space Grotesk 600 14px, user initials.
- Name: 13px/600, truncates. Below it: level string, 11px, color `#9a917f`, truncates.

### Header (per-screen)
- Kicker: IBM Plex Mono 11px, letter-spacing `.1em`, color `#a89e8a`, margin-bottom 5px.
- Title: Space Grotesk 600, 25px, letter-spacing `-.02em`.
- Subtitle: 14px, color `#6b6358`, `max-width:560px`, margin-top 5px.
- Right "synced" pill: `padding:6px 12px; border-radius:999px;` background `#eef3ec`, border `1px solid #d8e3d2`; a `7px` green (`#2f8f63`) dot + IBM Plex Mono 11px text `"synced · Sat, Jun 28"` in color `#3d6b50`.

Per-screen header strings (kicker / title / subtitle):
- **Job Matches**: `YOUR FEED` / `Job matches` / `Ranked by how well each role fits your profile.`
- **Profile**: `ACCOUNT` / `Your profile` / `Set it once — Claude uses this everywhere. Synced across devices.`
- **Cover Letters**: `DRAFTING` / `Cover letters` / `One click from any role. Claude tailors it, you edit.`
- **Daily Digest**: `STAY SHARP` / `Daily digest` / `Today's tech news, filtered to your stack and summarized.`
- **Events**: `NEARBY` / `Events worth attending` / `Pulled by location — Claude flags which ones are worth your time.`

---

## Screens / Views

### 1. Job Matches (default screen)
**Purpose:** Browse an opinionated, AI-ranked feed of roles and inspect why each fits.

**Layout:** Two columns inside the content area, `display:flex; gap:24px; align-items:flex-start; flex-wrap:wrap`.
- **Left (list):** `flex:1; min-width:340px;` vertical stack `gap:11px`. Topped by a mono caption `"{N} roles · ranked by fit"` (12px, `#9a917f`).
- **Right (detail panel):** `width:404px; flex:none; align-self:flex-start; position:sticky; top:0;` — sticks while the list scrolls. On narrow widths it wraps below the list.

**Job list card** (button, full width):
- `display:flex; align-items:center; gap:14px; padding:14px 16px; border-radius:14px; transition:border-color .12s, background .12s;`
- **Selected**: background `#fffefb`, border `1px solid` accent, shadow `0 3px 12px rgba(40,30,15,.06)`.
- **Unselected**: background `#fbf7f0`, border `1px solid #e8e0d2`.
- Logo tile: `44×44px`, `border-radius:11px`, background `#211c16`, text `#f1ece2`, Space Grotesk 600 18px (single-char company glyph).
- Middle block: role (15px/600, letter-spacing `-.01em`); `company · loc` (13px, `#6b6358`, margin-top 2px); salary (IBM Plex Mono 12px, `#9a917f`, margin-top 3px).
- Right block (align right, `gap:6px`): score as Space Grotesk 700 22px with a 12px `%` in `#a89e8a`/500; under it a progress track `72px × 5px`, `border-radius:3px`, background `#e6ddcd`, fill width = score%, fill color by score band (see below).

**Detail panel** (card: background `#fffefb`, border `1px solid #e8e0d2`, `border-radius:18px; padding:24px;` shadow `0 6px 24px rgba(40,30,15,.05)`):
- Kicker `SELECTED ROLE` (mono 11px, `#a89e8a`).
- Role title: Space Grotesk 600, 21px. Below: `company · loc` 14px `#6b6358`.
- Salary chip: inline-block, mono 12px, `padding:5px 10px; border-radius:8px;` background `#f1ece2`, border `1px solid #e6ddcd`.
- Score row: big score Space Grotesk 700 40px (18px `%`), beside a label + a `7px` tall full-width progress bar. Label text by band: ≥85 `Strong match` (`#2f8f63`), ≥75 `Good match` (`#b05a30`), else `Worth a look` (`#9a7a3f`).
- **"Why Claude matched you" box** (only if reasoning enabled — see tokens): background `#faf2ea`, border `1px solid #f0e2d3`, `border-radius:13px; padding:16px`.
    - Header: a `9px` accent diamond (rotated 45° square) + mono label `WHY CLAUDE MATCHED YOU` (11px, letter-spacing `.06em`, `#7a5a3f`).
    - Fit list: each row `gap:9px`, a `6px` green (`#2f8f63`) dot + text (13.5px, line-height 1.45).
    - Divider: `1px` `#eaddcd`, margin `13px 0`.
    - Gaps label: mono 11px `#9a7a3f` `GAPS TO ADDRESS`. Gap rows: `6px` amber (`#c08a2d`) dot + text (13.5px, color `#5a5347`).
- Actions row (`gap:10px`): primary **Draft cover letter** (flex:1, accent bg, white, `padding:12px; border-radius:11px; font-weight:600;` shadow `0 2px 8px rgba(190,80,40,.22)`) + secondary **Save** (white bg, border `1px solid #e2dacc`, `#3a3329` text).

### 2. Profile
**Purpose:** One-time setup that everything else reads from; editable anytime.

**Layout:** single column, `max-width:740px`.
- **Identity card** (background `#fffefb`, border `1px solid #e8e0d2`, `border-radius:18px; padding:22px 24px;` row `gap:18px`): `62px` circle avatar (`#211c16` bg, initials, Space Grotesk 24px) + name (Space Grotesk 22px), target (14px `#6b6358`), and `location · level` (mono 12px `#9a917f`).
- **Form card** below (margin-top 16px, same card style, `padding:24px`, column `gap:20px`). Every field label is mono 11px uppercase `#9a917f`, letter-spacing `.07em`, margin-bottom 8–10px.
    - **About / pasted resume**: 4-row textarea. Inputs/textarea style: `padding:12px 14px; border:1px solid #e2dacc; border-radius:11px; font-size:14px; background:#fbf7f0; color:#211c16;` textarea line-height 1.5.
    - **Target role** + **Location**: two inputs in a `gap:16px` wrap row, each `flex:1; min-width:220px`.
    - **Skills**: removable chips + an inline add-input. Chip: `display:inline-flex; align-items:center; gap:7px; padding:6px 8px 6px 12px; border-radius:999px;` mono 12.5px, background `#f1ece2`, border `1px solid #e2dacc`; trailing `×` remove button = `17px` circle, background `#e0d6c5`, color `#6b6358`. Add input: dashed border `1px dashed #d2c8b6`, transparent bg, placeholder `"add skill + ↵"`, commits on Enter.
    - **Interests**: read-only chips, warm tint — mono 12.5px, `padding:6px 12px; border-radius:999px;` background `#faf2ea`, border `1px solid #f0e2d3`, color `#7a5a3f`.
    - Footer row: **Save profile** primary button (accent) + helper text `"Stored on your account — follows you across devices."` (13px `#9a917f`). Saving fires the toast `"Profile saved — synced across your devices"`.

### 3. Cover Letters
**Purpose:** Generate, edit, and save a tailored letter for a selected role. Has three states.

**Layout:** single column, `max-width:760px`.
- **Idle / empty** (no letter yet): dashed card `1px dashed #d8cdbb`, `border-radius:18px; padding:48px 32px;` centered. Title "No letter drafted yet" (Space Grotesk 19px/600), body copy (14px `#6b6358`, max-width 380px), and a **Go to job matches** accent button.
- **Drafting** (transient, ~1.6s): card, centered. A `34px` spinner ring (`border:3px solid #ece4d6; border-top-color:` accent; `animation: spin .8s linear infinite`), title "Claude is drafting your letter…" (Space Grotesk 17px/600), and subtext `"Tailoring to {role} at {company}"` (13px `#9a917f`).
- **Done**: card. Header row: kicker `TAILORED FOR` + `{role} · {company}` (Space Grotesk 18px), with right-aligned action buttons **Copy** (accent), **Regenerate** (white/border), **Save** (white/border), small (9px 14–16px padding, 13px/600). Below: editable 16-row textarea (`padding:18px 20px; border-radius:13px;` background `#fbf7f0`, line-height 1.65). Footer note: accent diamond + `"Claude leaned into {company}'s emphasis on craft — edit freely before you send."` (12.5px `#7a5a3f`).

### 4. Daily Digest
**Purpose:** AI-summarized, stack-filtered tech news.

**Layout:** single column, `max-width:820px`, `gap:13px`. Topped by mono caption `"Filtered to your stack · {date}"`.
- **Story card** (background `#fffefb`, border `1px solid #e8e0d2`, `border-radius:16px; padding:20px 22px`):
    - Top row (space-between, wrap): `source · time` (mono 12px `#9a917f`) and a **relevance pill** — `padding:4px 10px; border-radius:999px;` background `#faf2ea`, border `1px solid #f0e2d3`, color `#7a5a3f`, 12px, prefixed with a `7px` accent diamond.
    - Title: Space Grotesk 600 18px, line-height 1.3, margin `11px 0 7px`.
    - Summary: 14px, line-height 1.6, color `#5a5347`.
    - Tag chips (margin-top 13px, `gap:7px`): mono 11px, `padding:4px 9px; border-radius:7px;` background `#f1ece2`, border `1px solid #e6ddcd`, color `#6b6358`.

### 5. Events
**Purpose:** Location-pulled events with an AI "worth it?" verdict.

**Layout:** single column, `max-width:820px`, `gap:13px`. Topped by mono caption `"Near {location}"`.
- **Event card** (card style, `padding:20px 22px`, row `gap:18px; align-items:flex-start`):
    - Left date block: `width:96px; flex:none; padding:11px 12px; border-radius:12px;` background `#211c16`, text `#f1ece2`, centered mono 12px date (line-height 1.45).
    - Right block: title (Space Grotesk 17px/600) inline with a **verdict badge** — `padding:3px 9px; border-radius:999px;` mono 11px. *Worth it*: background `#eef3ec`, border `1px solid #d2e0cb`, color `#3d6b50`. *Optional*: background `#f1ece2`, border `1px solid #e2dacc`, color `#9a917f`.
    - `venue · dist` line: 13px `#6b6358`, margin-top 4px.
    - **"Claude's take" box** (margin-top 11px): background `#faf2ea`, border `1px solid #f0e2d3`, `border-radius:11px; padding:12px 14px`. Header: `8px` accent diamond + mono 10.5px uppercase `CLAUDE'S TAKE` (`#7a5a3f`). Body 13.5px line-height 1.55 `#5a5347`.
    - Tag chips (same as digest).

---

## Interactions & Behavior
- **Nav:** clicking a sidebar item sets the active screen; the profile mini-card routes to Profile. Active item gets the highlighted treatment + accent marker dot.
- **Job selection:** clicking a list card selects it (sets `selectedJobId`) and updates the sticky detail panel. The detail panel always shows a selected role (defaults to the first/top match).
- **Draft cover letter:** from the detail panel (or "Save" stub) → switches to the Cover Letters screen, sets that job as the cover target, enters **drafting** state, and after ~1600ms transitions to **done** with generated text. In production, replace the timeout with a Claude API call (stream tokens into the textarea if your platform supports it).
- **Regenerate:** re-runs the same draft flow for the current job.
- **Copy:** writes the textarea content to clipboard via `navigator.clipboard.writeText`, fires toast `"Copied to clipboard"`.
- **Save (letter / role / profile):** stubbed — fires a confirmation toast. Wire to persistence.
- **Skills editing:** typing a skill + Enter appends a chip and clears the input; clicking a chip's `×` removes it.
- **Toast:** a single transient toast, fixed bottom-center: background `#211c16`, color `#f1ece2`, `padding:12px 20px; border-radius:11px;` shadow `0 8px 28px rgba(0,0,0,.22)`, 13.5px/500, `z-index:50`. Auto-dismisses after ~1900ms.
- **Transitions:** nav/card hover & selection use `transition: background/border-color .12s`. Spinner: `360°` rotation, `.8s linear infinite`.
- **Responsive:** desktop-first. The Job Matches two-column layout uses `flex-wrap`, so the detail panel drops below the list on narrow viewports. For a true mobile build, collapse the sidebar to a bottom tab bar or hamburger drawer, and stack all multi-column layouts to single column. Keep tap targets ≥44px.

## State Management
Prototype state (lift into your store / hooks / view models as appropriate):
- `screen` — active view: `'jobs' | 'profile' | 'cover' | 'digest' | 'events'`.
- `selectedJobId` — currently inspected job.
- `cover` — `{ jobId, text, status }` where `status ∈ 'idle' | 'drafting' | 'done'`.
- `toast` — transient message string ('' = hidden).
- `profile` — `{ name, location, target, level, about, skills[], interests[] }`.
- Derived: filtered jobs (by match threshold), score band → color/label, initials from name.

**Data fetching in production:**
- Job feed: pull listings from a jobs source, send each + the profile to Claude for a score + `fit[]` + `gaps[]` breakdown.
- Cover letter: Claude completion from `{ job, profile }`.
- Digest: fetch stories from a news source, Claude summarizes + tags + writes a relevance line, filtered to the profile's skills.
- Events: fetch by location, Claude writes the "take" + worth/optional verdict.
- Profile persistence: per-account store, synced across devices (the "synced" pill and toasts reflect this promise — keep it honest).

---

## Design Tokens

### Colors
| Role | Hex |
|---|---|
| App background | `#f1ece2` |
| Main background | `#f4f0e8` |
| Sidebar background | `#ece5d8` |
| Card / surface | `#fffefb` |
| Subtle field / chip fill | `#fbf7f0` / `#f1ece2` |
| Ink (primary text) | `#211c16` |
| Muted text | `#6b6358` |
| Faint text / mono labels | `#9a917f` / `#a89e8a` |
| Border (card) | `#e8e0d2` |
| Border (subtle) | `#e6ddcd` / `#e2dacc` / `#ddd3c2` |
| **Accent (primary)** | **`#d4663a`** (alt options: `#2f7d63`, `#3a6ea5`, `#7a5cc0`) |
| Accent text-on-light | `#b05a30` / `#7a5a3f` |
| Success / strong / "worth it" | `#2f8f63` (text `#3d6b50`, bg `#eef3ec`, border `#d2e0cb`) |
| Warning / gaps | `#c08a2d` / text `#9a7a3f` |
| AI-take tint bg / border | `#faf2ea` / `#f0e2d3` |

The accent is themeable. Score-band fill colors: ≥85 → `#2f8f63`, ≥75 → accent, <75 → `#c08a2d`.

### Typography
- **Display / headings:** Space Grotesk (500/600/700).
- **Body / UI:** IBM Plex Sans (400/500/600).
- **Labels / mono / data:** IBM Plex Mono (400/500).
- Scale used: 25px header title, 21–22px panel/section titles, 17–19px card titles, 14–15px body, 13–13.5px secondary, 11–12.5px mono labels/captions. Headers carry tight letter-spacing (`-.01em` to `-.02em`); mono labels use positive tracking (`.06em`–`.1em`), usually uppercase.

### Spacing
Common steps: 4 / 6–7 / 9–11 / 14 / 16 / 18 / 20–24 / 26–34px. Card radii: 10–11px (buttons/inputs), 12–14px (chips-as-blocks/list cards/date block), 16–18px (panels/cards), 999px (pills/chips).

### Shadows
- Card lift: `0 6px 24px rgba(40,30,15,.05)`; selected list card `0 3px 12px rgba(40,30,15,.06)`.
- Primary button: `0 2px 8px rgba(190,80,40,.22)`; logo mark `0 2px 6px rgba(0,0,0,.12)`.
- Toast: `0 8px 28px rgba(0,0,0,.22)`.

### Recurring motif: "Claude's take"
A small **rotated-square (45°) diamond** in the accent color + a mono uppercase label, above a warm-tinted box (`#faf2ea` / border `#f0e2d3`). This appears on Job Matches (why you fit), Daily Digest (relevance pill), and Events (Claude's take). It is the visual signature of the AI layer — reuse it consistently anywhere AI reasoning appears.

---

## Themeable options (exposed in the prototype)
- **Accent color** — `#d4663a` default, with `#2f7d63` / `#3a6ea5` / `#7a5cc0` alternates. Used for the logo mark, active nav, primary buttons, progress fills (mid band), and all "Claude's take" diamonds. Implement as a single theme token.
- **Show AI reasoning** — boolean; toggles the "Why Claude matched you" block in the job detail panel. (The product intent is for this to stay ON.)
- **Minimum match %** — slider (0–95, step 5); filters the job feed and updates the sidebar badge count.

---

## Assets
- **No raster/vector image assets.** Company "logos" in the prototype are single-letter glyphs in dark tiles (`S`, `▲`, `F`, `L`, `N`) — placeholders. In production, swap for real company logos (favicon/Clearbit-style) with the dark tile as a fallback.
- **Icons:** none beyond the `↗` logo glyph and CSS-drawn dots/diamonds. If you add icons, choose a thin, geometric set that matches the developer-native tone.
- **Fonts:** Space Grotesk, IBM Plex Sans, IBM Plex Mono — all Google Fonts. Self-host or load via your normal font pipeline; weights listed above.

## Files
- `Launchpad.dc.html` — the full interactive design reference (all five screens, all states, sample data, and logic). Open it in a browser to see live behavior, hover/active states, the drafting animation, and the toast. Treat its inline styles as the source of truth for exact values; treat its template/logic runtime as throwaway.
