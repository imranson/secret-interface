import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { getDb, type Database } from './db'

export interface User {
  id: string
  username: string
  created_at: string
}

export const SESSION_DAYS = 30
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000

const SCRYPT: ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const KEY_LENGTH = 64

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT, (error, key) => (error ? reject(error) : resolve(key))),
  )
}

/** `scrypt$<salt>$<key>`, both base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('base64')}$${(await derive(password, salt)).toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !key) return false
  const expected = Buffer.from(key, 'base64')
  const actual = await derive(password, Buffer.from(salt, 'base64'))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// Checked against when the username is unknown, so a wrong name takes as long as a wrong password.
let decoy: Promise<string> | undefined

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

interface UserRow {
  id: string
  username: string
  created_at: Date | string
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  username: row.username,
  created_at: new Date(row.created_at).toISOString(),
})

/** Accounts and their sign-in sessions. Session tokens are only stored hashed. */
export class UserStore {
  constructor(private readonly db: Database) {}

  /** Creates an account; null if the username is taken (case-insensitively). */
  async create(username: string, password: string): Promise<User | null> {
    const rows = await this.db.query<UserRow>(
      `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING RETURNING id, username, created_at`,
      [randomUUID().replace(/-/g, ''), username, await hashPassword(password)],
    )
    return rows[0] ? toUser(rows[0]) : null
  }

  /** The account for these credentials, or null. The username is matched case-insensitively. */
  async verify(username: string, password: string): Promise<User | null> {
    const [row] = await this.db.query<UserRow & { password_hash: string }>(
      'SELECT id, username, created_at, password_hash FROM users WHERE lower(username) = lower($1)',
      [username],
    )
    if (!row) {
      await verifyPassword(password, await (decoy ??= hashPassword(randomUUID())))
      return null
    }
    return (await verifyPassword(password, row.password_hash)) ? toUser(row) : null
  }

  async count(): Promise<number> {
    const [row] = await this.db.query<{ count: number }>('SELECT count(*)::int AS count FROM users')
    return row.count
  }

  /** The first account registered, if any. */
  async first(): Promise<User | null> {
    const [row] = await this.db.query<UserRow>('SELECT id, username, created_at FROM users ORDER BY created_at LIMIT 1')
    return row ? toUser(row) : null
  }

  async findByUsername(username: string): Promise<User | null> {
    const [row] = await this.db.query<UserRow>(
      'SELECT id, username, created_at FROM users WHERE lower(username) = lower($1)',
      [username],
    )
    return row ? toUser(row) : null
  }

  /** Starts a session; returns its token, which goes in the session cookie. */
  async createSession(userId: string, now = new Date()): Promise<string> {
    const token = randomBytes(32).toString('base64url')
    // Expired sessions are swept here rather than on a timer.
    await this.db.query('DELETE FROM sessions WHERE expires_at <= $1', [now])
    await this.db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
      tokenHash(token),
      userId,
      new Date(now.getTime() + SESSION_MS),
    ])
    return token
  }

  /** The signed-in user for a session token, or null if the session is unknown or expired. */
  async userForSession(token: string): Promise<User | null> {
    const [row] = await this.db.query<UserRow>(
      `SELECT u.id, u.username, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash(token)],
    )
    return row ? toUser(row) : null
  }

  async deleteSession(token: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)])
  }
}

export function getUserStore(): UserStore {
  return new UserStore(getDb())
}
