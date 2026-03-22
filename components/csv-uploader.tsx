'use client'

// Why client component: file input, drag-and-drop, upload progress, and the
// AI mapping result display are all interactive. RSC can't handle onChange,
// fetch, or state. This is genuinely client-side work.

import { useState, useRef } from 'react'

type FieldMapping = Record<string, string>

type UploadResult = {
  success: boolean
  imported: number
  skipped: number
  total: number
  fieldMapping: FieldMapping
  columns: string[]
  eventId: string
  error?: string
}

const FIELD_COLORS: Record<string, string> = {
  email: 'bg-blue-100 text-blue-800',
  name: 'bg-green-100 text-green-800',
  company: 'bg-purple-100 text-purple-800',
  role: 'bg-orange-100 text-orange-800',
  linkedin_url: 'bg-sky-100 text-sky-800',
  notes: 'bg-zinc-100 text-zinc-600',
}

export default function CsvUploader() {
  const [isDragging, setIsDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [eventName, setEventName] = useState('')
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped?.name.endsWith('.csv')) setFile(dropped)
  }

  async function handleUpload() {
    if (!file) return
    setStatus('uploading')
    setError(null)
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('eventName', eventName || file.name.replace('.csv', ''))

    try {
      const res = await fetch('/api/import', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Upload failed')
        setStatus('error')
        return
      }

      setResult(data)
      setStatus('done')
    } catch {
      setError('Network error — please try again')
      setStatus('error')
    }
  }

  return (
    <div className="space-y-6">
      {/* Event name */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">
          Event name <span className="text-zinc-400">(optional)</span>
        </label>
        <input
          type="text"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          placeholder="e.g. AI Founders Dinner — March 2025"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900"
        />
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed px-8 py-12 text-center transition-colors ${
          isDragging ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-300 hover:border-zinc-400'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <div className="text-4xl mb-3">📄</div>
        {file ? (
          <div>
            <p className="font-medium text-zinc-900">{file.name}</p>
            <p className="text-sm text-zinc-500 mt-1">{(file.size / 1024).toFixed(1)} KB — click to change</p>
          </div>
        ) : (
          <div>
            <p className="font-medium text-zinc-700">Drop your Luma CSV here</p>
            <p className="text-sm text-zinc-400 mt-1">or click to browse — max 10MB, 50k rows</p>
          </div>
        )}
      </div>

      {/* Upload button */}
      {file && status !== 'done' && (
        <button
          onClick={handleUpload}
          disabled={status === 'uploading'}
          className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {status === 'uploading' ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Claude is mapping your fields…
            </span>
          ) : 'Import contacts'}
        </button>
      )}

      {/* Error */}
      {status === 'error' && error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Success + AI mapping result */}
      {status === 'done' && result && (
        <div className="space-y-4">
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3">
            <p className="text-sm font-medium text-green-800">
              ✓ {result.imported.toLocaleString()} contacts imported
              {result.skipped > 0 && ` · ${result.skipped} skipped (no email)`}
            </p>
          </div>

          {/* Show Claude's field mapping — the "wow" moment */}
          <div className="rounded-xl border border-zinc-200 overflow-hidden">
            <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-3">
              <p className="text-sm font-semibold text-zinc-900">Claude's field mapping</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                AI normalized {result.columns.length} columns from your CSV
              </p>
            </div>
            <div className="divide-y divide-zinc-100">
              {result.columns.map((col) => {
                const mapped = result.fieldMapping[col]
                return (
                  <div key={col} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-zinc-700 font-mono">{col}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${FIELD_COLORS[mapped] ?? 'bg-zinc-100 text-zinc-600'}`}>
                      → {mapped}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <a
            href="/contacts"
            className="block w-full text-center rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            View contacts →
          </a>
        </div>
      )}
    </div>
  )
}
