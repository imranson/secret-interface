import { sessionCookie } from '@/lib/auth'
import { getUserStore } from '@/lib/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** `{ username, password }` signs in. */
export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!username || !password) return Response.json({ error: 'Enter your username and password.' }, { status: 400 })

  const users = getUserStore()
  const user = await users.verify(username, password)
  if (!user) return Response.json({ error: 'Wrong username or password.' }, { status: 401 })
  const token = await users.createSession(user.id)
  return Response.json({ user: { username: user.username } }, { headers: { 'Set-Cookie': sessionCookie(request, token) } })
}
