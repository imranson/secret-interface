import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { Pool } from 'pg'
import { getConfig } from './config'

/** What the stores need from a database client: pg's Pool for DATABASE_URL, PGlite otherwise and in tests. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>
}

interface Closable extends Queryable {
  close(): Promise<void>
}

// Messages are always read and written as a whole (edits and scheduled reports replace them), so they live in one
// jsonb column. message_count is kept beside them so listing never has to read the messages. Rows from before
// accounts existed have no user_id; the first account to register claims them (see claimUnowned).
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id            text PRIMARY KEY,
    username      text NOT NULL,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (lower(username))',
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)',
  `CREATE TABLE IF NOT EXISTS conversations (
    id            text PRIMARY KEY,
    title         text NOT NULL,
    model         text,
    archived      boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL,
    updated_at    timestamptz NOT NULL,
    message_count integer NOT NULL DEFAULT 0,
    messages      jsonb NOT NULL DEFAULT '[]'::jsonb
  )`,
  'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id text REFERENCES users (id) ON DELETE CASCADE',
  'DROP INDEX IF EXISTS conversations_list_idx',
  'CREATE INDEX IF NOT EXISTS conversations_user_list_idx ON conversations (user_id, archived, updated_at DESC)',
  `CREATE TABLE IF NOT EXISTS schedules (
    id         text PRIMARY KEY,
    user_id    text REFERENCES users (id) ON DELETE CASCADE,
    data       jsonb NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS schedules_user_idx ON schedules (user_id)',
]

/** A database client that creates the app's tables before its first query. */
export class Database {
  private ready: Promise<void> | null = null

  constructor(private readonly client: Queryable | Closable) {}

  async query<R>(text: string, params?: unknown[]): Promise<R[]> {
    // A failed setup is retried on the next query rather than remembered.
    this.ready ??= this.migrate().catch((error) => {
      this.ready = null
      throw error
    })
    await this.ready
    return (await this.client.query(text, params)).rows as R[]
  }

  private async migrate(): Promise<void> {
    for (const statement of SCHEMA) await this.client.query(statement)
  }

  /** For scripts: lets the process exit (pg) and flushes the embedded database to disk (PGlite). */
  async close(): Promise<void> {
    if ('close' in this.client) await this.client.close()
  }
}

/** Hands rows saved before accounts existed to `userId`. Called when the first account registers. */
export async function claimUnowned(db: Database, userId: string): Promise<void> {
  await db.query('UPDATE conversations SET user_id = $1 WHERE user_id IS NULL', [userId])
  await db.query('UPDATE schedules SET user_id = $1 WHERE user_id IS NULL', [userId])
}

/** PostgreSQL in-process (PGlite), kept in `dir`. Loaded on first use so a DATABASE_URL deployment never pays for it. */
function embedded(dir: string): Closable {
  let db: Promise<import('@electric-sql/pglite').PGlite> | null = null
  const open = async () => {
    await mkdir(dir, { recursive: true })
    const { PGlite } = await import('@electric-sql/pglite')
    const pglite = new PGlite(dir)
    await pglite.waitReady
    return pglite
  }
  return {
    async query(text, params) {
      db ??= open().catch((error) => {
        db = null
        throw error
      })
      return (await db).query(text, params)
    },
    async close() {
      await (await db)?.close()
    },
  }
}

const DATABASES = Symbol.for('secret-interface.databases')

/**
 * The database: PostgreSQL at DATABASE_URL when it is set, otherwise an embedded one under DATA_DIR. One per process
 * for each location: route handlers and the scheduler are bundled separately and each get their own copy of this
 * module, so the cache lives on globalThis (two PGlite instances on one folder would corrupt it).
 */
export function getDb(): Database {
  const config = getConfig()
  const key = config.databaseUrl ?? `pglite:${path.join(config.dataDir, 'db')}`
  const shared = globalThis as { [DATABASES]?: Map<string, Database> }
  const databases = (shared[DATABASES] ??= new Map())
  let db = databases.get(key)
  if (!db) {
    if (config.databaseUrl) {
      const pool = new Pool({ connectionString: config.databaseUrl })
      // An idle connection dropping (e.g. the database restarting) must not crash the server.
      pool.on('error', (error) => console.error('Postgres pool error:', error.message))
      db = new Database({ query: (text, params) => pool.query(text, params), close: () => pool.end() })
    } else {
      db = new Database(embedded(path.join(config.dataDir, 'db')))
    }
    databases.set(key, db)
  }
  return db
}
