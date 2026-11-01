import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DELETE, PATCH } from '@/app/api/schedules/[id]/route'
import { POST as markRead } from '@/app/api/schedules/mark-read/route'
import { GET as list, POST as create } from '@/app/api/schedules/route'
import { getScheduledStore } from '@/lib/schedule-store'
import type { ScheduledMessage } from '@/lib/types'
import { makeTempDataDir } from '../helpers/temp-data'

let dataDir: string
let cleanup: () => Promise<void>

beforeEach(async () => {
  ;({ dir: dataDir, cleanup } = await makeTempDataDir())
  vi.stubEnv('DATA_DIR', dataDir)
})

afterEach(() => cleanup())

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

function post(body: unknown, init: RequestInit = {}) {
  return create(
    new Request('http://localhost/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...init,
    }),
  )
}

function patch(id: string, body: unknown) {
  return PATCH(
    new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) }),
    ctx(id),
  )
}

function remove(id: string) {
  return DELETE(new Request('http://localhost', { method: 'DELETE' }), ctx(id))
}

async function seed(overrides: Partial<ScheduledMessage> = {}): Promise<ScheduledMessage> {
  const store = getScheduledStore(dataDir)
  const schedule = store.create(
    { message: 'Daily reminder', rule: { kind: 'daily', time: '09:00', timezone: 'UTC' } },
    new Date('2026-11-01T00:00:00Z'),
  )
  Object.assign(schedule, overrides)
  await store.save(schedule)
  return schedule
}

describe('schedules API', () => {
  it('lists nothing initially and creates a schedule', async () => {
    expect((await (await list()).json()).schedules).toEqual([])

    const response = await post({
      message: '  Check the news  ',
      rule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      think: 'low',
    })
    expect(response.status).toBe(201)
    const { schedule } = (await response.json()) as { schedule: ScheduledMessage }
    expect(schedule).toMatchObject({
      message: 'Check the news',
      think: 'low',
      enabled: true,
      unread: false,
      rule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
    })
    expect(schedule.nextRunAt).toBeTruthy()

    const listed = (await (await list()).json()).schedules as ScheduledMessage[]
    expect(listed.map((s) => s.id)).toEqual([schedule.id])
  })

  it('creates a one-off targeted at a conversation', async () => {
    const response = await post({
      message: 'Follow up',
      rule: { kind: 'once', at: '2026-11-05T15:00:00Z' },
      conversationId: 'a'.repeat(32),
    })
    const { schedule } = (await response.json()) as { schedule: ScheduledMessage }
    expect(schedule.conversationId).toBe('a'.repeat(32))
    expect(schedule.nextRunAt).toBe('2026-11-05T15:00:00.000Z')
  })

  it('rejects a one-off whose target conversation id is invalid', async () => {
    expect((await post({ message: 'x', rule: { kind: 'once', at: '2026-11-05T15:00:00Z' }, conversationId: '../etc' })).status).toBe(400)
  })

  it('validates the request', async () => {
    expect((await post('not json')).status).toBe(400)
    expect(await (await post({ message: '   ', rule: { kind: 'daily', time: '09:00' } })).json()).toEqual({
      error: 'Message is required',
    })
    expect((await post({ message: 'hi', rule: { kind: 'daily' } })).status).toBe(400)
    expect((await post({ message: 'hi', rule: { kind: 'daily', time: '09:00' }, think: 'maybe' })).status).toBe(400)
    expect((await post({ message: 'hi' })).status).toBe(400)
  })

  it('pauses, resumes and marks a schedule read', async () => {
    const schedule = await seed()
    const paused = await patch(schedule.id, { enabled: false })
    expect((await paused.json()).schedule).toMatchObject({ enabled: false })

    const resumed = await patch(schedule.id, { enabled: true })
    expect((await resumed.json()).schedule).toMatchObject({ enabled: true })

    await seed({ unread: true, lastConversationId: 'b'.repeat(32) })
    const read = await patch(schedule.id, { unread: false })
    expect((await read.json()).schedule.unread).toBe(false)

    expect((await patch(schedule.id, { enabled: 'no' })).status).toBe(400)
    expect((await patch('f'.repeat(32), { enabled: false })).status).toBe(404)
    expect((await patch('../bad', { enabled: false })).status).toBe(400)
  })

  it('deletes a schedule', async () => {
    const schedule = await seed()
    expect((await remove(schedule.id)).status).toBe(200)
    expect((await remove(schedule.id)).status).toBe(404)
    expect((await (await list()).json()).schedules).toEqual([])
  })

  it('marks every unread run into a conversation as read', async () => {
    await seed({ unread: true, lastConversationId: 'c'.repeat(32) })
    await seed({ unread: true, lastConversationId: 'c'.repeat(32) })
    await seed({ unread: true, lastConversationId: 'd'.repeat(32) })

    const response = await markRead(
      new Request('http://localhost', { method: 'POST', body: JSON.stringify({ conversationId: 'c'.repeat(32) }) }),
    )
    expect((await response.json()).marked).toBe(2)

    const schedules = await getScheduledStore(dataDir).list()
    expect(schedules.filter((s) => s.unread).map((s) => s.lastConversationId)).toEqual(['d'.repeat(32)])
  })

  it('validates the mark-read conversation id', async () => {
    expect(
      (await markRead(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ conversationId: '../x' }) }))).status,
    ).toBe(400)
    expect(
      (await markRead(new Request('http://localhost', { method: 'POST', body: '{' }))).status,
    ).toBe(400)
  })
})
