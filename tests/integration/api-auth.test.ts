import { describe, expect, it, vi } from 'vitest'
import { POST as login } from '@/app/api/auth/login/route'
import { POST as logout } from '@/app/api/auth/logout/route'
import { POST as register } from '@/app/api/auth/register/route'
import { GET as conversations } from '@/app/api/conversations/route'
import { GET as health } from '@/app/api/health/route'
import { GET as schedules } from '@/app/api/schedules/route'
import { SESSION_COOKIE } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getScheduleStore } from '@/lib/schedule-store'
import { getStore } from '@/lib/store'
import { getUserStore } from '@/lib/users'
import { signIn, TEST_PASSWORD } from '../helpers/auth'

const post = (handler: (request: Request) => Promise<Response>, body: unknown, headers: Record<string, string> = {}) =>
  handler(
    new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

/** The `name=value` pair a Set-Cookie header sets, for sending back as a Cookie header. */
const cookieFrom = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]

const listAs = async (cookie: string) => conversations(new Request('http://localhost/api/conversations', { headers: { cookie } }))

describe('POST /api/auth/register', () => {
  it('creates an account and signs it in with a session cookie', async () => {
    const response = await post(register, { username: ' Ada ', password: 'long enough' })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ user: { username: 'Ada' } })
    const setCookie = response.headers.get('set-cookie')!
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[\\w-]{43}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax$`))
    expect((await listAs(cookieFrom(response))).status).toBe(200)
  })

  it('marks the cookie Secure behind an HTTPS proxy', async () => {
    const response = await post(register, { username: 'ada', password: 'long enough' }, { 'X-Forwarded-Proto': 'https' })
    expect(response.headers.get('set-cookie')).toMatch(/; Secure$/)
  })

  it('stores only a hash of the password', async () => {
    await post(register, { username: 'ada', password: 'long enough' })
    const [row] = await getDb().query<{ password_hash: string }>('SELECT password_hash FROM users')
    expect(row.password_hash).toMatch(/^scrypt\$/)
    expect(row.password_hash).not.toContain('long enough')
  })

  it('refuses a taken username, whatever its case', async () => {
    await post(register, { username: 'ada', password: 'long enough' })
    const response = await post(register, { username: 'ADA', password: 'another one' })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'That username is taken.' })
  })

  it.each([
    [{ username: 'ab', password: 'long enough' }, /Usernames are 3–32 characters/],
    [{ username: 'has space', password: 'long enough' }, /Usernames are 3–32 characters/],
    [{ username: 'ada', password: 'short' }, /at least 8 characters/],
    [{ username: 'ada' }, /at least 8 characters/],
  ])('rejects %j', async (body, error) => {
    const response = await post(register, body)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(error)
  })

  it('rejects a body that is not JSON', async () => {
    expect((await post(register, '{')).status).toBe(400)
  })

  it('needs the invite code when REGISTRATION_CODE is set', async () => {
    vi.stubEnv('REGISTRATION_CODE', 'friends')
    expect((await post(register, { username: 'ada', password: 'long enough' })).status).toBe(403)
    expect((await post(register, { username: 'ada', password: 'long enough', code: 'Friends' })).status).toBe(403)
    expect((await post(register, { username: 'ada', password: 'long enough', code: 'friends' })).status).toBe(201)
  })

  it('gives conversations and schedules from before accounts to the first account only', async () => {
    const db = getDb()
    await db.query(`INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('old', 'From v2', now(), now())`)
    await db.query(
      `INSERT INTO schedules (id, data, created_at)
      VALUES ('oldschedule', '{"prompt": "News", "rule": {"kind": "daily", "time": "09:00", "timezone": "UTC"}}', now())`,
    )
    const first = await post(register, { username: 'ada', password: 'long enough' })
    await db.query(`INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('later', 'Stray', now(), now())`)
    const second = await post(register, { username: 'bob', password: 'long enough' })

    expect((await (await listAs(cookieFrom(first))).json()).conversations.map((c: { id: string }) => c.id)).toEqual(['old'])
    const adaSchedules = await schedules(new Request('http://localhost', { headers: { cookie: cookieFrom(first) } }))
    expect((await adaSchedules.json()).schedules.map((s: { id: string }) => s.id)).toEqual(['oldschedule'])
    expect((await (await listAs(cookieFrom(second))).json()).conversations).toEqual([])
  })
})

describe('POST /api/auth/login', () => {
  it('signs in with the right password, matching the username in any case', async () => {
    await signIn('Ada')
    const response = await post(login, { username: 'ada', password: TEST_PASSWORD })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ user: { username: 'Ada' } })
    expect((await listAs(cookieFrom(response))).status).toBe(200)
  })

  it('gives the same answer for a wrong password and an unknown user', async () => {
    await signIn('ada')
    for (const body of [
      { username: 'ada', password: 'wrong password' },
      { username: 'nobody', password: TEST_PASSWORD },
    ]) {
      const response = await post(login, body)
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'Wrong username or password.' })
      expect(response.headers.get('set-cookie')).toBeNull()
    }
  })

  it('asks for both fields', async () => {
    expect((await post(login, { username: 'ada' })).status).toBe(400)
    expect((await post(login, '{')).status).toBe(400)
  })
})

describe('POST /api/auth/logout', () => {
  it('ends the session and clears the cookie', async () => {
    const { cookie } = await signIn()
    const response = await post(logout, {}, { cookie })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toMatch(new RegExp(`^${SESSION_COOKIE}=; Path=/; Max-Age=0;`))
    expect((await listAs(cookie)).status).toBe(401)
  })

  it('is fine without a session', async () => {
    expect((await post(logout, {})).status).toBe(200)
  })
})

describe('sessions', () => {
  it('stop working once they expire', async () => {
    const { user } = await signIn()
    const token = await getUserStore().createSession(user.id, new Date('2020-01-01T00:00:00Z'))
    expect((await listAs(`${SESSION_COOKIE}=${token}`)).status).toBe(401)
  })

  it('end with the account', async () => {
    const { user, cookie } = await signIn()
    const conversation = getStore(user.id).create({ title: 'Mine' })
    await getStore(user.id).save(conversation)
    const rule = { kind: 'daily', time: '09:00', timezone: 'UTC' } as const
    const schedule = getScheduleStore().create({ userId: user.id, prompt: 'News', rule })
    await getScheduleStore().save(schedule)

    await getDb().query('DELETE FROM users WHERE id = $1', [user.id])
    expect((await listAs(cookie)).status).toBe(401)
    expect(await getDb().query('SELECT id FROM conversations')).toEqual([])
    expect(await getScheduleStore().list()).toEqual([])
  })
})

describe('GET /api/health', () => {
  it('answers without signing in once the database is reachable', async () => {
    const response = await health()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })
})
