import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it, vi } from 'vitest'
import { claimUnowned, Database, getDb, type Queryable } from '@/lib/db'
import { makeTempDataDir } from '../helpers/temp-data'

describe('Database', () => {
  it('creates the tables before the first query, once', async () => {
    const pglite = new PGlite()
    const query = vi.spyOn(pglite, 'query')
    const db = new Database(pglite)
    await db.query('SELECT 1')
    const setup = query.mock.calls.length
    await db.query('SELECT 1')
    expect(query.mock.calls.length).toBe(setup + 1)
    const tables = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    )
    expect(tables.map((t) => t.table_name)).toEqual(['conversations', 'schedules', 'sessions', 'users'])
    await pglite.close()
  })

  it('upgrades a conversations table from before accounts', async () => {
    const pglite = new PGlite()
    await pglite.exec(`CREATE TABLE conversations (
      id text PRIMARY KEY, title text NOT NULL, model text, archived boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, message_count integer NOT NULL DEFAULT 0,
      messages jsonb NOT NULL DEFAULT '[]'::jsonb
    );
    INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('old', 'Old', now(), now())`)
    const db = new Database(pglite)
    await db.query(`INSERT INTO users (id, username, password_hash) VALUES ('ada', 'ada', 'x')`)
    expect(await db.query('SELECT user_id FROM conversations')).toEqual([{ user_id: null }])

    await claimUnowned(db, 'ada')
    expect(await db.query('SELECT user_id FROM conversations')).toEqual([{ user_id: 'ada' }])
    await pglite.close()
  })

  it('retries setting up the tables after a failure', async () => {
    const pglite = new PGlite()
    let fail = true
    const flaky: Queryable = {
      query: (text, params) => {
        if (fail) {
          fail = false
          return Promise.reject(new Error('connection refused'))
        }
        return pglite.query(text, params)
      },
    }
    const db = new Database(flaky)
    await expect(db.query('SELECT 1')).rejects.toThrow('connection refused')
    expect(await db.query<{ n: number }>('SELECT 1 AS n')).toEqual([{ n: 1 }])
    await pglite.close()
  })
})

describe('getDb', () => {
  it('uses DATABASE_URL, one database per connection string', () => {
    const first = getDb()
    expect(getDb()).toBe(first)
    vi.stubEnv('DATABASE_URL', 'postgres://user:pass@127.0.0.1:1/other')
    expect(getDb()).not.toBe(first)
  })

  it('keeps data in an embedded database under DATA_DIR when there is no DATABASE_URL', async () => {
    const { dir, cleanup } = await makeTempDataDir()
    vi.stubEnv('DATABASE_URL', '')
    vi.stubEnv('DATA_DIR', dir)
    const db = getDb()
    expect(getDb()).toBe(db)
    await db.query(`INSERT INTO users (id, username, password_hash) VALUES ('ada', 'ada', 'x')`)
    await db.close()

    const reopened = new PGlite(`${dir}/db`)
    expect((await reopened.query('SELECT username FROM users')).rows).toEqual([{ username: 'ada' }])
    await reopened.close()
    await cleanup()
  }, 30_000)
})
