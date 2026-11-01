import { parseRule } from '@/lib/schedule'
import { getScheduledStore } from '@/lib/schedule-store'
import { isValidConversationId } from '@/lib/store'
import { THINK_OPTIONS, type CreateScheduleInput } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status })
}

export async function GET() {
  return Response.json({ schedules: await getScheduledStore().list() })
}

export async function POST(request: Request) {
  let body: Partial<CreateScheduleInput>
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return jsonError('Message is required', 400)
  if (body.think !== undefined && !THINK_OPTIONS.includes(body.think)) return jsonError('Invalid think option', 400)

  let rule
  try {
    rule = parseRule(body.rule)
  } catch (error) {
    return jsonError((error as Error).message, 400)
  }

  if (rule.kind === 'once' && body.conversationId != null && !isValidConversationId(body.conversationId)) {
    return jsonError('Invalid conversation id', 400)
  }

  const schedule = getScheduledStore().create({
    message,
    rule,
    model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined,
    think: body.think,
    timezone: typeof body.timezone === 'string' && body.timezone.length < 64 ? body.timezone : undefined,
    conversationId: rule.kind === 'once' && typeof body.conversationId === 'string' ? body.conversationId : null,
  })
  await getScheduledStore().save(schedule)
  return Response.json({ schedule }, { status: 201 })
}
