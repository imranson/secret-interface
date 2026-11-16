import { requestUser, unauthorized } from '@/lib/auth'
import { catchUpSchedules } from '@/lib/scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Sent by the browser when the app opens: starts every schedule that isn't up to date. The runs continue after this response. */
export async function POST(request: Request) {
  const user = await requestUser(request)
  if (!user) return unauthorized()
  return Response.json({ started: await catchUpSchedules(user.id) })
}
