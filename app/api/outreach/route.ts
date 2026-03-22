import { auth } from '@clerk/nextjs/server'
import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { db } from '@/lib/db'
import { OUTREACH_SYSTEM_PROMPT } from '@/lib/prompts'

// Why streamText not generateText: outreach drafts are 150-300 words.
// With generateText the user stares at a spinner for 3-5 seconds.
// Streaming shows the first words in ~300ms — dramatically better UX.
//
// Why useCompletion (client) + this route: useCompletion sends { prompt, ...body }
// and reads a plain text stream. toTextStreamResponse() returns exactly that —
// a simple streaming response, no SSE envelope needed.

// Rate limiting: max 20 requests/minute per user tracked in-memory.
// Why in-memory not Redis: at this scale (demo app) an in-memory map is fine.
// For multi-instance production, swap to Vercel KV.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const window = rateLimitMap.get(userId)

  if (!window || now > window.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + 60_000 })
    return true
  }

  if (window.count >= 20) return false
  window.count++
  return true
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  if (!checkRateLimit(userId)) {
    return new Response('Rate limit exceeded — max 20 drafts per minute', { status: 429 })
  }

  // useCompletion sends { prompt, ...body } — we read prompt as the context
  // and contactIds from the extra body fields.
  const body = await req.json()
  const context = (body.prompt ?? body.context ?? '') as string
  const contactIds = (body.contactIds ?? []) as string[]

  if (!context.trim()) {
    return new Response('prompt is required', { status: 400 })
  }

  // Fetch a safe subset of contact data — never send email to the model.
  // Why omit email: email isn't needed for drafting, and keeping PII out of
  // AI context satisfies most enterprise data handling requirements out of the box.
  let contactSample: Array<{
    name: string | null
    role: string | null
    company: string | null
    events: string[]
  }> = []

  if (contactIds.length > 0) {
    const safeIds = contactIds.slice(0, 5) // cap at 5 to keep context small

    const result = await db.query(
      `SELECT c.name, c.role, c.company,
              COALESCE(
                array_agg(e.name ORDER BY ce.registered_at DESC) FILTER (WHERE e.name IS NOT NULL),
                '{}'
              ) AS events
       FROM contacts c
       LEFT JOIN contact_events ce ON ce.contact_id = c.id
       LEFT JOIN events e ON e.id = ce.event_id
       WHERE c.id = ANY($1) AND c.user_id = $2
       GROUP BY c.id, c.name, c.role, c.company`,
      [safeIds, userId]
    )
    contactSample = result.rows
  }

  // Build the user message — contacts as JSON, context as plain text.
  // Why JSON for contacts not prose: the model reliably extracts structured fields.
  // Prose summaries introduce paraphrase errors that could hallucinate details.
  const userMessage = [
    `Outreach context: ${context}`,
    contactSample.length > 0
      ? `Contact sample (${contactSample.length} recipient${contactSample.length > 1 ? 's' : ''}):\n${JSON.stringify(contactSample, null, 2)}`
      : 'No specific contacts provided — write a warm general message for this audience.',
  ].join('\n\n')

  const result = await streamText({
    model: anthropic('claude-sonnet-4-6'),
    // Why claude-sonnet-4-6 not haiku: haiku is 5x cheaper but meaningfully
    // worse at following nuanced persona instructions and avoiding hallucinated
    // contact details. For outreach that goes to real people, quality > cost.
    // ~$0.02/draft is negligible.
    system: OUTREACH_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    maxOutputTokens: 1000,
    // Why maxOutputTokens not maxTokens: AI SDK v6 renamed this param to align
    // with underlying model API terminology. 1000 tokens ≈ 750 words — plenty
    // for a 150-200 word draft with headroom.
  })

  // toTextStreamResponse streams raw text deltas — exactly what useCompletion
  // on the client expects. No SSE envelope, no JSON wrapper.
  return result.toTextStreamResponse()
}
