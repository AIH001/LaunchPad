// claude: the single Edge Function that all Claude-powered features route through
// (see CLAUDE.md — "centralize Claude calls in the claude Edge Function").
// Dispatches by a `task` field. Today it scores jobs; cover letters / digests
// will be added as new tasks here.
//
// The ANTHROPIC_API_KEY lives only as a Supabase secret — it is read here on the
// server and never reaches the browser.
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'
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
    resume_text?: string | null
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
    `Resume: ${(profile.resume_text ?? '(not provided)').slice(0, 4000)}\n\n` +
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
