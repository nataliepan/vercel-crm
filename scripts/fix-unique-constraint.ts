import { config } from 'dotenv'
config({ path: '.env.local' })

import { Pool } from '@neondatabase/serverless'

const db = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED })

async function run() {
  // Add unique index so ON CONFLICT (user_id, email) works in upserts
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email_unique
    ON contacts(user_id, email)
  `)
  console.log('✓ Unique constraint on (user_id, email) added')
  await db.end()
}

run().catch(console.error)
