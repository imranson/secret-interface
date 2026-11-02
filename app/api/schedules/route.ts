import { parseRule } from '@/lib/schedule'
import { getScheduleStore, toScheduleView } from '@/lib/schedule-store'
import { THINK_OPTIONS, type CreateScheduleBody, type ScheduleRule } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const schedules = await getScheduleStore().list()
  return Response.json({ schedules: schedules.map(toScheduleView) })
}

export async function POST(request: Request) {
  let body: Partial<CreateScheduleBody>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) return Response.json({ error: 'Prompt is required' }, { status: 400 })
  if (body.think !== undefined && !THINK_OPTIONS.includes(body.think)) {
    return Response.json({ error: 'Invalid think option' }, { status: 400 })
  }
  let rule: ScheduleRule
  try {
    rule = parseRule(body.rule)
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 })
  }
  const store = getScheduleStore()
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined
  const schedule = store.create({ prompt, rule, model, think: body.think })
  await store.save(schedule)
  return Response.json({ schedule: toScheduleView(schedule) }, { status: 201 })
}
