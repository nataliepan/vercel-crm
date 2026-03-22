import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Pool } from '@neondatabase/serverless'

const db = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED })

async function run() {
  console.log('Clearing all data...')
  await db.query('DELETE FROM dedup_candidates')
  await db.query('DELETE FROM dedup_jobs')
  await db.query('DELETE FROM contact_events')
  await db.query('DELETE FROM contacts')
  await db.query('DELETE FROM events')
  await db.query('DELETE FROM segments')
  console.log('✓ All data cleared — schema and indexes preserved')
  await db.end()
}

run().catch(console.error)
