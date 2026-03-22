'use client'

// Why client component: search input state, pagination cursor, and loading
// states all require interactivity. The data fetching is driven by user actions
// (typing, clicking Next) — RSC would need a round-trip for every keystroke.

import { useState, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

type Contact = {
  id: string
  name: string | null
  email: string
  company: string | null
  role: string | null
  embedding_status: string
  created_at: string
}

type Props = {
  initialContacts: Contact[]
  initialNextCursor: string | null
  initialQuery: string
}

export default function ContactTable({ initialContacts, initialNextCursor, initialQuery }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [contacts, setContacts] = useState<Contact[]>(initialContacts)
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor)
  const [query, setQuery] = useState(initialQuery)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // Debounced search: wait 300ms after the user stops typing before fetching.
  // Avoids firing a request on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (query) {
        params.set('q', query)
      } else {
        params.delete('q')
      }
      router.push(`/contacts?${params.toString()}`, { scroll: false })

      setLoading(true)
      const url = query ? `/api/contacts?q=${encodeURIComponent(query)}` : '/api/contacts'
      fetch(url)
        .then(r => r.json())
        .then(data => {
          setContacts(data.contacts)
          setNextCursor(data.nextCursor)
        })
        .finally(() => setLoading(false))
    }, 300)

    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/contacts?cursor=${nextCursor}`)
      const data = await res.json()
      setContacts(prev => [...prev, ...data.contacts])
      setNextCursor(data.nextCursor)
    } finally {
      setLoadingMore(false)
    }
  }, [nextCursor, loadingMore])

  return (
    <div>
      {/* Search box */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by name, email, company, or role…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {loading ? (
          <div className="py-16 text-center text-sm text-zinc-400">Searching…</div>
        ) : contacts.length === 0 ? (
          <div className="py-16 text-center text-sm text-zinc-400">
            {query ? 'No contacts match your search.' : 'No contacts yet. Import a CSV to get started.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50">
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Name</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Email</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Company</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Role</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Embed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {contacts.map(contact => (
                <tr key={contact.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-zinc-900">
                    {contact.name ?? <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{contact.email}</td>
                  <td className="px-4 py-3 text-zinc-600">
                    {contact.company ?? <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {contact.role ?? <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <EmbedBadge status={contact.embedding_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Load more */}
      {nextCursor && !loading && (
        <div className="mt-4 text-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-lg border border-zinc-200 bg-white px-5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}

function EmbedBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    done:    'bg-green-50 text-green-700',
    pending: 'bg-yellow-50 text-yellow-700',
    failed:  'bg-red-50 text-red-700',
  }
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-zinc-100 text-zinc-500'}`}>
      {status}
    </span>
  )
}
