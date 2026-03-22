'use client'

// Why client component: streaming + interactive state (contact picker,
// context input, abort control) can't be managed in an RSC.
//
// Why useCompletion not useChat: this is a single-turn completion — the user
// describes their goal, Claude drafts a message, done. useCompletion is
// purpose-built for this: complete(prompt, { body }) → streaming text.
// useChat adds multi-turn message history we don't need here.

import { useCompletion } from '@ai-sdk/react'
import { useState } from 'react'

type Contact = {
  id: string
  name: string | null
  email: string
  company: string | null
  role: string | null
}

type Props = {
  contacts: Contact[]
}

export default function OutreachPanel({ contacts }: Props) {
  const [context, setContext] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // useCompletion gives us: streaming token display, loading state, abort,
  // and error handling — all without managing fetch + ReadableStream manually.
  // complete(prompt, { body }) sends { prompt, ...body } to the API.
  const { completion, complete, isLoading, stop, error, setCompletion } = useCompletion({
    api: '/api/outreach',
    // Why streamProtocol text: our API returns toTextStreamResponse() — plain
    // streaming text, not the SSE data: envelope. 'text' tells useCompletion
    // to read it as a raw text stream.
    streamProtocol: 'text',
  })

  function toggleContact(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, 5)
    )
  }

  async function handleDraft() {
    if (!context.trim()) return
    setCompletion('') // clear previous draft

    // complete() POSTs { prompt: context, contactIds } to /api/outreach.
    // The API reads prompt as the outreach context and contactIds to personalize.
    await complete(context, { body: { contactIds: selectedIds } })
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      {/* Left: inputs */}
      <div className="space-y-6">
        {/* Context */}
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">
            What&apos;s this outreach for?
          </label>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="e.g. Invite YC founders to our AI demo day on April 10th. Warm, brief, no fluff."
            rows={4}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 resize-none"
          />
        </div>

        {/* Contact picker */}
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">
            Personalize for (optional, up to 5)
          </label>
          <p className="text-xs text-zinc-500 mb-2">
            Select contacts to tailor the draft. Their name, role, and events
            attended are sent to the AI — never their email address.
          </p>

          {contacts.length === 0 ? (
            <p className="text-sm text-zinc-400 italic">
              No contacts yet — import a CSV first.
            </p>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-200 divide-y divide-zinc-100">
              {contacts.map((c) => {
                const selected = selectedIds.includes(c.id)
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleContact(c.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-50 transition-colors ${
                      selected ? 'bg-zinc-100' : ''
                    }`}
                  >
                    {/* Checkbox indicator */}
                    <span
                      className={`flex-shrink-0 w-4 h-4 rounded border transition-colors ${
                        selected ? 'bg-zinc-900 border-zinc-900' : 'border-zinc-300'
                      }`}
                    >
                      {selected && (
                        <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
                          <path
                            d="M3.5 8l3 3 6-6"
                            stroke="white"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-zinc-900 truncate">
                        {c.name ?? c.email}
                      </span>
                      {(c.role || c.company) && (
                        <span className="block text-xs text-zinc-500 truncate">
                          {[c.role, c.company].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          {selectedIds.length > 0 && (
            <p className="text-xs text-zinc-500 mt-1.5">
              {selectedIds.length} of 5 selected
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleDraft}
            disabled={!context.trim() || isLoading}
            className="flex-1 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Drafting…' : 'Draft message'}
          </button>

          {isLoading && (
            <button
              onClick={stop}
              className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Right: streaming output */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1.5">
          Draft
        </label>

        {error ? (
          // Why explicit error state: never show a blank screen.
          // Surface a recoverable state — the user can clear and retry.
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-700 mb-3">{error.message}</p>
            <button
              onClick={() => setCompletion('')}
              className="text-sm font-medium text-red-700 underline"
            >
              Clear and retry
            </button>
          </div>
        ) : completion ? (
          <div className="relative rounded-lg border border-zinc-200 bg-white p-4 min-h-40">
            {/* Tokens appended word-by-word as they arrive from the stream */}
            <p className="text-sm text-zinc-800 whitespace-pre-wrap leading-relaxed">
              {completion}
              {/* Blinking cursor while streaming — removed when done */}
              {isLoading && (
                <span className="inline-block w-0.5 h-4 bg-zinc-400 animate-pulse ml-0.5 align-text-bottom" />
              )}
            </p>

            {/* Copy button — only shown when draft is complete */}
            {!isLoading && (
              <button
                onClick={() => navigator.clipboard.writeText(completion)}
                className="absolute top-3 right-3 text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
              >
                Copy
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-8 min-h-40 flex items-center justify-center">
            <p className="text-sm text-zinc-400 text-center">
              {isLoading
                ? 'Claude is writing…'
                : 'Your draft will appear here, streaming word by word.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
