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

type SearchMode = 'text' | 'nl'

export default function ContactTable({ initialContacts, initialNextCursor, initialQuery }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [contacts, setContacts] = useState<Contact[]>(initialContacts)
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor)
  const [query, setQuery] = useState(initialQuery)
  const [mode, setMode] = useState<SearchMode>('text')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // Debounced search: wait 400ms for NL (AI call), 300ms for text.
  // Avoids firing a request on every keystroke.
  useEffect(() => {
    const delay = mode === 'nl' ? 600 : 300
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (query) {
        params.set(mode === 'nl' ? 'nl' : 'q', query)
        params.delete(mode === 'nl' ? 'q' : 'nl')
      } else {
        params.delete('q')
        params.delete('nl')
      }
      router.push(`/contacts?${params.toString()}`, { scroll: false })

      setLoading(true)
      let url = '/api/contacts'
      if (query) {
        url += mode === 'nl'
          ? `?nl=${encodeURIComponent(query)}`
          : `?q=${encodeURIComponent(query)}`
      }
      fetch(url)
        .then(r => r.json())
        .then(data => {
          setContacts(data.contacts)
          setNextCursor(data.nextCursor)
        })
        .finally(() => setLoading(false))
    }, delay)

    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode])

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

  const placeholder = mode === 'nl'
    ? 'Ask in plain English, e.g. "founders who attended AI events"…'
    : 'Search by name, email, company, or role…'

  return (
    <div>
      {/* Search box + mode toggle */}
      <div className="mb-4 flex gap-2">
        <input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="flex-1 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900"
        />
        {/* Mode toggle: text search vs NL (AI) search */}
        <button
          onClick={() => { setMode(m => m === 'text' ? 'nl' : 'text'); setQuery('') }}
          className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            mode === 'nl'
              ? 'border-zinc-900 bg-zinc-900 text-white'
              : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
          }`}
          title={mode === 'nl' ? 'Switch to text search' : 'Switch to AI (natural language) search'}
        >
          {mode === 'nl' ? 'AI search' : 'AI search'}
        </button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {loading ? (
          <div className="py-16 text-center text-sm text-zinc-400">
            {mode === 'nl' ? 'Asking Claude…' : 'Searching…'}
          </div>
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
