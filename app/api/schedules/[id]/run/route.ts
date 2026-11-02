import { getScheduleStore, isValidScheduleId, toScheduleView } from '@/lib/schedule-store'
import { startRun } from '@/lib/scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Context {
  params: Promise<{ id: string }>
}

/** Runs a schedule now, without moving its next scheduled run. The run continues after this response. */
export async function POST(_request: Request, { params }: Context) {
  const { id } = await params
  if (!isValidScheduleId(id)) return Response.json({ error: 'Invalid schedule id' }, { status: 400 })
  const schedule = await getScheduleStore().get(id)
  if (!schedule) return Response.json({ error: 'Schedule not found' }, { status: 404 })
  if (!startRun(schedule)) {
    return Response.json({ error: 'Already running, or a reply is in progress in its conversation.' }, { status: 409 })
  }
  return Response.json({ schedule: toScheduleView(schedule) }, { status: 202 })
}
