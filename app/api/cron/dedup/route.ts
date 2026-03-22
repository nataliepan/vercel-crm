import { db } from '@/lib/db'

// Nightly cron: continue incremental dedup for all users.
// Schedule: 3am UTC (see vercel.json) — runs after embed cron (2am) so
// vectors are fresh before similarity comparisons.
//
// Why incremental (last_dedup_checked_at): at 200k contacts a full nightly
// re-scan is O(n) × O(ANN). With probes=10 and lists=200, each ANN ~5ms.
// 200k × 5ms = 1000s — far beyond Vercel's 300s max. Incremental mode only
// checks contacts where last_dedup_checked_at IS NULL (new since last run).
// At steady state that's a few hundred rows, not 200k.

const SIMILARITY_THRESHOLD = 0.92
const BATCH_SIZE = 500 // contacts processed per cron invocation per user

export async function GET(req: Request) {
  // Why CRON_SECRET: Vercel sets Authorization: Bearer <CRON_SECRET> on cron
  // invocations automatically. Reject anything else to prevent abuse.
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Find users who have unchecked contacts (new imports since last run).
  const usersRes = await db.query(`
    SELECT DISTINCT user_id
    FROM contacts
    WHERE last_dedup_checked_at IS NULL
      AND embedding IS NOT NULL
      AND merged_into_id IS NULL
  `)

  let totalPairsFound = 0

  for (const { user_id } of usersRes.rows) {
    // Pass 1: exact email duplicates — always fast, catches ~80% of dupes
    const emailDupes = await db.query(`
      SELECT a.id AS a_id, b.id AS b_id, 1.0 AS similarity
      FROM contacts a
      JOIN contacts b
        ON lower(a.email) = lower(b.email)
        AND a.id < b.id
        AND a.user_id = $1
        AND b.user_id = $1
        AND a.merged_into_id IS NULL
        AND b.merged_into_id IS NULL
    `, [user_id])

    // Pass 2: vector similarity on unchecked contacts only (incremental)
    const unchecked = await db.query(`
      SELECT id, embedding
      FROM contacts
      WHERE user_id = $1
        AND merged_into_id IS NULL
        AND embedding IS NOT NULL
        AND last_dedup_checked_at IS NULL
      ORDER BY created_at
      LIMIT $2
    `, [user_id, BATCH_SIZE])

    const vectorPairs: Array<{ a_id: string; b_id: string; similarity: number }> = []

    for (const contact of unchecked.rows) {
      // probes=10 for dedup: scans 5% of ivfflat partitions for high recall.
      // Why not default probes=1: dedup missing a duplicate is a real problem.
      // Speed matters less here than recall — this is a background job.
      await db.query(`SET LOCAL ivfflat.probes = 10`)

      const neighbors = await db.query(`
        SELECT id,
               1 - (embedding <=> $1::vector) AS similarity
        FROM contacts
        WHERE user_id = $2
          AND id != $3
          AND id < $3
          AND merged_into_id IS NULL
          AND embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT 5
      `, [contact.embedding, user_id, contact.id])
      // Why id < $3: enforces pair ordering (a_id < b_id) so each pair is only
      // considered once. Without this, (A,B) and (B,A) would both be inserted,
      // violating the uq_dedup_pair unique constraint.

      for (const neighbor of neighbors.rows) {
        if (neighbor.similarity > SIMILARITY_THRESHOLD) {
          vectorPairs.push({
            a_id: contact.id,
            b_id: neighbor.id,
            similarity: neighbor.similarity,
          })
        }
      }

      await db.query(
        `UPDATE contacts SET last_dedup_checked_at = now() WHERE id = $1`,
        [contact.id]
      )
    }

    // Bulk insert candidates — ON CONFLICT DO NOTHING handles re-runs safely.
    // Why uq_dedup_pair constraint: the cron runs nightly and encounters the
    // same pairs across runs. Without this, re-runs insert duplicates silently.
    const allPairs = [...emailDupes.rows, ...vectorPairs]
    for (const pair of allPairs) {
      await db.query(`
        INSERT INTO dedup_candidates (user_id, contact_a_id, contact_b_id, similarity)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT ON CONSTRAINT uq_dedup_pair DO NOTHING
      `, [user_id, pair.a_id, pair.b_id, pair.similarity])
    }

    totalPairsFound += allPairs.length
    console.log(`Dedup cron user ${user_id}: ${unchecked.rows.length} checked, ${allPairs.length} pairs found`)
  }

  return Response.json({ ok: true, totalPairsFound })
}
