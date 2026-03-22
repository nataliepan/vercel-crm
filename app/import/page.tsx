// Why SSR (not client component) for the page wrapper: the page shell —
// heading, layout, nav — is static. Only the uploader widget is interactive.
// Keeping the page as a server component lets us add auth checks here without
// client-side flicker, while the CsvUploader handles all interactivity.
import CsvUploader from '@/components/csv-uploader'
import Nav from '@/components/nav'

export default function ImportPage() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <Nav />
      <main className="max-w-2xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-900">Import contacts</h1>
          <p className="text-zinc-500 mt-1">
            Upload a CSV from any Luma event. Claude will normalize the column names automatically.
          </p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-6">
          <CsvUploader />
        </div>
      </main>
    </div>
  )
}
