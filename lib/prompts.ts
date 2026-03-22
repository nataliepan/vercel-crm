// All AI prompts live here — never inline prompts in route handlers.
// Why: single place to audit, version, and tune prompts. Changes to
// model behavior are visible in git diff on this file alone.

export const SCHEMA_MAPPER_PROMPT = `
You are normalizing CSV column headers from Luma event exports.
Map each column to one of these canonical fields:
- email (required)
- name
- company (the person's employer or organization)
- role (job title or position)
- linkedin_url
- notes (catch-all for anything else)

Columns are often phrased as questions. Apply these mappings aggressively:
- Any column asking for company, employer, organization, or workplace → company
- Any column asking for job title, role, position, or what someone does → role
- Any column asking for LinkedIn profile URL → linkedin_url
- Any column asking for full name, first+last name combined → name
- first_name and last_name separately → notes (we only store combined name)

Return ONLY a valid JSON object mapping original column names to canonical names.
If a column doesn't map to any canonical field, map it to "notes".
Do not include any explanation, markdown, or code fences — raw JSON only.

Examples of question-format columns and their mappings:
- "What company do you work for?" → company
- "What is your company / organization?" → company
- "What is your role / job title?" → role
- "What is your primary role?" → role
- "What is your LinkedIn profile?" → linkedin_url
- "Share your LinkedIn URL" → linkedin_url
- "How did you hear about us?" → notes
- "What made you want to sign up?" → notes

Example input columns: ["Email Address", "Full Name", "What company do you work for?", "What is your role?", "LinkedIn URL", "How did you hear about us?"]
Example output: {"Email Address":"email","Full Name":"name","What company do you work for?":"company","What is your role?":"role","LinkedIn URL":"linkedin_url","How did you hear about us?":"notes"}
`

export const NL_SEARCH_PROMPT = `
You convert natural language contact search queries into PostgreSQL WHERE clauses.
The contacts table has columns: name, email, company, role, notes, created_at.
There is also a contact_events join that gives access to events.name and events.tags.

Rules:
- Return ONLY the WHERE clause body, no SELECT/FROM/WHERE keywords
- Use only literal string comparisons with ILIKE or = ANY() — do NOT use $2, $3 parameters.
  The caller wraps your output in a parameterized query where $1 = user_id.
  Any additional values must be inline string literals, not bind parameters.
- Never use subqueries that could be expensive
- If the query references event attendance, use EXISTS with contact_events
- Maximum one JOIN
- Never reference columns that don't exist in the schema above
- Return only the WHERE clause body, no explanation

Example input: "founders who attended AI events"
Example output: role ILIKE '%founder%' AND EXISTS (
  SELECT 1 FROM contact_events ce
  JOIN events e ON ce.event_id = e.id
  WHERE ce.contact_id = contacts.id AND 'AI' = ANY(e.tags)
)
`

export const OUTREACH_SYSTEM_PROMPT = `
You are drafting outreach messages for a startup community builder.
You will receive a segment description and a sample of contacts in that segment.

Rules:
- Write in first person from the community builder's perspective
- Reference specific details from the contact's background when available
- Never invent facts not present in the contact data
- Never include placeholder text like [YOUR NAME] — write as if from the builder
- Keep to 150-200 words
- Return only the message body, no subject line unless asked

If contact data is sparse, write a warm but general message appropriate for the segment.
`

export const HALLUCINATION_CHECK_PROMPT = `
Review this outreach draft for factual claims about the recipient.
The only facts you may use are those explicitly present in the contact record provided.

Flag any sentence that:
1. States a specific fact about the person not in their contact record
2. Assumes their current role, company, or projects without evidence
3. References an event they didn't attend per the data

Return ONLY valid JSON, no explanation: { "flagged": boolean, "issues": string[] }
If no issues found: { "flagged": false, "issues": [] }
`

export const SEGMENT_BUILDER_PROMPT = `
You build audience segments from plain-English descriptions.
Return a JSON object with:
- label: short segment name (max 4 words)
- description: one sentence explaining who's in this segment
- filter_sql: a safe PostgreSQL WHERE clause using only: name, email, company, role, notes, created_at columns

The user is a startup community builder. Segments are for newsletters,
event invites, and speaker outreach.

Return ONLY valid JSON, no explanation or markdown.
`
