import { randomUUID } from 'node:crypto'
import { afterEach } from 'vitest'
import { SESSION_COOKIE } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getUserStore, hashPassword, type User } from '@/lib/users'

export const TEST_PASSWORD = 'correct horse battery'

// Hashed once per file: scrypt is slow on purpose.
let hash: Promise<string> | undefined
let current: string | null = null

afterEach(() => {
  current = null
})

export interface TestSession {
  user: User
  /** A Cookie header value carrying the session. */
  cookie: string
}

/**
 * Creates an account (password TEST_PASSWORD) in this test's database and signs it in. appFetch sends the most recent
 * session's cookie until the test ends.
 */
export async function signIn(username = 'ada'): Promise<TestSession> {
  const [row] = await getDb().query<{ id: string; username: string; created_at: Date | string }>(
    'INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3) RETURNING id, username, created_at',
    [randomUUID().replace(/-/g, ''), username, await (hash ??= hashPassword(TEST_PASSWORD))],
  )
  const user = { id: row.id, username: row.username, created_at: new Date(row.created_at).toISOString() }
  current = `${SESSION_COOKIE}=${await getUserStore().createSession(user.id)}`
  return { user, cookie: current }
}

/** The cookie of the session signIn started last in this test, if any. */
export function testSessionCookie(): string | null {
  return current
}
