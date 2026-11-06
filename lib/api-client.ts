import { parseNdjson } from './ndjson'
import type {
  Backend,
  ChatRequestBody,
  Conversation,
  ConversationSummary,
  CreateScheduleBody,
  ModelList,
  ScheduleView,
  StreamEvent,
} from './types'

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

export async function listSchedules(): Promise<ScheduleView[]> {
  const res = await fetch('/api/schedules', { cache: 'no-store' })
  return (await readJson<{ schedules: ScheduleView[] }>(res)).schedules
}

export async function createSchedule(body: CreateScheduleBody): Promise<ScheduleView> {
  const res = await fetch('/api/schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await readJson<{ schedule: ScheduleView }>(res)).schedule
}

export async function updateSchedule(id: string, change: { enabled?: boolean; unread?: boolean }): Promise<ScheduleView> {
  const res = await fetch(`/api/schedules/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(change),
  })
  return (await readJson<{ schedule: ScheduleView }>(res)).schedule
}

export async function deleteSchedule(id: string): Promise<void> {
  await readJson(await fetch(`/api/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }))
}

export async function runSchedule(id: string): Promise<ScheduleView> {
  const res = await fetch(`/api/schedules/${encodeURIComponent(id)}/run`, { method: 'POST' })
  return (await readJson<{ schedule: ScheduleView }>(res)).schedule
}

/** Starts every schedule that isn't up to date; returns the ids started. */
export async function catchUpSchedules(): Promise<string[]> {
  const res = await fetch('/api/schedules/catch-up', { method: 'POST' })
  return (await readJson<{ started: string[] }>(res)).started
}

export async function listModels(backend: Backend = 'cloud'): Promise<ModelList> {
  return readJson(await fetch(`/api/models?backend=${backend}`, { cache: 'no-store' }))
}

export async function getModelInfo(
  model: string,
  backend: Backend = 'cloud',
): Promise<{ model: string; contextLength: number; source: string }> {
  const query = new URLSearchParams({ model, backend })
  return readJson(await fetch(`/api/model-info?${query}`, { cache: 'no-store' }))
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
