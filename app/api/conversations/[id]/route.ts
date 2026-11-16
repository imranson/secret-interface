import { requestUser, unauthorized } from '@/lib/auth'
import { getStore, isValidConversationId } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Context {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: Context) {
  const user = await requestUser(request)
  if (!user) return unauthorized()
  const { id } = await params
  if (!isValidConversationId(id)) return Response.json({ error: 'Invalid conversation id' }, { status: 400 })
  const conversation = await getStore(user.id).get(id)
  if (!conversation) return Response.json({ error: 'Conversation not found' }, { status: 404 })
  return Response.json({ conversation })
}

/** `{ "archived": true }` archives the conversation; `false` restores it. */
export async function PATCH(request: Request, { params }: Context) {
  const user = await requestUser(request)
  if (!user) return unauthorized()
  const { id } = await params
  if (!isValidConversationId(id)) return Response.json({ error: 'Invalid conversation id' }, { status: 400 })
  let body: { archived?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof body.archived !== 'boolean') {
    return Response.json({ error: '"archived" must be a boolean' }, { status: 400 })
  }
  const conversation = await getStore(user.id).setArchived(id, body.archived)
  if (!conversation) return Response.json({ error: 'Conversation not found' }, { status: 404 })
  return Response.json({ conversation })
}
