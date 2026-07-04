// claude: the single Edge Function that all Claude-powered features route through
// (see CLAUDE.md — "centralize Claude calls in the claude Edge Function").
// Dispatches by a `task` field: score_jobs, parse_resume, draft_cover_letter,
// digest_news, score_events.
//
// The ANTHROPIC_API_KEY lives only as a Supabase secret — it is read here on the
// server and never reaches the browser.
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js'
import { encodeBase64 } from 'jsr:@std/encoding/base64'
import { corsHeaders, json } from '../_shared/cors.ts'

// JSON Schema we force Claude's answer into. Structured outputs guarantee the
// shape, so the frontend never has to parse free-form text. (Numeric ranges
// like 0–100 aren't expressible in the schema — we instruct that in the prompt.)
const SCORES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          job_id: { type: 'string' },
          score: { type: 'integer' },
          why_fit: { type: 'string' },
          gaps: { type: 'string' },
          // true when the role needs materially more experience than the
          // candidate's stage — surfaced as a "Stretch" flag, not a filter.
          stretch: { type: 'boolean' },
        },
        required: ['job_id', 'score', 'why_fit', 'gaps', 'stretch'],
      },
    },
  },
  required: ['scores'],
}

// Schema for extracting structured job postings from freeform text (the HN
// "Who is hiring?" thread). Each input comment may or may not be a real posting;
// Claude returns one entry per genuine job, echoing the comment_id it came from.
const EXTRACT_JOBS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    jobs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          comment_id: { type: 'string' },
          title: { type: 'string' },
          company: { type: 'string' },
          location: { type: 'string' },
          url: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['comment_id', 'title', 'company', 'location', 'url', 'summary'],
      },
    },
  },
  required: ['jobs'],
}

// Schema for the daily digest: Claude returns a FILTERED, ranked subset of the
// stories it was given (by id), each with a short summary, a one-line relevance
// note, and a few tags. Returning ids (not the stories themselves) keeps the
// payload small — the frontend joins back to the original story for title/url.
const DIGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          summary: { type: 'string' },
          relevance: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'summary', 'relevance', 'tags'],
      },
    },
  },
  required: ['items'],
}

// Schema for extracting a resume into structured data.
const RESUME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    skills: { type: 'array', items: { type: 'string' } },
    education: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          school: { type: 'string' },
          credential: { type: 'string' },
          year: { type: 'string' },
        },
        required: ['school', 'credential', 'year'],
      },
    },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          company: { type: 'string' },
          dates: { type: 'string' },
          highlights: { type: 'string' },
        },
        required: ['title', 'company', 'dates', 'highlights'],
      },
    },
    qualifications: { type: 'array', items: { type: 'string' } },
    years_experience: { type: 'integer' },
  },
  required: [
    'summary',
    'skills',
    'education',
    'experience',
    'qualifications',
    'years_experience',
  ],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1) AUTH GATE — Claude calls cost money, so only a real logged-in user may
    // trigger them. We build a Supabase client scoped to the caller's token and
    // ask who they are; no valid user => 401, before we ever call Anthropic.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization header.' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return json({ error: 'Not authenticated.' }, 401)

    // 2) DISPATCH by task.
    const body = await req.json().catch(() => ({}))
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! })

    switch (body.task) {
      case 'score_jobs':
        return await scoreJobs(anthropic, body)
      case 'parse_resume':
        return await parseResume(anthropic, supabase, body)
      case 'draft_cover_letter':
        return await draftCoverLetter(anthropic, body)
      case 'summarize_digest':
        return await summarizeDigest(anthropic, body)
      case 'score_events':
        return await scoreEvents(anthropic, body)
      case 'extract_jobs_from_text':
        return await extractJobsFromText(anthropic, body)
      case 'game_plan':
        return await gamePlan(anthropic, body)
      default:
        return json({ error: `Unknown task: ${body.task}` }, 400)
    }
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

// Phrase describing each career stage, injected into prompts so scoring/coaching
// reason about the right early-career context. Kept in sync with the frontend's
// careerStageDescriptor (career-stage.ts) — Deno can't import from src/.
const CAREER_STAGE_DESCRIPTOR: Record<string, string> = {
  student: 'a student seeking an internship or their first role',
  internship: 'seeking an internship',
  new_grad: 'a recent graduate seeking their first full-time role',
  junior: 'a junior developer with limited professional experience (roughly 0-2 years)',
  career_switcher:
    'switching into tech from another field, with transferable but limited direct experience',
}

function describeCandidate(stage?: string | null, years?: number | null): string {
  const desc = stage ? CAREER_STAGE_DESCRIPTOR[stage] : undefined
  const stagePart = desc ? `Career stage: ${desc}.` : 'Career stage: early-career.'
  const yearsPart =
    typeof years === 'number' ? ` Estimated professional experience: ${years} year(s).` : ''
  return stagePart + yearsPart
}

// Score a batch of jobs against the user's profile in a single Claude call.
async function scoreJobs(anthropic: Anthropic, body: Record<string, unknown>) {
  const profile = body.profile as {
    summary?: string | null
    skills?: string[]
    interests?: string[]
    location?: string | null
    career_stage?: string | null
    years_experience?: number | null
  } | undefined
  const jobs = body.jobs as Array<{
    id: string
    title: string
    company: string
    location: string
    description: string
  }> | undefined

  if (!profile || !Array.isArray(jobs) || jobs.length === 0) {
    return json({ error: 'Provide a profile and a non-empty jobs array.' }, 400)
  }

  // Trim descriptions so a long listing can't blow up our token budget.
  const compactJobs = jobs.map((j) => ({
    id: j.id,
    title: j.title,
    company: j.company,
    location: j.location,
    description: (j.description ?? '').slice(0, 1500),
  }))

  const system =
    'You are a career coach for early-career developers (students, interns, new ' +
    'grads, career switchers, and juniors). Score how well each job fits THIS ' +
    'candidate on a 0-100 scale (100 = excellent fit), judged relative to their ' +
    'career stage. Rules:\n' +
    '- Reward transferable skills, coursework, personal/portfolio projects, ' +
    'internships, and bootcamp work. Do NOT penalize a lack of professional ' +
    'experience for entry-level or internship roles — that is expected.\n' +
    '- Judge seniority fit relative to the stage. If a role clearly requires ' +
    'materially MORE experience than the candidate has (e.g. senior/staff/lead, ' +
    'or "5+ years" for a new grad), set "stretch": true and lower the score to ' +
    'reflect the reach. For genuinely entry-level/intern/junior roles, set ' +
    '"stretch": false.\n' +
    '- "why_fit": one honest sentence on why this role fits them (or why the ' +
    'stretch could still be worth an application).\n' +
    '- "gaps": one sentence framed as a concrete, LEARNABLE next step — what to ' +
    'build or learn to become a strong applicant — not a bare list of missing ' +
    'requirements.\n' +
    'Be honest and specific, not flattering.'

  const userContent =
    `CANDIDATE PROFILE:\n` +
    `${describeCandidate(profile.career_stage, profile.years_experience)}\n` +
    `Skills: ${(profile.skills ?? []).join(', ') || '(none listed)'}\n` +
    `Interests: ${(profile.interests ?? []).join(', ') || '(none listed)'}\n` +
    `Location: ${profile.location ?? '(not set)'}\n` +
    `Resume summary: ${(profile.summary ?? '(not provided)').slice(0, 4000)}\n\n` +
    `JOBS TO SCORE (return one entry per job_id):\n` +
    JSON.stringify(compactJobs, null, 2)

  // Thinking is OFF here on purpose: scoring short blurbs doesn't need a
  // deliberation pass, and adaptive thinking made this call ~45s. Claude still
  // reasons about fit in its answer — it just responds directly. To trade speed
  // back for a quality bump, add `thinking: { type: 'adaptive' }`.
  // Haiku, not Sonnet: this is short structured-output scoring, not deep
  // reasoning — Haiku is faster/cheaper with no meaningful quality loss here.
  // Structured outputs guarantee the JSON shape. max_tokens explicit per
  // CLAUDE.md — ample for ~10 short entries without thinking.
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4000,
    output_config: { format: { type: 'json_schema', schema: SCORES_SCHEMA } },
    system,
    messages: [{ role: 'user', content: userContent }],
  })

  // With structured outputs the answer is a text block of schema-valid JSON.
  const textBlock = message.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return json({ error: 'Claude returned no text content.', stop_reason: message.stop_reason }, 502)
  }

  const parsed = JSON.parse(textBlock.text) as {
    scores: Array<{
      job_id: string
      score: number
      why_fit: string
      gaps: string
      stretch: boolean
    }>
  }
  return json({ scores: parsed.scores })
}

// Read a resume file from Storage and extract it into structured data. The file
// is downloaded with the caller's own token, so Storage RLS still applies — a
// user can only parse a file under their own folder.
async function parseResume(
  anthropic: Anthropic,
  supabase: SupabaseClient,
  body: Record<string, unknown>
) {
  const path = body.path as string | undefined
  if (!path) return json({ error: 'Provide a storage path.' }, 400)

  const { data: file, error } = await supabase.storage.from('resumes').download(path)
  if (error || !file) {
    return json({ error: `Could not read file: ${error?.message ?? 'not found'}` }, 400)
  }

  const isPdf = path.toLowerCase().endsWith('.pdf')
  const instruction =
    'Extract this resume into the structured schema. Use the candidate\'s own ' +
    'wording where possible; do not invent facts. summary is 2-3 sentences. ' +
    'years_experience is your best integer estimate of total professional years.'

  // PDFs go to Claude as a document block (it reads them natively); text files
  // go in as plain text.
  const content = isPdf
    ? [
        {
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data: encodeBase64(new Uint8Array(await file.arrayBuffer())),
          },
        },
        { type: 'text' as const, text: instruction },
      ]
    : `${instruction}\n\nRESUME:\n${(await file.text()).slice(0, 20000)}`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    output_config: { format: { type: 'json_schema', schema: RESUME_SCHEMA } },
    system: 'You extract accurate structured data from resumes.',
    messages: [{ role: 'user', content }],
  })

  const textBlock = message.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return json(
      { error: 'Claude returned no text content.', stop_reason: message.stop_reason },
      502
    )
  }

  return json({ parsed: JSON.parse(textBlock.text) })
}

// Draft a tailored cover letter from a job + the candidate's parsed profile.
// Free-form prose, so no structured output — we return the text directly.
async function draftCoverLetter(anthropic: Anthropic, body: Record<string, unknown>) {
  const job = body.job as
    | { title?: string; company?: string; description?: string }
    | undefined
  const profile = body.profile as
    | { summary?: string | null; skills?: string[] }
    | undefined

  if (!job?.title || !job?.company) {
    return json({ error: 'Provide a job with title and company.' }, 400)
  }

  const system =
    'You write tailored cover letters for early-career developers. 250-350 ' +
    'words, warm but professional, specific to this role and candidate. Open ' +
    'with genuine interest, connect their actual background to the role, and ' +
    'close with a clear call to action. Avoid clichés like "I am writing to ' +
    'express" and generic filler. Output ONLY the letter body — no subject ' +
    'line, no placeholders like [Your Name].'

  const userContent =
    `ROLE: ${job.title} at ${job.company}\n` +
    `JOB DESCRIPTION:\n${(job.description ?? '').slice(0, 2000)}\n\n` +
    `CANDIDATE:\n` +
    `Summary: ${profile?.summary ?? '(not provided)'}\n` +
    `Skills: ${(profile?.skills ?? []).join(', ') || '(none listed)'}\n\n` +
    `Write the cover letter body now.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system,
    messages: [{ role: 'user', content: userContent }],
  })

  const textBlock = message.content.find((b) => b.type === 'text')
  return json({ body: textBlock?.type === 'text' ? textBlock.text : '' })
}

// Build the daily digest: filter a batch of news stories down to the ones that
// matter for this candidate's stack, rank them, and tag + summarize each.
//
// HONEST SCOPE NOTE: we send Claude the headlines + metadata, NOT the article
// bodies. The genuine AI work here is the relevance filtering/ranking against the
// profile's skills and the tagging — that can't be done by the news API alone.
// The "summary" is Claude inferring from the headline + its own knowledge, so the
// prompt forbids inventing specifics it can't know from the title.
async function summarizeDigest(anthropic: Anthropic, body: Record<string, unknown>) {
  const profile = body.profile as { skills?: string[] } | undefined
  const stories = body.stories as Array<{
    id: string
    title: string
    source: string
  }> | undefined

  if (!Array.isArray(stories) || stories.length === 0) {
    return json({ error: 'Provide a non-empty stories array.' }, 400)
  }

  const skills = profile?.skills ?? []
  const hasSkills = skills.length > 0

  // Only the fields Claude needs to judge relevance — keeps the prompt lean.
  const compactStories = stories.map((s) => ({
    id: s.id,
    title: s.title,
    source: s.source,
  }))

  const system =
    'You curate a daily tech-news digest for an early-career developer. From the ' +
    'stories provided, select the ones most worth their time and return them ' +
    'ranked best-first (aim for 6-8, fewer if little is relevant). For each: a ' +
    '1-2 sentence summary, a one-line "why this matters to you" relevance note, ' +
    'and 2-4 short topic tags (e.g. "React", "AI", "career"). ' +
    'You are given only headlines and sources, NOT article text — base summaries ' +
    'on the headline and general knowledge, and do NOT invent specific facts, ' +
    'numbers, or quotes you cannot know from the title. Return story ids exactly ' +
    'as given. Omit stories that are off-topic, low-value, or pure noise.'

  const userContent =
    (hasSkills
      ? `CANDIDATE STACK / INTERESTS: ${skills.join(', ')}\n` +
        `Prioritize stories relevant to this stack; the relevance line should ` +
        `connect the story to their skills.\n\n`
      : `The candidate hasn't listed skills yet — select the strongest general ` +
        `tech stories and write a relevance line on why each matters broadly.\n\n`) +
    `STORIES (return a ranked, filtered subset by id):\n` +
    JSON.stringify(compactStories, null, 2)

  // Structured outputs guarantee the JSON shape; thinking left off (this is a
  // selection/tagging pass, not deep reasoning). Haiku over Sonnet for the same
  // reason. max_tokens explicit per CLAUDE.md.
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 3000,
    output_config: { format: { type: 'json_schema', schema: DIGEST_SCHEMA } },
    system,
    messages: [{ role: 'user', content: userContent }],
  })

  const textBlock = message.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return json(
      { error: 'Claude returned no text content.', stop_reason: message.stop_reason },
      502
    )
  }

  const parsed = JSON.parse(textBlock.text) as {
    items: Array<{ id: string; summary: string; relevance: string; tags: string[] }>
  }
  return json({ items: parsed.items })
}

const EVENTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          event_id: { type: 'string' },
          verdict: { type: 'string', enum: ['worth_it', 'optional'] },
          take: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['event_id', 'verdict', 'take', 'tags'],
      },
    },
  },
  required: ['verdicts'],
}

async function scoreEvents(anthropic: Anthropic, body: Record<string, unknown>) {
  const events = body.events as Array<{
    id: string
    title: string
    description: string
    venue: string
    category: string
    isVirtual: boolean
  }> | undefined
  const profile = body.profile as {
    skills?: string[]
    interests?: string[]
    location?: string | null
  } | undefined

  if (!Array.isArray(events) || events.length === 0) {
    return json({ error: 'Provide a non-empty events array.' }, 400)
  }

  const system =
    'You are a career advisor for early-career developers. Given a list of tech ' +
    'events and a developer profile, decide which are worth attending. ' +
    '"worth_it" = clear networking or learning value aligned to their skills/interests. ' +
    '"optional" = peripheral or duplicative. ' +
    'Give a concise 1-2 sentence "take" explaining the verdict. ' +
    'Include 2-3 short topic tags (e.g. "React", "Networking", "ML").'

  const userContent =
    `DEVELOPER PROFILE:\n` +
    `Skills: ${(profile?.skills ?? []).join(', ') || '(none)'}\n` +
    `Interests: ${(profile?.interests ?? []).join(', ') || '(none)'}\n` +
    `Location: ${profile?.location ?? '(not set)'}\n\n` +
    `EVENTS TO EVALUATE:\n` +
    JSON.stringify(
      events.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description.slice(0, 400),
        venue: e.venue,
        category: e.category,
        is_virtual: e.isVirtual,
      })),
      null,
      2
    )

  // Haiku, not Sonnet: short verdict + tags per event, not deep reasoning.
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 3000,
    output_config: { format: { type: 'json_schema', schema: EVENTS_SCHEMA } },
    system,
    messages: [{ role: 'user', content: userContent }],
  })

  const textBlock = message.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return json(
      { error: 'Claude returned no text content.', stop_reason: message.stop_reason },
      502
    )
  }

  const parsed = JSON.parse(textBlock.text) as {
    verdicts: Array<{
      event_id: string
      verdict: 'worth_it' | 'optional'
      take: string
      tags: string[]
    }>
  }
  return json({ verdicts: parsed.verdicts })
}

// Extract structured job postings from freeform text. Built for the HN "Who is
// hiring?" thread: each input comment is loose prose in a "Location | Company |
// Role | ..." style; Claude turns the genuine postings into structured jobs and
// drops meta/non-job comments. This is real extraction work the source APIs
// can't do — the honest "Claude does the heavy lifting" part of the jobs feed.
async function extractJobsFromText(anthropic: Anthropic, body: Record<string, unknown>) {
  const comments = body.comments as Array<{ id: number | string; text: string }> | undefined
  if (!Array.isArray(comments) || comments.length === 0) {
    return json({ error: 'Provide a non-empty comments array.' }, 400)
  }

  const system =
    'You extract software/tech job postings from freeform text. Each input is a ' +
    'comment from the Hacker News "Who is hiring?" thread, usually formatted like ' +
    '"Location | Company | Role | Remote/Onsite | details". For each comment that ' +
    'is a GENUINE job posting, return one entry echoing its comment_id exactly. ' +
    'Extract the role title, company, and location as written. Set url to an ' +
    'application/company link if one appears in the text, else "". Write a 1-2 ' +
    'sentence summary from the text — do NOT invent salary, tech stack, or ' +
    'details not present. SKIP comments that are meta-discussion, "who wants to be ' +
    'hired" self-posts, agency spam, or not real job postings. Use "" for any ' +
    'field you cannot determine.'

  const userContent =
    'COMMENTS (extract genuine job postings, one entry per comment_id):\n' +
    JSON.stringify(
      comments.map((c) => ({ comment_id: String(c.id), text: c.text })),
      null,
      2
    )

  // Haiku: structured extraction over short text, not deep reasoning.
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4000,
    output_config: { format: { type: 'json_schema', schema: EXTRACT_JOBS_SCHEMA } },
    system,
    messages: [{ role: 'user', content: userContent }],
  })

  const textBlock = message.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return json(
      { error: 'Claude returned no text content.', stop_reason: message.stop_reason },
      502
    )
  }

  const parsed = JSON.parse(textBlock.text) as {
    jobs: Array<{
      comment_id: string
      title: string
      company: string
      location: string
      url: string
      summary: string
    }>
  }
  return json({ jobs: parsed.jobs })
}

// ---------------------------------------------------------------------------
// Game Plan — the coaching layer.
// ---------------------------------------------------------------------------
// Genuine Claude reasoning, not an API wrapper: given the candidate's stage,
// target role, and resume, Claude synthesizes a personalized route to their first
// role — AND it reasons over the RECURRING gaps Claude already flagged across the
// user's live job matches, so the plan is grounded in the actual market they're
// seeing, not generic advice. Sonnet (not Haiku) on purpose: this is the one
// deliberative, high-value call where depth beats latency.
const GAME_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    // 2-3 sentences: an honest read on where the candidate stands today.
    standing: { type: 'string' },
    // The highest-leverage skills to close, ranked. `how` is a concrete action.
    priority_gaps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          skill: { type: 'string' },
          why: { type: 'string' },
          how: { type: 'string' },
        },
        required: ['skill', 'why', 'how'],
      },
    },
    // 3-5 concrete, ordered next actions the candidate can start this week.
    next_actions: { type: 'array', items: { type: 'string' } },
    // One warm, honest sentence of encouragement — not empty cheerleading.
    encouragement: { type: 'string' },
  },
  required: ['standing', 'priority_gaps', 'next_actions', 'encouragement'],
}

async function gamePlan(anthropic: Anthropic, body: Record<string, unknown>) {
  const profile = body.profile as {
    summary?: string | null
    skills?: string[]
    interests?: string[]
    target_role?: string | null
    career_stage?: string | null
    years_experience?: number | null
    education?: Array<{ school?: string; credential?: string; year?: string }>
  } | undefined

  if (!profile) {
    return json({ error: 'Provide a profile.' }, 400)
  }

  // Gaps Claude already surfaced across the user's live job matches. Optional —
  // the plan still works from the profile alone — but when present it grounds the
  // advice in the roles they're actually seeing. Capped to keep the prompt lean.
  const matchGaps = Array.isArray(body.match_gaps)
    ? (body.match_gaps as string[]).map((g) => String(g)).filter(Boolean).slice(0, 15)
    : []

  const education = (profile.education ?? [])
    .map((e) => [e.credential, e.school, e.year].filter(Boolean).join(', '))
    .filter(Boolean)

  const system =
    'You are a candid, supportive career coach for early-career developers. ' +
    'Given a candidate and their target role, produce a focused game plan for ' +
    'landing that first (or next) role. Rules:\n' +
    '- "standing": 2-3 sentences honestly assessing where they are now, relative ' +
    'to their career stage. Encouraging but real.\n' +
    '- "priority_gaps": the 3-5 highest-leverage skills/experiences to close, ' +
    'ranked most-important first. For each: "why" it matters for this target ' +
    'role, and a "how" that is a specific, doable action (a project to build, a ' +
    'concept to learn, a credential to earn) — not vague advice.\n' +
    '- "next_actions": 3-5 concrete steps they can start THIS WEEK, ordered.\n' +
    '- "encouragement": one honest, warm sentence — no empty hype.\n' +
    'Lean on their transferable skills, coursework, and projects. Never shame a ' +
    'lack of professional experience — that is exactly what they are working to ' +
    'build. Prioritize the gaps that show up across their real job matches when ' +
    'those are provided.'

  const userContent =
    `CANDIDATE:\n` +
    `${describeCandidate(profile.career_stage, profile.years_experience)}\n` +
    `Target role: ${profile.target_role || '(not set — infer a sensible early-career software role)'}\n` +
    `Skills: ${(profile.skills ?? []).join(', ') || '(none listed)'}\n` +
    `Interests: ${(profile.interests ?? []).join(', ') || '(none listed)'}\n` +
    `Education: ${education.join(' | ') || '(not provided)'}\n` +
    `Resume summary: ${(profile.summary ?? '(not provided)').slice(0, 4000)}\n\n` +
    (matchGaps.length > 0
      ? `GAPS CLAUDE FLAGGED ACROSS THEIR CURRENT JOB MATCHES (weight recurring ` +
        `themes heavily):\n- ${matchGaps.join('\n- ')}\n`
      : `No live job-match gaps were provided — base the plan on the profile and ` +
        `the target role.\n`)

  // Sonnet + adaptive thinking: this is the deliberative call. max_tokens explicit.
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    output_config: { format: { type: 'json_schema', schema: GAME_PLAN_SCHEMA } },
    system,
    messages: [{ role: 'user', content: userContent }],
  })

  const textBlock = message.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return json(
      { error: 'Claude returned no text content.', stop_reason: message.stop_reason },
      502
    )
  }

  const parsed = JSON.parse(textBlock.text) as {
    standing: string
    priority_gaps: Array<{ skill: string; why: string; how: string }>
    next_actions: string[]
    encouragement: string
  }
  return json({ plan: parsed })
}
