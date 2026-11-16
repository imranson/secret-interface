import { sessionCookie } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { passwordProblem, usernameProblem } from '@/lib/credentials'
import { claimUnowned, getDb } from '@/lib/db'
import { getUserStore } from '@/lib/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** `{ username, password, code? }` creates an account and signs it in. `code` is needed when REGISTRATION_CODE is set. */
export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown; code?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const problem = usernameProblem(username) ?? passwordProblem(password)
  if (problem) return Response.json({ error: problem }, { status: 400 })
  const { registrationCode } = getConfig()
  if (registrationCode && body.code !== registrationCode) {
    return Response.json({ error: 'That invite code is not right.' }, { status: 403 })
  }

  const users = getUserStore()
  const user = await users.create(username, password)
  if (!user) return Response.json({ error: 'That username is taken.' }, { status: 409 })
  // Conversations and schedules from before accounts existed belong to whoever set the app up.
  if ((await users.count()) === 1) await claimUnowned(getDb(), user.id)

  const token = await users.createSession(user.id)
  return Response.json(
    { user: { username: user.username } },
    { status: 201, headers: { 'Set-Cookie': sessionCookie(request, token) } },
  )
}
