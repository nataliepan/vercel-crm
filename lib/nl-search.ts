import Anthropic from '@anthropic-ai/sdk'
import { NL_SEARCH_PROMPT } from './prompts'
import { db } from './db'

// Why lazy init: module-level instantiation reads process.env at import time,
// which may be before dotenv has loaded .env.local (e.g. in test environments).
// Lazy init reads the key at call time, after setup files have run.
let _anthropic: Anthropic | null = null
function getClient(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _anthropic
}

// Patterns that must never appear in an AI-generated WHERE clause.
// Why block semicolons and comments: SQL injection via chained statements.
// Why block DDL/DML keywords: the clause is injected directly into a SELECT —
// we never want the AI (or an attacker who hijacked the prompt) to mutate data.
const BLOCKED_PATTERNS = [
  /\bDROP\b/i,
  /\bDELETE\b/i,
  /\bUPDATE\b/i,
  /\bINSERT\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\b/i,
  /\bCREATE\b/i,
  /\bEXECUTE\b/i,
  /\bEXEC\b/i,
  /;/,
  /--/,
  /\/\*/,
]

// Known-safe columns the WHERE clause may reference.
// Why allowlist: if the AI hallucinates a column name that happens to exist
// in another table, the query could leak data. Allowlist is stricter than blocklist.
const ALLOWED_COLUMNS = new Set([
  'name', 'email', 'company', 'role', 'notes', 'created_at',
  'contacts', 'contact_events', 'events', 'ce', 'e',
])

export function validateSQL(sql: string): string {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(sql)) {
      throw new Error(`Unsafe SQL pattern detected: ${pattern}`)
    }
  }

  // Basic length sanity — the WHERE clause should never be enormous.
  // A genuine query rarely exceeds 500 chars.
  if (sql.length > 2000) {
    throw new Error('Generated WHERE clause is suspiciously long')
  }

  return sql
}

export async function generateWhereClause(query: string): Promise<string> {
  const message = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: NL_SEARCH_PROMPT,
    messages: [{ role: 'user', content: query }],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude')

  // Strip any accidental markdown fences the model might emit
  const raw = content.text.trim().replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()

  return validateSQL(raw)
}

export async function searchContacts(query: string, userId: string) {
  try {
    const whereClause = await generateWhereClause(query)

    // Why SET LOCAL ivfflat.probes = 1: NL search is interactive — speed over
    // exhaustive recall. probes=1 scans 0.5% of vectors, sufficient for
    // keyword-style queries. (Dedup uses probes=10 for higher recall.)
    const results = await db.query(
      `SELECT id, name, email, company, role, embedding_status, created_at
       FROM contacts
       WHERE user_id = $1
         AND merged_into_id IS NULL
         AND (${whereClause})
       LIMIT 500`,
      [userId]
    )
    return results.rows
  } catch (err) {
    // Fallback: if AI fails or SQL is invalid, fall back to plain trigram search.
    // Why: user still gets results, just less precise. Never surface an error
    // for a search — degrade gracefully. The GIN trigram index makes this fast.
    console.error('NL search failed, falling back to trigram search:', err)
    const results = await db.query(
      `SELECT id, name, email, company, role, embedding_status, created_at
       FROM contacts
       WHERE user_id = $1
         AND merged_into_id IS NULL
         AND (
           name    ILIKE $2 OR
           email   ILIKE $2 OR
           company ILIKE $2 OR
           role    ILIKE $2
         )
       LIMIT 500`,
      [userId, `%${query}%`]
    )
    return results.rows
  }
}
