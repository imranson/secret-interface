import { getScheduledStore, isValidScheduleId } from '@/lib/schedule-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status })
}

/** Marks every schedule that ran into `conversationId` as read (the user opened that conversation). */
export async function POST(request: Request) {
  let body: { conversationId?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }
  if (!isValidScheduleId(body.conversationId)) return jsonError('Invalid conversation id', 400)

  const store = getScheduledStore()
  let marked = 0
  for (const schedule of await store.list()) {
    if (schedule.unread && schedule.lastConversationId === body.conversationId) {
      schedule.unread = false
      schedule.updated_at = new Date().toISOString()
      await store.save(schedule)
      marked++
    }
  }
  return Response.json({ marked })
}
