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
        },
        required: ['job_id', 'score', 'why_fit', 'gaps'],
      },
    },
  },
  required: ['scores'],
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
      case 'score_events':
        return await scoreEvents(anthropic, body)
      default:
        return json({ error: `Unknown task: ${body.task}` }, 400)
    }
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

// Score a batch of jobs against the user's profile in a single Claude call.
async function scoreJobs(anthropic: Anthropic, body: Record<string, unknown>) {
  const profile = body.profile as {
    summary?: string | null
    skills?: string[]
    interests?: string[]
    location?: string | null
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
    'You are a career coach for early-career developers. Score how well each ' +
    'job fits the candidate on a 0-100 scale (100 = excellent fit). Base the ' +
    'score on overlap between their skills/interests and the role, seniority ' +
    'match, and location. For each job give a one-sentence "why you fit" and a ' +
    'one-sentence "gaps to address". Be honest and specific, not flattering.'

  const userContent =
    `CANDIDATE PROFILE:\n` +
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
  // Structured outputs guarantee the JSON shape. max_tokens explicit per
  // CLAUDE.md — ample for ~10 short entries without thinking.
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
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
    scores: Array<{ job_id: string; score: number; why_fit: string; gaps: string }>
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
    isFree: boolean
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
        is_free: e.isFree,
      })),
      null,
      2
    )

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
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
