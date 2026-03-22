import { db } from '@/lib/db'
import OpenAI from 'openai'

// Nightly cron: retry contacts where embedding_status = 'pending' or 'failed'.
// Schedule: 2am UTC (see vercel.json)
//
// Why a cron not inline at import: at 200k contacts, embedding all rows inline
// would exceed Vercel's function timeout. The import route sets status='pending'
// and returns immediately. This cron picks up the work nightly.
//
// Why 2am not 3am: staggered from the dedup cron (3am) so they don't compete
// for DB connections. Embed must finish before dedup runs — dedup needs vectors.

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const CHUNK_SIZE = 2048 // OpenAI embeddings API max inputs per call

export async function GET(req: Request) {
  // Why CRON_SECRET: Vercel sets Authorization: Bearer <CRON_SECRET> on cron
  // invocations automatically. Without this check, anyone who knows the URL
  // could trigger the job on demand — burning API quota and DB connections.
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Find all users who have pending/failed contacts.
  // Why group by user_id: jobs are isolated per user — one user's large import
  // shouldn't starve another user's embed queue.
  const usersRes = await db.query(`
    SELECT DISTINCT user_id
    FROM contacts
    WHERE embedding_status IN ('pending', 'failed')
  `)

  let totalProcessed = 0
  let totalFailed = 0

  for (const { user_id } of usersRes.rows) {
    const contactsRes = await db.query(
      `SELECT id, name, role, company, notes
       FROM contacts
       WHERE user_id = $1
         AND embedding_status IN ('pending', 'failed')
       LIMIT 5000`,
      // Why LIMIT 5000: each cron invocation is capped at 300s (vercel.json).
      // 5000 contacts ÷ chunk_size 2048 = ~3 API calls, well within time budget.
      // Remaining rows are picked up on the next nightly run.
      [user_id]
    )

    const contacts = contactsRes.rows

    for (let i = 0; i < contacts.length; i += CHUNK_SIZE) {
      const chunk = contacts.slice(i, i + CHUNK_SIZE)

      // Why omit email from embedding text: email isn't semantically meaningful
      // for similarity — "john@gmail.com" vs "john@company.com" are different
      // strings but could be the same person. name+role+company+notes clusters
      // better in embedding space.
      const texts = chunk.map((c: { name: string | null; role: string | null; company: string | null; notes: string | null }) =>
        [c.name, c.role, c.company, c.notes].filter(Boolean).join(' ') || 'unknown'
      )
      const ids = chunk.map((c: { id: string }) => c.id)

      try {
        const response = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          // Why text-embedding-3-small: vector(1536) — exact dimension we
          // declared in the schema. Wrong model = wrong dimension = insert error.
          input: texts,
        })

        const vectors = response.data.map((d) => `[${d.embedding.join(',')}]`)

        // Why unnest bulk update: replaces chunk_size sequential round-trips
        // with one query. At 200k contacts (~98 chunks), N+1 updates add ~3
        // minutes of pure DB write time. unnest does the same in seconds.
        await db.query(`
          UPDATE contacts SET
            embedding = data.vec::vector,
            embedding_status = 'done',
            updated_at = now()
          FROM unnest($1::uuid[], $2::text[]) AS data(id, vec)
          WHERE contacts.id = data.id
        `, [ids, vectors])

        totalProcessed += chunk.length
      } catch (err) {
        // Mark as failed — next nightly run will retry.
        // Why not throw: one failed chunk shouldn't abort the remaining chunks.
        console.error(`Embed chunk failed for user ${user_id}:`, err)
        await db.query(
          `UPDATE contacts SET embedding_status = 'failed' WHERE id = ANY($1)`,
          [ids]
        )
        totalFailed += chunk.length
      }
    }
  }

  console.log(`Embed cron complete: ${totalProcessed} embedded, ${totalFailed} failed`)
  return Response.json({ ok: true, totalProcessed, totalFailed })
}
