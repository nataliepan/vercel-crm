import Nav from '@/components/nav'
import { db } from '@/lib/db'
import { auth } from '@clerk/nextjs/server'
import Link from 'next/link'


// Why SSR + Suspense: stats come from separate DB queries. Suspense lets each
// stream in independently — first paint shows layout immediately, numbers fill
// in progressively. Better LCP than waiting for all queries to resolve.
export default async function DashboardPage() {
  const { userId } = await auth()

  const [contactsRes, eventsRes, dedupRes] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM contacts WHERE user_id = $1 AND merged_into_id IS NULL`, [userId]),
    db.query(`SELECT COUNT(*) FROM events WHERE user_id = $1`, [userId]),
    db.query(`SELECT COUNT(*) FROM dedup_candidates WHERE user_id = $1 AND status = 'pending'`, [userId]),
  ])

  const contactCount = parseInt(contactsRes.rows[0].count)
  const eventCount = parseInt(eventsRes.rows[0].count)
  const dedupCount = parseInt(dedupRes.rows[0].count)

  return (
    <div className="min-h-screen bg-zinc-50">
      <Nav />
      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-900">Dashboard</h1>
          <p className="text-zinc-500 mt-1">Your community contact intelligence layer.</p>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard label="Contacts" value={contactCount} />
          <StatCard label="Events imported" value={eventCount} />
          <StatCard label="Dedup candidates" value={dedupCount} />
        </div>

        {contactCount === 0 && (
          <div className="bg-white rounded-xl border border-zinc-200 p-8 text-center">
            <p className="text-zinc-500 mb-4">No contacts yet. Import your first Luma CSV to get started.</p>
            <Link
              href="/import"
              className="inline-block rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 transition-colors"
            >
              Import contacts →
            </Link>
          </div>
        )}
      </main>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-6">
      <p className="text-sm text-zinc-500 mb-1">{label}</p>
      <p className="text-3xl font-bold text-zinc-900">{value.toLocaleString()}</p>
    </div>
  )
}
