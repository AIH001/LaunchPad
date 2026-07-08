# Production Readiness Review & Ship Plan

*Reviewed 2026-07-07, on `claude/production-readiness-eval-vkhsmg` (HEAD `ee33621`). Full-codebase pass: frontend, Edge Functions, migrations, workflows, repo hygiene, plus a local run of build/lint/tests.*

## TL;DR

Launchpad is **feature-complete and architecturally sound, but not yet production-hardened**. All seven features are real (no stubs in user-facing code), the security fundamentals — RLS, secret handling, service-role isolation — are genuinely strong, and the ingest pipeline is carefully engineered. What stands between here and shipping is a short list: **cost/abuse controls on the paid `claude` function, locked-down CORS, and a React error boundary**. Those are roughly a day of work. Deploying is another half day. Everything else is first-week hardening, not a launch blocker.

**Verdict: ship after Phase 0 below. Estimated ~1.5 days to a defensible public launch.**

> **Status update (2026-07-07):** Phase 0 is DONE — all three P0 blockers plus the
> `withTimeout` timer leak (P1-7) are fixed on this branch, and the Deno suite is
> now 46/46. The P0 sections below are kept as written for the record; each now
> carries a ✅ with what landed. Next step is Phase 1 (deploy), which now also
> requires setting the new `ALLOWED_ORIGIN` function secret and running the new
> `claude_usage` migration.

## Verified build health (run locally for this review)

| Check | Result |
|---|---|
| `npm ci` | ✅ clean install, lockfile resolves |
| `npm run build` (`tsc -b && vite build`) | ✅ passes — 517 kB JS bundle (145 kB gzip), Vite warns it's over the 500 kB chunk limit |
| `npm run lint` (oxlint) | ✅ passes (but see "quality gates" — only 2 rules are enabled) |
| `npm test` (vitest) | ✅ 17/17 pass (2 files, pure-logic only) |
| `npm run test:functions` (deno test) | ✅ **46/46 pass** — was 45/46 at review time; the `withTimeout` timer leak (P1-7) is now fixed |

## Scorecard

| Area | Verdict | Notes |
|---|---|---|
| Feature completeness | 🟢 Ready | All 7 features implemented end-to-end; no dead routes or stubs in user-facing code |
| Data model & RLS | 🟢 Ready | Strongest part of the codebase — no gaps found |
| Secret handling | 🟢 Ready | Zero secrets in client code or git history; service-role key confined to one file |
| AI cost controls | 🟢 Fixed | Was a blocker (P0-1); per-user hourly rate limit + batch caps now enforced server-side |
| Frontend robustness | 🟢 Fixed | Was a blocker (P0-3); ErrorBoundary + shape guards on all AI-view data now in place |
| CORS | 🟢 Fixed | Was a blocker (P0-2); origin now pinned via the `ALLOWED_ORIGIN` secret (set it at deploy!) |
| Quality gates (CI/tests/strict TS) | 🟡 Gap | No CI, ~2 test files, TS `strict` off, 2-rule linter — fine for launch, risky for iteration |
| Deploy readiness & docs | 🟡 Gap | No deploy config, stock-template README, no `.env.example` |
| Mobile / a11y | 🟡 Accepted | Desktop-only per v1 scope; modal a11y gaps noted below |

## What's genuinely strong

Worth naming, because these are the things that usually *aren't* done right in a two-week project:

- **RLS is airtight.** All 9 tables have RLS enabled with correct policies: per-user tables scope every operation to `auth.uid()`; the global `jobs`/`job_sources` tables have *no* write policies at all (browser is structurally read-only — only the service role, which bypasses RLS, can write); `ingestion_runs` is RLS-on with zero policies, i.e. deny-all to browsers. Grants are explicit because `config.toml` disables schema auto-expose. No missing policy, no missing grant.
- **Service-role blast radius is minimal.** `SUPABASE_SERVICE_ROLE_KEY` is read in exactly one file (`supabase/functions/ingest-jobs/index.ts`) and never leaves the server.
- **No secrets anywhere they shouldn't be.** Client code uses only the public-safe `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`; a scan of tracked files found nothing; `.env` is gitignored and untracked.
- **The `claude` function validates the caller's JWT before spending money** (`supabase.auth.getUser()` → 401), and every Anthropic call sets `max_tokens`, uses structured outputs (JSON schema) for machine-parsed tasks, and picks Haiku for cheap structured work vs. Sonnet for quality work.
- **The ingest pipeline is production-grade engineering:** per-source 12 s timeouts, bounded concurrency (10), a round-robin source cap to bound memory/time, streaming upserts to stay under the Edge memory limit, a stale-close guard that refuses to retire jobs from unvisited sources on truncated runs, and every run logged to `ingestion_runs`. The GitHub Actions cron (every 4 h + manual dispatch) exists and fails loudly on non-2xx.
- **Frontend hygiene:** zero `TODO`/`console.log`/`any` in `src/`; per-feature loading, error, empty, and skeleton states everywhere; AI results cached in `job_scores`/`ai_cache` so refreshes don't re-bill.

## Launch blockers (P0)

### P0-1 — No rate limiting or batch caps on the paid `claude` function
`supabase/functions/claude/index.ts` verifies the JWT, but any logged-in user can then call it in a loop, and nothing server-side caps the size of the `jobs`/`comments` arrays passed to `score_jobs`/`score_events`/`extract_jobs_from_text` — the frontend sends ~15 jobs per scoring batch, but the function doesn't enforce that. A single hostile (or buggy) client can run up the Anthropic bill. Caching mitigates repeat calls from honest clients only.

**Fix (~half day):** (a) enforce server-side array caps per task (e.g. `jobs.length <= 20`, reject larger with 400); (b) add a simple per-user throttle — a `claude_usage (user_id, window_start, count)` table checked/incremented at the top of the handler is enough; Supabase has no built-in per-function rate limiting, so this small DB counter is the pragmatic v1 (honest tradeoff: it adds one DB round-trip per call and a determined attacker gets up to the cap per window — that's fine, the goal is bounding the bill, not perfect fairness).

✅ **Fixed.** Migration `20260707120000_create_claude_usage.sql` adds the counter table (RLS on, zero policies — users can't reset their own quota) plus a `consume_claude_call()` security-definer RPC; the function now returns 429 past 100 calls/hour and 400 on oversized batches (jobs > 20, stories > 40, events > 20, comments > 60 — all above what the frontend sends). Deliberate tradeoff: if the rate-limit RPC itself errors, the function fails *open* so a DB hiccup doesn't take every AI feature down.

### P0-2 — CORS is `Access-Control-Allow-Origin: '*'`
`supabase/functions/_shared/cors.ts` hardcodes the wildcard for every function — the comment in the file already admits this is dev-only. Combined with JWT auth the practical risk is bounded (a stolen JWT is the real problem), but wildcard CORS means any website a logged-in user visits can drive your functions with their session.

**Fix (~1 hour):** read an `ALLOWED_ORIGIN` env var (the Vercel URL) and reflect only that; keep `localhost:5173` for dev via a comma-separated list.

✅ **Fixed.** `_shared/cors.ts` now reads the `ALLOWED_ORIGIN` secret (with a `Vary: Origin` header when locked). Unset falls back to `'*'` so local dev keeps working — which means **setting this secret is a required Phase 1 deploy step**, called out below.

### P0-3 — No React error boundary; AI-shaped data is trusted at render time
There is no `ErrorBoundary` anywhere (`src/main.tsx` wraps only StrictMode/Router/AuthProvider). Meanwhile AI responses are cast to concrete types and dereferenced without guards — e.g. `src/features/coach/GamePlan.tsx:95` reads `plan.priority_gaps.length` where `plan` is whatever the model returned, cast via `as GamePlanData` in `useGamePlanState.ts`. Structured outputs make malformed shapes *unlikely*, not impossible — and a cached malformed payload in `ai_cache` would crash on every reload. One render throw = blank white screen, which directly violates the "never let a failed call show a blank screen" convention in CLAUDE.md.

**Fix (~2–3 hours):** add a top-level `ErrorBoundary` (and optionally one per route) with a "something broke — reload" card; add cheap runtime guards (`Array.isArray(plan?.priority_gaps)`) at the AI-data render sites in GamePlan, digest tags, and event tags.

✅ **Fixed.** `src/components/ErrorBoundary.tsx` (the codebase's one class component — React requires classes for error boundaries) now wraps the app in `main.tsx`, and each AI-view hook sanitizes its data at the state boundary instead of in JSX: `useGamePlanState` validates the plan shape from both Claude and `ai_cache`, `useDigest` and `useEvents` validate cached feeds and coerce `tags` to arrays. Malformed cache entries are discarded (triggering a clean regenerate) rather than rendered.

## Should-fix soon (P1) — first week after launch

1. **No CI.** The only workflow is the ingest cron. Add a `ci.yml` running `npm ci && npm run lint && npm run build && npm test` (+ `deno test`) on PR/push. Without it, nothing stops a broken build from merging. (~1 hour, highest leverage item on this list.)
2. **README is the stock Vite template** and `package.json` is still `scaffold@0.0.0`. For a portfolio project the README *is* the landing page — describe the product, architecture (the DB-first jobs pipeline is genuinely interview-worthy), setup, and env vars.
3. **No `.env.example`** despite well-documented env requirements in CLAUDE.md. Add one for the two `VITE_` vars plus a commented list of function secrets.
4. **Error responses leak internals:** functions return `json({ error: String(err) }, 500)` — raw error text (URLs, internal messages) goes to the client. Log the real error server-side, return a generic message.
5. **`JSON.parse` of Claude output isn't wrapped** at call sites in the `claude` function — a malformed response bubbles to the generic 500. Wrap and return a clean 502 instead.
6. **`INGEST_SECRET` compare is `!==`** (not timing-safe) in `ingest-jobs/index.ts`. Low practical risk over network jitter; still, use a constant-time compare.
7. ~~**`withTimeout` leaks its timer** (`supabase/functions/jobs/lib.ts:59`) — the `setTimeout` is never cleared when the raced promise wins, which is why `deno test` fails its leak sanitizer (45/46 in this review). Store the timer id and `clearTimeout` in a `.finally()`. Two-line fix and the test suite goes green.~~ ✅ Fixed alongside Phase 0 — suite is 46/46.
8. **TS `strict` is off** (`tsconfig.app.json`) and **oxlint runs only 2 rules**. Code discipline currently compensates, but `strictNullChecks` is exactly the tool that would have flagged P0-3's unguarded dereferences. Migrate incrementally post-launch.
9. **Bundle is 517 kB minified** — over Vite's warning limit. Lazy-load routes (`React.lazy` per screen) when convenient; not urgent at this scale.

## Accepted tradeoffs (documented, not blockers)

These are known scope decisions — keep being upfront about them (they make good interview material):

- **Desktop-only layout.** The shell is a fixed 250 px sidebar with zero responsive breakpoints in app code. v1 scope per CLAUDE.md says responsive web — this currently falls short of that stated goal, so either add a minimal mobile pass or amend the scope statement. Related a11y gap: the cover-letter modal has no `role="dialog"`, focus trap, or Escape-to-close.
- **Feed freshness lags up to one cron interval** (4 h) — by design of the DB-first pipeline.
- **HN "Who is hiring?" ingestion is deferred** (needs an auth-gated Claude call the service-role worker can't make); its seeded source row will permanently report `skipped`.
- **Meetup is a stub** (needs paid Meetup Pro); **Luma rides an unofficial endpoint** that can break silently — failure just drops Luma from the feed, which is the right degradation.
- **Some seeded Ashby/SmartRecruiters/Workable slugs are unverified** and will log `error` in `job_sources.last_status` until curl-checked.
- **Prompt injection exposure is real but bounded:** resumes, job descriptions, and HN comments flow into prompts with no delimiting/hardening. Because every machine-consumed output is schema-constrained and never executed, worst case is a skewed score or poisoned cover-letter draft — worth a hardening pass later, not a launch risk.

## Ship plan

### Phase 0 — Launch blockers (~1 day) — ✅ DONE
1. ~~Server-side batch caps + per-user throttle on `claude` (P0-1).~~
2. ~~Pin CORS to the deployed origin via env var (P0-2).~~
3. ~~Top-level `ErrorBoundary` + runtime guards on AI-shaped render data (P0-3).~~
4. ~~While in there: the two-line `withTimeout` fix (P1-7) so the Deno suite is green before it gates CI.~~

### Phase 1 — Deploy (~half day)
1. **Supabase (prod project):** `supabase db push` (16 migrations, including the new `claude_usage` rate-limit table), apply `seed.sql`, `supabase functions deploy` (all 5), `supabase secrets set` — `ANTHROPIC_API_KEY`, `ADZUNA_APP_ID/KEY`, `TICKETMASTER_API_KEY`, `INGEST_SECRET`, **`ALLOWED_ORIGIN`** (the Vercel URL — without it CORS stays wide-open `'*'`) (+ optional `THEMUSE_API_KEY`/`JOOBLE_API_KEY`). Enable the Google OAuth provider and set the prod redirect URL in the Supabase dashboard.
2. **Vercel:** import the repo — build `npm run build`, output `dist/`, env vars `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. Add a `vercel.json` with an SPA rewrite (`/(.*)` → `/index.html`) so client-side routes survive refresh.
3. **GitHub:** set repo secrets `INGEST_FUNCTION_URL` + `INGEST_SECRET`; run the ingest workflow once via `workflow_dispatch`; confirm `ingestion_runs` shows a healthy run and `job_sources.last_status` looks sane.
4. **Smoke test the real flow:** sign up (email + Google) → build profile w/ resume upload → jobs feed populates → per-job scoring returns → draft + save a cover letter → digest "For you" tab → events verdicts → sign out/in and confirm `ai_cache` hydration.

### Phase 2 — First week (hardening)
CI workflow gating lint/build/test on PR · real README + `.env.example` + rename `package.json` · sanitize error responses · guard `JSON.parse` on Claude output · timing-safe ingest secret compare.

### Phase 3 — When it earns its keep
Incremental TS `strict` migration · modal a11y (dialog role, focus trap, Esc) · minimal mobile shell (collapse sidebar to a drawer) · route-level code splitting · component/hook tests for the data-fetching layer · HN who-is-hiring ingestion · prompt-injection hardening pass.
