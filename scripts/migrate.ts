import { Pool } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const db = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED })

async function migrate() {
  console.log('Running migration...')

  await db.query(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  `)
  console.log('✓ Extensions enabled')

  await db.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id               TEXT NOT NULL,
      email                 TEXT NOT NULL,
      name                  TEXT,
      company               TEXT,
      role                  TEXT,
      linkedin_url          TEXT,
      notes                 TEXT,
      raw_fields            JSONB,
      embedding             vector(1536),
      embedding_status      TEXT DEFAULT 'pending' CHECK (embedding_status IN ('pending', 'done', 'failed')),
      merged_into_id        UUID REFERENCES contacts(id),
      last_dedup_checked_at TIMESTAMPTZ,
      created_at            TIMESTAMPTZ DEFAULT now(),
      updated_at            TIMESTAMPTZ DEFAULT now()
    )
  `)
  console.log('✓ contacts table')

  await db.query(`
    CREATE TABLE IF NOT EXISTS events (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         TEXT NOT NULL,
      name            TEXT NOT NULL,
      event_date      DATE,
      source_filename TEXT,
      tags            TEXT[],
      attendee_count  INTEGER,
      created_at      TIMESTAMPTZ DEFAULT now()
    )
  `)
  console.log('✓ events table')

  await db.query(`
    CREATE TABLE IF NOT EXISTS contact_events (
      contact_id    UUID REFERENCES contacts(id) ON DELETE CASCADE,
      event_id      UUID REFERENCES events(id) ON DELETE CASCADE,
      PRIMARY KEY (contact_id, event_id),
      registered_at TIMESTAMPTZ,
      attended      BOOLEAN DEFAULT false
    )
  `)
  console.log('✓ contact_events table')

  await db.query(`
    CREATE TABLE IF NOT EXISTS segments (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       TEXT NOT NULL,
      label         TEXT NOT NULL,
      description   TEXT,
      filter_sql    TEXT,
      contact_count INTEGER,
      created_at    TIMESTAMPTZ DEFAULT now(),
      updated_at    TIMESTAMPTZ DEFAULT now()
    )
  `)
  console.log('✓ segments table')

  await db.query(`
    CREATE TABLE IF NOT EXISTS dedup_jobs (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id            TEXT NOT NULL,
      status             TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
      contacts_total     INTEGER,
      contacts_processed INTEGER DEFAULT 0,
      pairs_found        INTEGER DEFAULT 0,
      started_at         TIMESTAMPTZ,
      completed_at       TIMESTAMPTZ,
      error_message      TEXT,
      created_at         TIMESTAMPTZ DEFAULT now()
    )
  `)
  console.log('✓ dedup_jobs table')

  await db.query(`
    CREATE TABLE IF NOT EXISTS dedup_candidates (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      TEXT NOT NULL,
      contact_a_id UUID REFERENCES contacts(id),
      contact_b_id UUID REFERENCES contacts(id),
      similarity   FLOAT,
      status       TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'merged', 'rejected')),
      created_at   TIMESTAMPTZ DEFAULT now(),
      CONSTRAINT uq_dedup_pair UNIQUE (contact_a_id, contact_b_id)
    )
  `)
  console.log('✓ dedup_candidates table')

  // Indexes
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_contacts_user_id
      ON contacts(user_id);

    -- Why UNIQUE: required for ON CONFLICT (user_id, email) upserts on import.
    -- A plain index doesn't satisfy the ON CONFLICT constraint requirement.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email
      ON contacts(user_id, email);

    CREATE INDEX IF NOT EXISTS idx_contacts_trgm_email
      ON contacts USING gin(email gin_trgm_ops);

    CREATE INDEX IF NOT EXISTS idx_contacts_trgm_name
      ON contacts USING gin(name gin_trgm_ops);

    CREATE INDEX IF NOT EXISTS idx_contacts_pending_embed
      ON contacts(user_id, embedding_status)
      WHERE embedding_status = 'pending';

    CREATE INDEX IF NOT EXISTS idx_contacts_dedup_unchecked
      ON contacts(user_id, created_at)
      WHERE last_dedup_checked_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_dedup_candidates_user
      ON dedup_candidates(user_id, status);
  `)
  console.log('✓ Indexes (excluding ivfflat — requires data first)')

  // Why ivfflat is separate: the index requires at least 1 row to build.
  // We create it after the first import. See scripts/create-vector-index.ts.
  console.log('ℹ  Vector index (ivfflat) skipped — run scripts/create-vector-index.ts after first import')

  console.log('\n✅ Migration complete')
  await db.end()
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
