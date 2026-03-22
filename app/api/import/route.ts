import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import Papa from 'papaparse'
import { db } from '@/lib/db'
import { mapCsvFields, applyMapping } from '@/lib/schema-mapper'

// Why maxDuration 120: CSV parsing + AI schema mapping + bulk upsert can take
// 30-60s for large files. Default Vercel timeout is 10s — not enough.
// We return immediately after queuing; dedup/embed run in background cron.
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const step = { current: 'auth' } // track which step failed for debugging

  try {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  step.current = 'parse-form'
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const eventName = (formData.get('eventName') as string) || 'Unnamed Event'

  // Validate file presence and type
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
    return NextResponse.json({ error: 'File must be a CSV' }, { status: 400 })
  }
  // Why 10MB limit: Luma exports for 200k contacts are ~40MB uncompressed.
  // We process in chunks so 10MB per upload keeps memory and timeout manageable.
  // Users with larger exports should split by event (which they already do).
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 })
  }

  const csvText = await file.text()

  // Why papaparse: handles quoted fields, BOM characters, inconsistent line endings —
  // all common in Luma exports. Native split(',') breaks on quoted commas.
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(), // strip whitespace from headers
  })

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return NextResponse.json({ error: 'Could not parse CSV', details: parsed.errors[0]?.message }, { status: 400 })
  }

  // Why 50k row limit: at 200k contacts we process across multiple imports.
  // A single 50k-row import already takes ~60s for embedding. Keep imports manageable.
  if (parsed.data.length > 50000) {
    return NextResponse.json({ error: 'CSV too large (max 50,000 rows)' }, { status: 400 })
  }

  const columns = parsed.meta.fields ?? []
  if (columns.length === 0) {
    return NextResponse.json({ error: 'CSV has no columns' }, { status: 400 })
  }

  // Step 1: AI maps CSV columns to canonical fields
  // This is the "wow" moment — Claude understands that "Email Address", "e-mail",
  // and "Contact Email" all mean the same thing across different Luma event exports.
  step.current = 'ai-schema-mapping'
  console.log(`[import] Mapping ${columns.length} columns via Claude:`, columns)
  const fieldMapping = await mapCsvFields(columns)
  console.log('[import] Field mapping result:', fieldMapping)

  // Verify email column exists in mapping
  const hasEmail = Object.values(fieldMapping).includes('email')
  if (!hasEmail) {
    return NextResponse.json({
      error: 'Could not find an email column in this CSV',
      mapping: fieldMapping
    }, { status: 400 })
  }

  // Step 2: Create event record
  step.current = 'create-event'
  const eventResult = await db.query(
    `INSERT INTO events (user_id, name, source_filename, attendee_count)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [userId, eventName, file.name, parsed.data.length]
  )
  const eventId = eventResult.rows[0].id

  // Step 3: Upsert contacts
  // Why ON CONFLICT DO UPDATE: re-importing the same CSV is safe and idempotent.
  // New fields from a re-export overwrite stale ones without creating duplicates.
  step.current = 'upsert-contacts'
  console.log(`[import] Upserting ${parsed.data.length} rows into contacts`)
  let imported = 0
  let skipped = 0
  const contactIds: string[] = []

  for (const row of parsed.data) {
    const normalized = applyMapping(row, fieldMapping)

    // Skip rows without email — can't deduplicate without it
    if (!normalized.email) {
      skipped++
      continue
    }

    // Sanitize: strip control characters from all string fields
    const clean = Object.fromEntries(
      Object.entries(normalized).map(([k, v]) => [k, v.replace(/[\x00-\x1F\x7F]/g, ' ').trim()])
    )

    const result = await db.query(
      `INSERT INTO contacts (user_id, email, name, company, role, linkedin_url, notes, raw_fields, embedding_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       ON CONFLICT (user_id, email)
       DO UPDATE SET
         name = COALESCE(EXCLUDED.name, contacts.name),
         company = COALESCE(EXCLUDED.company, contacts.company),
         role = COALESCE(EXCLUDED.role, contacts.role),
         linkedin_url = COALESCE(EXCLUDED.linkedin_url, contacts.linkedin_url),
         notes = COALESCE(EXCLUDED.notes, contacts.notes),
         raw_fields = EXCLUDED.raw_fields,
         embedding_status = 'pending',
         updated_at = now()
       RETURNING id`,
      [
        userId,
        clean.email?.toLowerCase(),
        clean.name ?? null,
        clean.company ?? null,
        clean.role ?? null,
        clean.linkedin_url ?? null,
        clean.notes ?? null,
        JSON.stringify(row), // preserve original row for audit
      ]
    )

    const contactId = result.rows[0]?.id
    if (contactId) {
      contactIds.push(contactId)
      imported++

      // Link contact to this event
      await db.query(
        `INSERT INTO contact_events (contact_id, event_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [contactId, eventId]
      )
    }
  }

  // Step 4: Queue a dedup job (runs in background — don't block the response)
  // Why async: at 200k contacts dedup takes minutes. Return immediately,
  // cron picks up 'pending' jobs nightly.
  step.current = 'queue-dedup'
  await db.query(
    `INSERT INTO dedup_jobs (user_id, status, contacts_total)
     VALUES ($1, 'pending', $2)`,
    [userId, imported]
  )

  console.log(`[import] Done — imported: ${imported}, skipped: ${skipped}`)
  return NextResponse.json({
    success: true,
    eventId,
    imported,
    skipped,
    total: parsed.data.length,
    fieldMapping, // return mapping so UI can show the user what Claude decided
    columns,      // original columns for display
  })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[import] Failed at step "${step.current}":`, err)
    return NextResponse.json(
      { error: `Import failed at step: ${step.current}`, detail: message },
      { status: 500 }
    )
  }
}
