import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getScheduledStore } from '@/lib/schedule-store'
import { runSchedule, tickSchedules } from '@/lib/scheduler'
import { getStore } from '@/lib/store'
import type { ScheduledMessage } from '@/lib/types'
import { chunk, createFakeOllama, HttpError, type FakeOllama } from '../helpers/fake-ollama'
import { makeTempDataDir } from '../helpers/temp-data'

const holder = vi.hoisted(() => ({ fake: undefined as FakeOllama | undefined }))
vi.mock('@/lib/ollama', () => ({ getOllamaClient: () => holder.fake!.client }))

let dataDir: string
let cleanup: () => Promise<void>

beforeEach(async () => {
  ;({ dir: dataDir, cleanup } = await makeTempDataDir())
  vi.stubEnv('DATA_DIR', dataDir)
  vi.stubEnv('OLLAMA_API_KEY', 'test-key')
  vi.stubEnv('OLLAMA_HOST', '')
  vi.stubEnv('OLLAMA_MODEL', 'kimi-k2.6')
  vi.stubEnv('SYSTEM_PROMPT', '')
  holder.fake = createFakeOllama()
})

afterEach(() => cleanup())

function schedule(overrides: Partial<ScheduledMessage> = {}): ScheduledMessage {
  const s = getScheduledStore(dataDir).create(
    { message: 'Daily briefing', rule: { kind: 'daily', time: '09:00', timezone: 'UTC' } },
    new Date('2026-11-01T00:00:00Z'),
  )
  return { ...s, ...overrides }
}

async function readConversation(id: string) {
  return JSON.parse(await readFile(path.join(dataDir, 'conversations', `${id}.json`), 'utf8'))
}

describe('runSchedule', () => {
  it('appends a one-off to its target conversation and marks it unread', async () => {
    const conversation = getStore(dataDir).create({ title: 'Target' })
    conversation.messages.push({ role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Re: Earlier' })
    await getStore(dataDir).save(conversation)

    holder.fake!.push({ chunks: [chunk.content('Fresh answer.'), chunk.done()] })
    const s = schedule({ rule: { kind: 'once', at: '2026-11-02T09:00:00Z' }, conversationId: conversation.id })
    await getScheduledStore(dataDir).save(s)

    await runSchedule(s)

    const saved = await readConversation(conversation.id)
    expect(saved.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])

    const updated = await getScheduledStore(dataDir).get(s.id)
    expect(updated).toMatchObject({
      nextRunAt: null,
      lastConversationId: conversation.id,
      unread: true,
      lastError: null,
    })
  })

  it('starts a new conversation for a recurring schedule and advances the next run', async () => {
    holder.fake!.push({ chunks: [chunk.content('Fresh briefing.'), chunk.done()] })
    const s = schedule() // daily 09:00 UTC
    s.nextRunAt = '2026-11-01T09:00:00.000Z'
    await getScheduledStore(dataDir).save(s)

    await runSchedule(s)

    const updated = await getScheduledStore(dataDir).get(s.id)
    expect(updated!.lastConversationId).toBeTruthy()
    expect(updated!.unread).toBe(true)
    expect(updated!.nextRunAt).toBe('2026-11-02T09:00:00.000Z')

    const created = await readConversation(updated!.lastConversationId!)
    expect(created.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant'])
    expect(created.messages[0].content).toBe('Daily briefing')
  })

  it('falls back to a new conversation when the one-off target is archived or missing', async () => {
    const archived = getStore(dataDir).create({ title: 'Archived' })
    await getStore(dataDir).save(archived)
    await getStore(dataDir).setArchived(archived.id, true)

    holder.fake!.push({ chunks: [chunk.content('In a fresh chat.'), chunk.done()] })
    const s = schedule({ rule: { kind: 'once', at: '2026-11-02T09:00:00Z' }, conversationId: archived.id })
    await getScheduledStore(dataDir).save(s)

    await runSchedule(s)

    const updated = await getScheduledStore(dataDir).get(s.id)
    expect(updated!.lastConversationId).not.toBe(archived.id)
    expect(updated!.unread).toBe(true)
  })

  it('records the error and does not mark unread when the model fails', async () => {
    holder.fake!.push({ error: new HttpError('unauthorized', 401) })
    const s = schedule({ rule: { kind: 'once', at: '2026-11-02T09:00:00Z' } })
    await getScheduledStore(dataDir).save(s)

    await runSchedule(s)

    const updated = await getScheduledStore(dataDir).get(s.id)
    expect(updated).toMatchObject({ nextRunAt: null, unread: false })
    expect(updated!.lastError).toContain('unauthorized')
  })
})

describe('tickSchedules', () => {
  it('starts due schedules and leaves future ones alone', async () => {
    holder.fake!.push({ chunks: [chunk.content('Due reply.'), chunk.done()] })

    const due = schedule({ rule: { kind: 'once', at: '2026-11-02T09:00:00Z' } })
    due.nextRunAt = '2026-11-01T08:00:00.000Z' // already in the past
    await getScheduledStore(dataDir).save(due)

    const future = schedule({ message: 'Future one', rule: { kind: 'once', at: '2030-01-01T09:00:00Z' } })
    future.nextRunAt = '2030-01-01T09:00:00.000Z'
    await getScheduledStore(dataDir).save(future)

    const started = await tickSchedules({ await: true })
    expect(started).toBe(1)

    expect((await getScheduledStore(dataDir).get(due.id))!.unread).toBe(true)
    expect((await getScheduledStore(dataDir).get(future.id))!.lastRunAt).toBeNull()
  })
})
