import { clearedSessionCookie, readCookie, SESSION_COOKIE } from '@/lib/auth'
import { getUserStore } from '@/lib/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Ends this browser's session. */
export async function POST(request: Request) {
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE)
  if (token) await getUserStore().deleteSession(token)
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearedSessionCookie(request) } })
}
