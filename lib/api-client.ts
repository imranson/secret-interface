import { parseNdjson } from './ndjson'
import type { ChatRequestBody, Conversation, ConversationSummary, StreamEvent } from './types'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = (await response.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      // Keep the generic message.
    }
    throw new ApiError(message, response.status)
  }
  return (await response.json()) as T
}

export async function listConversations(archived = false): Promise<ConversationSummary[]> {
  const res = await fetch(`/api/conversations${archived ? '?archived=1' : ''}`, { cache: 'no-store' })
  return (await readJson<{ conversations: ConversationSummary[] }>(res)).conversations
}

export async function getConversation(id: string): Promise<Conversation> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { cache: 'no-store' })
  return (await readJson<{ conversation: Conversation }>(res)).conversation
}

export async function setArchived(id: string, archived: boolean): Promise<ConversationSummary> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived }),
  })
  return (await readJson<{ conversation: ConversationSummary }>(res)).conversation
}

export async function listModels(): Promise<{ defaultModel: string; models: string[]; error?: string }> {
  return readJson(await fetch('/api/models', { cache: 'no-store' }))
}

export async function getModelInfo(model: string): Promise<{ model: string; contextLength: number; source: string }> {
  return readJson(await fetch(`/api/model-info?model=${encodeURIComponent(model)}`, { cache: 'no-store' }))
}

/** POSTs a message and yields the server's streamed events. Throws ApiError if the request is rejected. */
export async function* streamChat(body: ChatRequestBody, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    await readJson(res)
    throw new ApiError('The server returned an empty response', res.status)
  }
  yield* parseNdjson<StreamEvent>(res.body)
}
