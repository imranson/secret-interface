import { randomUUID } from 'node:crypto'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// Conversations live in PostgreSQL. Tests swap pg for PGlite, an in-process Postgres started once per test file, and
// give every test a fresh DATABASE_URL whose pool works in a schema of its own, so a save landing after its test has
// ended can't leak into the next test.
const pglite = vi.hoisted(() => {
  let db: Promise<import('@electric-sql/pglite').PGlite> | undefined
  return () => (db ??= import('@electric-sql/pglite').then(({ PGlite }) => new PGlite()))
})

vi.mock('pg', () => ({
  Pool: class {
    private readonly schema: string

    constructor({ connectionString }: { connectionString: string }) {
      this.schema = `test_${new URL(connectionString).pathname.slice(1)}`
    }

    async query(text: string, params?: unknown[]) {
      return (await pglite()).transaction(async (tx) => {
        await tx.exec(`CREATE SCHEMA IF NOT EXISTS ${this.schema}; SET LOCAL search_path TO ${this.schema}`)
        return tx.query(text, params)
      })
    }

    on() {
      return this
    }

    async end() {}
  },
}))

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', `postgres://test@localhost/${randomUUID().replace(/-/g, '')}`)
})

afterEach(() => {
  if (typeof document !== 'undefined') cleanup()
})
