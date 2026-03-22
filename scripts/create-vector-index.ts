// Run this after the first CSV import, once contacts have embeddings.
// ivfflat requires rows to exist before the index can be built.
//
// Why lists=200: pgvector recommends rows/1000 for recall-optimized queries.
// Correct for 200k rows. At today's 24k it's slightly over-partitioned but harmless.
// Rebuild with REINDEX INDEX CONCURRENTLY when row count grows 5x.

import { Pool } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const db = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED })

async function createVectorIndex() {
  console.log('Creating ivfflat vector index (this may take a minute)...')

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_contacts_embedding
      ON contacts USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 200)
  `)

  console.log('✅ Vector index created')
  await db.end()
}

createVectorIndex().catch(err => {
  console.error('Failed:', err)
  process.exit(1)
})
