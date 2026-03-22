import { Suspense } from 'react'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import Nav from '@/components/nav'
import Link from 'next/link'

// Why SSR + Suspense streaming (not Promise.all):
// Stats come from 3 separate DB queries. With Promise.all the page waits for
// the slowest query before rendering anything. With Suspense each stat card
// streams in independently as its query resolves — first meaningful paint
// shows the layout immediately, numbers fill in progressively. Better LCP.
//
// Why not PPR here: dashboard chrome is static (good PPR candidate) but the
// stat cards are the entire content. PPR saves the shell paint but the user
// still stares at skeletons until DB queries finish. Suspense streaming gives
// the same progressive reveal without PPR's added complexity.

// --- Async RSC stat components — each owns its own DB query ---

async function ContactCount() {
  const { userId } = await auth()
  const res = await db.query(
    `SELECT COUNT(*) FROM contacts WHERE user_id = $1 AND merged_into_id IS NULL`,
    [userId]
  )
  const count = parseInt(res.rows[0].count)
  return (
    <StatCard
      label="Contacts"
      value={count}
      href="/contacts"
      empty={count === 0}
      emptyLabel="Import your first CSV →"
    />
  )
}

async function EventCount() {
  const { userId } = await auth()
  const res = await db.query(
    `SELECT COUNT(*) FROM events WHERE user_id = $1`,
    [userId]
  )
  const count = parseInt(res.rows[0].count)
  return (
    <StatCard
      label="Events imported"
      value={count}
      href="/import"
    />
  )
}

async function DedupQueue() {
  const { userId } = await auth()
  const res = await db.query(
    `SELECT COUNT(*) FROM dedup_candidates WHERE user_id = $1 AND status = 'pending'`,
    [userId]
  )
  const count = parseInt(res.rows[0].count)
  return (
    <StatCard
      label="Dedup candidates"
      value={count}
      href="/contacts"
      // Surface the count as a signal — non-zero means duplicates to review
      highlight={count > 0}
    />
  )
}

// --- Quick-action cards shown when contacts exist ---

async function QuickActions() {
  const { userId } = await auth()
  const res = await db.query(
    `SELECT COUNT(*) FROM contacts WHERE user_id = $1 AND merged_into_id IS NULL`,
    [userId]
  )
  const hasContacts = parseInt(res.rows[0].count) > 0

  if (!hasContacts) return null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <ActionCard
        href="/contacts"
        icon="🔍"
        title="Search contacts"
        description="Natural language search across your full contact list"
      />
      <ActionCard
        href="/outreach"
        icon="✍️"
        title="Draft outreach"
        description="Describe your goal, get a personalized draft in seconds"
      />
      <ActionCard
        href="/import"
        icon="📥"
        title="Import more"
        description="Upload another Luma CSV — AI normalizes the schema"
      />
    </div>
  )
}

// --- Empty state shown when no contacts yet ---

async function EmptyState() {
  const { userId } = await auth()
  const res = await db.query(
    `SELECT COUNT(*) FROM contacts WHERE user_id = $1 AND merged_into_id IS NULL`,
    [userId]
  )
  const hasContacts = parseInt(res.rows[0].count) > 0
  if (hasContacts) return null

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-10 text-center">
      <p className="text-2xl mb-3">👋</p>
      <p className="text-zinc-900 font-medium mb-1">Welcome to Luma CRM</p>
      <p className="text-zinc-500 text-sm mb-6">
        Import your first Luma event CSV to get started.
        AI will normalize the column headers automatically.
      </p>
      <Link
        href="/import"
        className="inline-block rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 transition-colors"
      >
        Import contacts →
      </Link>
    </div>
  )
}

// --- Page ---

export default function DashboardPage() {
  // Why this is not async: the page shell renders immediately.
  // Each Suspense boundary resolves its own async RSC independently.
  // The skeleton grid appears on first paint while queries are in-flight.
  return (
    <div className="min-h-screen bg-zinc-50">
      <Nav />
      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-900">Dashboard</h1>
          <p className="text-zinc-500 mt-1">Your community contact intelligence layer.</p>
        </div>

        {/* Stat cards — each streams in as its query resolves */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <Suspense fallback={<StatSkeleton />}>
            <ContactCount />
          </Suspense>
          <Suspense fallback={<StatSkeleton />}>
            <EventCount />
          </Suspense>
          <Suspense fallback={<StatSkeleton />}>
            <DedupQueue />
          </Suspense>
        </div>

        {/* Quick actions — only rendered once contacts exist */}
        <Suspense fallback={null}>
          <QuickActions />
        </Suspense>

        {/* Empty state — only rendered when no contacts */}
        <Suspense fallback={null}>
          <EmptyState />
        </Suspense>
      </main>
    </div>
  )
}

// --- UI primitives ---

function StatSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-6 animate-pulse">
      <div className="h-3 w-24 bg-zinc-100 rounded mb-3" />
      <div className="h-8 w-16 bg-zinc-100 rounded" />
    </div>
  )
}

function StatCard({
  label,
  value,
  href,
  highlight = false,
  empty = false,
  emptyLabel,
}: {
  label: string
  value: number
  href: string
  highlight?: boolean
  empty?: boolean
  emptyLabel?: string
}) {
  return (
    <Link
      href={href}
      className={`block bg-white rounded-xl border p-6 hover:shadow-sm transition-shadow ${
        highlight ? 'border-amber-300 bg-amber-50' : 'border-zinc-200'
      }`}
    >
      <p className="text-sm text-zinc-500 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${highlight ? 'text-amber-700' : 'text-zinc-900'}`}>
        {value.toLocaleString()}
      </p>
      {empty && emptyLabel && (
        <p className="text-xs text-zinc-400 mt-2">{emptyLabel}</p>
      )}
    </Link>
  )
}

function ActionCard({
  href,
  icon,
  title,
  description,
}: {
  href: string
  icon: string
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="block bg-white rounded-xl border border-zinc-200 p-5 hover:shadow-sm transition-shadow"
    >
      <span className="text-2xl mb-3 block">{icon}</span>
      <p className="text-sm font-medium text-zinc-900 mb-1">{title}</p>
      <p className="text-xs text-zinc-500 leading-relaxed">{description}</p>
    </Link>
  )
}
