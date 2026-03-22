// Why SSR: initial page load fetches the first 50 contacts server-side so
// the user sees real data immediately — no loading spinner on first paint.
// The ContactTable client component takes over for search and pagination.
//
// Why not full SSR with searchParams for every interaction: search is
// interactive (debounced input) and pagination appends rows rather than
// replacing them. Client-side state management handles this better than
// server round-trips per keystroke.
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import Nav from '@/components/nav'
import ContactTable from '@/components/contact-table'
import { Suspense } from 'react'

type SearchParams = { q?: string }

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { userId } = await auth()
  const { q } = await searchParams

  // Server-side initial fetch — same logic as the API route
  let contacts: Array<{
    id: string
    name: string | null
    email: string
    company: string | null
    role: string | null
    embedding_status: string
    created_at: string
  }> = []
  let nextCursor: string | null = null

  if (q) {
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
    contacts = results.rows
  } else {
    const results = await db.query(
      `SELECT id, name, email, company, role, embedding_status, created_at
       FROM contacts
       WHERE user_id = $1
         AND merged_into_id IS NULL
         AND id > '00000000-0000-0000-0000-000000000000'
       ORDER BY id
       LIMIT 50`,
      [userId]
    )
    contacts = results.rows
    nextCursor = contacts.length === 50 ? contacts[contacts.length - 1].id : null
  }

  const totalRes = await db.query(
    `SELECT COUNT(*) FROM contacts WHERE user_id = $1 AND merged_into_id IS NULL`,
    [userId]
  )
  const total = parseInt(totalRes.rows[0].count)

  return (
    <div className="min-h-screen bg-zinc-50">
      <Nav />
      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-6 flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Contacts</h1>
            <p className="text-zinc-500 mt-1">{total.toLocaleString()} contacts in your CRM</p>
          </div>
        </div>

        {/* Suspense boundary so searchParams resolution doesn't block nav render */}
        <Suspense fallback={<div className="py-16 text-center text-sm text-zinc-400">Loading…</div>}>
          <ContactTable
            initialContacts={contacts}
            initialNextCursor={nextCursor}
            initialQuery={q ?? ''}
          />
        </Suspense>
      </main>
    </div>
  )
}
