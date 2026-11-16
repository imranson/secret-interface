import { requestUser, unauthorized } from '@/lib/auth'
import { cancelRun } from '@/lib/run-state'
import { nextRunAt } from '@/lib/schedule'
import { getScheduleStore, isValidScheduleId, toScheduleView } from '@/lib/schedule-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Context {
  params: Promise<{ id: string }>
}

/** `{ "enabled": false }` pauses and `true` resumes; `{ "unread": false }` marks the latest report as read. */
export async function PATCH(request: Request, { params }: Context) {
  const user = await requestUser(request)
  if (!user) return unauthorized()
  const { id } = await params
  if (!isValidScheduleId(id)) return Response.json({ error: 'Invalid schedule id' }, { status: 400 })
  let body: { enabled?: unknown; unread?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { enabled, unread } = body
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    return Response.json({ error: '"enabled" must be a boolean' }, { status: 400 })
  }
  if (unread !== undefined && typeof unread !== 'boolean') {
    return Response.json({ error: '"unread" must be a boolean' }, { status: 400 })
  }
  const schedule = await getScheduleStore().update(
    id,
    (s) => {
      if (enabled !== undefined) {
        // Resuming starts from now, so runs that passed while paused aren't made up for.
        if (enabled && !s.enabled) s.nextRunAt = nextRunAt(s.rule, new Date())
        s.enabled = enabled
      }
      if (unread !== undefined) s.unread = unread
    },
    user.id,
  )
  if (!schedule) return Response.json({ error: 'Schedule not found' }, { status: 404 })
  return Response.json({ schedule: toScheduleView(schedule) })
}

/** Stops the schedule. Its conversation stays, as an ordinary conversation. */
export async function DELETE(request: Request, { params }: Context) {
  const user = await requestUser(request)
  if (!user) return unauthorized()
  const { id } = await params
  if (!isValidScheduleId(id)) return Response.json({ error: 'Invalid schedule id' }, { status: 400 })
  const store = getScheduleStore()
  if (!(await store.get(id, user.id))) return Response.json({ error: 'Schedule not found' }, { status: 404 })
  cancelRun(id)
  if (!(await store.delete(id, user.id))) return Response.json({ error: 'Schedule not found' }, { status: 404 })
  return Response.json({ ok: true })
}
