// Why SSR for this page: the contact picker list is fetched server-side so
// first paint shows real contacts immediately — no skeleton + fetch round-trip.
// The OutreachPanel itself is a client component because the streaming draft
// and interactive state (contact selection, textarea) require client-side JS.
//
// Why not full client component with SWR: the contacts list doesn't change
// during a drafting session. Fetching it once at SSR time is simpler and faster.
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import Nav from '@/components/nav'
import OutreachPanel from '@/components/outreach-panel'

export default async function OutreachPage() {
  const { userId } = await auth()

  // Fetch a page of contacts for the picker — name, email, role, company.
  // Ordered by most recently added so the most relevant contacts surface first.
  // Why LIMIT 100: the picker is a scrollable list; more than 100 entries
  // becomes unwieldy to browse. For large contact lists, users should search
  // contacts first and use the segment builder for bulk targeting.
  const result = await db.query(
    `SELECT id, name, email, company, role
     FROM contacts
     WHERE user_id = $1
       AND merged_into_id IS NULL
     ORDER BY created_at DESC
     LIMIT 100`,
    [userId]
  )

  const contacts = result.rows as Array<{
    id: string
    name: string | null
    email: string
    company: string | null
    role: string | null
  }>

  return (
    <div className="min-h-screen bg-zinc-50">
      <Nav />
      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-900">Outreach Drafter</h1>
          <p className="text-zinc-500 mt-1">
            Describe your outreach goal and Claude will draft a personalized
            message — streaming word by word.
          </p>
        </div>

        {/* How-it-works callout */}
        <div className="mb-8 rounded-lg border border-zinc-200 bg-white px-5 py-4 flex gap-4 items-start">
          <span className="text-xl mt-0.5">✍️</span>
          <div className="text-sm text-zinc-600 space-y-1">
            <p>
              <strong className="text-zinc-900">How it works:</strong> Describe
              what the outreach is for (event invite, intro, speaker ask). Optionally
              pick up to 5 contacts to personalize the draft.
            </p>
            <p className="text-zinc-400 text-xs">
              Only name, role, company, and events attended are sent to the AI.
              Email addresses never leave your database.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white px-6 py-6 shadow-sm">
          <OutreachPanel contacts={contacts} />
        </div>
      </main>
    </div>
  )
}
