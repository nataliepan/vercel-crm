import Anthropic from '@anthropic-ai/sdk'
import { SCHEMA_MAPPER_PROMPT } from './prompts'

// Why generateText not streamText here: schema mapping is a short, structured
// response (JSON object). Streaming a JSON blob mid-generation is useless —
// we need the complete valid JSON before we can parse and use it.
// streamText is reserved for long-form outputs where partial content has value.

const client = new Anthropic()

export type CanonicalField = 'email' | 'name' | 'company' | 'role' | 'linkedin_url' | 'notes'

export type FieldMapping = Record<string, CanonicalField>

export async function mapCsvFields(columns: string[]): Promise<FieldMapping> {
  // Why claude-sonnet-4-6 not haiku for schema mapping: field mapping requires
  // semantic understanding of ambiguous column names like "org", "position",
  // "connection type". Haiku misses edge cases. This runs once per import,
  // not per row, so cost is negligible (~$0.001 per CSV).
  let message
  try {
    message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: SCHEMA_MAPPER_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Map these CSV columns: ${JSON.stringify(columns)}`
        }
      ]
    })
  } catch (apiErr) {
    // Surface the actual Anthropic error (e.g. billing, rate limit) rather than
    // swallowing it. The route handler will catch this and return a clear 500.
    const msg = apiErr instanceof Error ? apiErr.message : String(apiErr)
    console.error('[schema-mapper] Anthropic API error:', msg)
    throw new Error(`Anthropic API error: ${msg}`)
  }

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  console.log('[schema-mapper] Raw Claude response:', text)

  try {
    const mapping = JSON.parse(text) as FieldMapping

    // Validate: every value must be a canonical field
    const validFields: CanonicalField[] = ['email', 'name', 'company', 'role', 'linkedin_url', 'notes']
    for (const [col, field] of Object.entries(mapping)) {
      if (!validFields.includes(field)) {
        // Fallback unmapped fields to notes rather than throwing
        mapping[col] = 'notes'
      }
    }

    return mapping
  } catch {
    // Fallback: if Claude returns malformed JSON, attempt best-effort mapping
    // using simple heuristics. Never fail an import because of AI output.
    // Why: a partial import is better than a failed one. The user can re-map.
    console.error('Schema mapper returned invalid JSON, falling back to heuristics:', text)
    return heuristicMapping(columns)
  }
}

// Fallback heuristic mapping — used when AI call fails or returns bad JSON.
// Covers the most common Luma export column names without AI.
function heuristicMapping(columns: string[]): FieldMapping {
  const mapping: FieldMapping = {}

  for (const col of columns) {
    const lower = col.toLowerCase().trim()

    if (lower.includes('email') || lower === 'e-mail') {
      mapping[col] = 'email'
    } else if (lower.includes('name') && !lower.includes('company') && !lower.includes('org')) {
      mapping[col] = 'name'
    } else if (lower.includes('company') || lower.includes('org') || lower.includes('organisation')) {
      mapping[col] = 'company'
    } else if (lower.includes('title') || lower.includes('role') || lower.includes('position') || lower.includes('job')) {
      mapping[col] = 'role'
    } else if (lower.includes('linkedin')) {
      mapping[col] = 'linkedin_url'
    } else {
      mapping[col] = 'notes'
    }
  }

  return mapping
}

// Apply a field mapping to a CSV row, returning a normalized contact object
export function applyMapping(row: Record<string, string>, mapping: FieldMapping) {
  const contact: Record<string, string> = {}
  const notesFragments: string[] = []

  for (const [col, field] of Object.entries(mapping)) {
    const value = row[col]?.trim() ?? ''
    if (!value) continue

    if (field === 'notes') {
      // Accumulate all "notes" fields into one string with labels
      // Why: preserves context from event-specific questions (e.g. "Why are you attending?")
      notesFragments.push(`${col}: ${value}`)
    } else if (!contact[field]) {
      // First non-empty value wins — don't overwrite with a later duplicate column
      contact[field] = value
    }
  }

  if (notesFragments.length > 0) {
    contact.notes = notesFragments.join(' | ')
  }

  return contact
}
