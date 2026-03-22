import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const cursor = searchParams.get('cursor') // last id for keyset pagination
  const q = searchParams.get('q')?.trim()   // optional trigram search query

  if (q) {
    // Trigram search: ILIKE across name, email, company, role.
    // Why GIN trigram index: ILIKE '%term%' without it is a full table scan.
    // The idx_contacts_trgm_email and idx_contacts_trgm_name indexes make
    // this fast at 200k rows. No cursor needed — search results are bounded.
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
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId, `%${q}%`]
    )
    return NextResponse.json({ contacts: results.rows, nextCursor: null })
  }

  // Keyset pagination: WHERE id > $last_id — O(1) regardless of depth.
  // Why not OFFSET: OFFSET 50000 forces Postgres to scan and discard 50k rows.
  // At 200k contacts that becomes a multi-second query. Keyset is instant.
  const safeCursor = cursor ?? '00000000-0000-0000-0000-000000000000'
  const results = await db.query(
    `SELECT id, name, email, company, role, embedding_status, created_at
     FROM contacts
     WHERE user_id = $1
       AND merged_into_id IS NULL
       AND id > $2
     ORDER BY id
     LIMIT 50`,
    [userId, safeCursor]
  )

  const rows = results.rows
  const nextCursor = rows.length === 50 ? rows[rows.length - 1].id : null

  return NextResponse.json({ contacts: rows, nextCursor })
}
