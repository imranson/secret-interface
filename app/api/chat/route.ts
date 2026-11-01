import { runChatTurn } from '@/lib/chat'
import { getConfig, isCloudHost } from '@/lib/config'
import { encodeNdjson } from '@/lib/ndjson'
import { getStore, isValidConversationId } from '@/lib/store'
import { THINK_OPTIONS, type ChatRequestBody, type Conversation, type StreamEvent } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status })
}

export async function POST(request: Request) {
  let body: Partial<ChatRequestBody>
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const text = typeof body.message === 'string' ? body.message.trim() : ''
  if (!text) return jsonError('Message is required', 400)
  if (body.think !== undefined && !THINK_OPTIONS.includes(body.think)) return jsonError('Invalid think option', 400)
  if (body.editIndex !== undefined && (!Number.isInteger(body.editIndex) || body.editIndex < 0)) {
    return jsonError('Invalid edit index', 400)
  }

  const config = getConfig()
  if (isCloudHost(config.host) && !config.apiKey) {
    return jsonError('OLLAMA_API_KEY is not set. Add it to .env.local and restart the server.', 500)
  }

  const store = getStore()
  let conversation: Conversation | undefined
  if (body.conversationId) {
    if (!isValidConversationId(body.conversationId)) return jsonError('Invalid conversation id', 400)
    const existing = await store.get(body.conversationId)
    if (!existing) return jsonError('Conversation not found', 404)
    if (existing.archived) return jsonError('Conversation is archived; restore it to continue', 409)
    // Editing replaces the edited message and everything after it with this new message.
    if (body.editIndex !== undefined) {
      if (body.editIndex > existing.messages.length) return jsonError('Edit index out of range', 400)
      existing.messages = existing.messages.slice(0, body.editIndex)
    }
    conversation = existing
  } else if (body.editIndex !== undefined) {
    return jsonError('Edit index requires a conversation', 400)
  }

  const timeZone = typeof body.timezone === 'string' && body.timezone.length < 64 ? body.timezone : undefined
  const abort = new AbortController()
  const onRequestAbort = () => abort.abort()
  request.signal?.addEventListener('abort', onRequestAbort)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true
      const send = (event: StreamEvent) => {
        if (!open) return
        try {
          controller.enqueue(encodeNdjson(event))
        } catch {
          open = false
        }
      }

      try {
        for await (const event of runChatTurn({
          message: text,
          conversation,
          think: body.think,
          model: body.model,
          timezone: timeZone,
          signal: abort.signal,
        })) {
          send(event)
        }
      } finally {
        request.signal?.removeEventListener('abort', onRequestAbort)
        if (open) {
          try {
            controller.close()
          } catch {
            // Stream already cancelled by the client.
          }
        }
      }
    },
    cancel() {
      abort.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
