import { nextRunAtFromRule } from '@/lib/schedule'
import { getScheduledStore, isValidScheduleId } from '@/lib/schedule-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Context {
  params: Promise<{ id: string }>
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status })
}

/** Updates `enabled` (pause/resume) or `unread` (mark a run as read). */
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params
  if (!isValidScheduleId(id)) return jsonError('Invalid schedule id', 400)
  const store = getScheduledStore()
  const schedule = await store.get(id)
  if (!schedule) return jsonError('Schedule not found', 404)

  let body: { enabled?: unknown; unread?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return jsonError('"enabled" must be a boolean', 400)
    schedule.enabled = body.enabled
    // Resuming a recurring schedule that had no next run picks up from now, not from when it paused.
    if (body.enabled && schedule.rule.kind !== 'once' && schedule.nextRunAt === null) {
      schedule.nextRunAt = nextRunAtFromRule(schedule.rule, new Date())
    }
  }
  if (body.unread !== undefined) {
    if (typeof body.unread !== 'boolean') return jsonError('"unread" must be a boolean', 400)
    schedule.unread = body.unread
  }
  schedule.updated_at = new Date().toISOString()
  await store.save(schedule)
  return Response.json({ schedule })
}

export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params
  if (!isValidScheduleId(id)) return jsonError('Invalid schedule id', 400)
  const deleted = await getScheduledStore().delete(id)
  if (!deleted) return jsonError('Schedule not found', 404)
  return Response.json({ ok: true })
}
