import { isEmptyMessage, runAgent } from '@/lib/agent'
import { getConfig, isCloudHost, normalizeModelName } from '@/lib/config'
import { describeError } from '@/lib/errors'
import { encodeNdjson } from '@/lib/ndjson'
import { getOllamaClient } from '@/lib/ollama'
import { getStore, isValidConversationId, summarize } from '@/lib/store'
import { deriveTitle } from '@/lib/title'
import { THINK_OPTIONS, type ChatMessage, type ChatRequestBody, type Conversation, type StreamEvent } from '@/lib/types'

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

  const config = getConfig()
  if (isCloudHost(config.host) && !config.apiKey) {
    return jsonError('OLLAMA_API_KEY is not set. Add it to .env.local and restart the server.', 500)
  }

  const store = getStore()
  let conversation: Conversation
  if (body.conversationId) {
    if (!isValidConversationId(body.conversationId)) return jsonError('Invalid conversation id', 400)
    const existing = await store.get(body.conversationId)
    if (!existing) return jsonError('Conversation not found', 404)
    if (existing.archived) return jsonError('Conversation is archived; restore it to continue', 409)
    conversation = existing
  } else {
    conversation = store.create({ title: deriveTitle(text) })
  }

  const model = normalizeModelName(body.model?.trim() || conversation.model || config.defaultModel, config.host)
  const now = new Date().toISOString()
  conversation.messages.push({ role: 'user', content: text, created_at: now })
  conversation.model = model
  conversation.updated_at = now
  // Persist the user's message before calling the model so it survives failures.
  await store.save(conversation)

  const history = [...conversation.messages]
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

      send({ type: 'start', conversation: summarize(conversation), model })
      const produced: ChatMessage[] = []
      try {
        for await (const event of runAgent({
          client: getOllamaClient(),
          model,
          history,
          systemPrompt: config.systemPrompt,
          think: body.think,
          timeZone,
          signal: abort.signal,
          output: produced,
        })) {
          send(event)
        }
      } catch (error) {
        send({ type: 'error', message: describeError(error) })
      } finally {
        request.signal?.removeEventListener('abort', onRequestAbort)
        conversation.messages.push(...produced.filter((m) => !isEmptyMessage(m)))
        conversation.updated_at = new Date().toISOString()
        try {
          await store.save(conversation)
        } catch (error) {
          send({ type: 'error', message: `Could not save the conversation: ${describeError(error)}` })
        }
        send({ type: 'done', conversation: summarize(conversation), aborted: abort.signal.aborted })
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
