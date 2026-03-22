import { Pool } from '@neondatabase/serverless'

// Why two pools:
// - db (pooled): uses PgBouncer — shared connections across serverless function instances.
//   Use this for all API routes (short-lived, concurrent requests).
// - dbDirect (unpooled): direct TCP connection to Neon.
//   Use this for background jobs (dedup, embed) and migrations.
//   PgBouncer can't handle long-running transactions or multi-statement flows correctly.

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  // Why max=5: Vercel can spin up many concurrent function instances simultaneously.
  // Each holds up to 5 connections. At Neon Pro's 100-connection limit, this allows
  // 20 concurrent function instances with headroom. Without this cap, a traffic spike
  // exhausts the pool and all queries start timing out.
})

export const dbDirect = new Pool({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
  max: 2,
  // Why max=2: direct connections are only used by background jobs (dedup, embed, cron).
  // These run sequentially, never concurrently. Low ceiling prevents accidents.
})
