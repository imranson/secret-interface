import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getScheduleStore } from '@/lib/schedule-store'
import { getStore } from '@/lib/store'
import type { ScheduleView } from '@/lib/types'
import { appFetch } from '../helpers/app-fetch'
import { chunk, createFakeOllama, type FakeOllama } from '../helpers/fake-ollama'
import { makeTempDataDir } from '../helpers/temp-data'

const holder = vi.hoisted(() => ({ fake: undefined as FakeOllama | undefined }))
vi.mock('@/lib/ollama', () => ({ getOllamaClient: () => holder.fake!.client }))

const rule = { kind: 'daily', time: '09:00', timezone: 'Europe/London' }

let cleanup: () => Promise<void>

beforeEach(async () => {
  const temp = await makeTempDataDir()
  cleanup = temp.cleanup
  vi.stubEnv('DATA_DIR', temp.dir)
  vi.stubEnv('OLLAMA_API_KEY', 'test-key')
  vi.stubEnv('OLLAMA_HOST', '')
  vi.stubEnv('OLLAMA_MODEL', 'kimi-k2.6')
  holder.fake = createFakeOllama()
})

afterEach(() => cleanup())

const send = (method: string, url: string, body?: unknown) =>
  appFetch(url, { method, ...(body !== undefined && { body: JSON.stringify(body) }) })

async function create(overrides: Record<string, unknown> = {}): Promise<ScheduleView> {
  const response = await send('POST', '/api/schedules', { prompt: ' Daily news ', rule, ...overrides })
  expect(response.status).toBe(201)
  return (await response.json()).schedule
}

const statusOf = async (id: string) => {
  const { schedules } = await (await appFetch('/api/schedules')).json()
  return schedules.find((s: ScheduleView) => s.id === id).status
}

describe('/api/schedules', () => {
  it('creates a schedule, which waits for its first run without creating a conversation', async () => {
    const schedule = await create({ model: 'gpt-oss:120b', think: 'low' })
    expect(schedule).toMatchObject({
      prompt: 'Daily news',
      title: 'Daily news',
      status: 'scheduled',
      model: 'gpt-oss:120b',
      think: 'low',
      conversationId: null,
    })
    expect(new Date(schedule.nextRunAt!).getTime()).toBeGreaterThan(Date.now())
    expect(await getStore().list()).toEqual([])
  })

  it.each([
    [{ prompt: '   ', rule }, 'Prompt is required'],
    [{ prompt: 'x' }, 'A schedule rule is required'],
    [{ prompt: 'x', rule: { ...rule, time: 'soon' } }, 'Pick a time (HH:MM)'],
    [{ prompt: 'x', rule, think: 'hard' }, 'Invalid think option'],
    [{ prompt: 'x', rule, backend: 'mars' }, 'Invalid backend'],
  ])('rejects %j', async (body, error) => {
    const response = await send('POST', '/api/schedules', body)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error })
  })

  it('remembers the backend', async () => {
    const schedule = await create({ backend: 'local', model: 'qwen3:8b' })
    expect(schedule).toMatchObject({ backend: 'local', model: 'qwen3:8b' })
    expect((await getScheduleStore().get(schedule.id))?.backend).toBe('local')
  })

  it('rejects a body that is not JSON', async () => {
    const response = await appFetch('/api/schedules', { method: 'POST', body: '{' })
    expect(response.status).toBe(400)
  })

  it('reports scheduled → running → unread → completed as a run goes through', async () => {
    holder.fake!.push({ chunks: [chunk.content('Report'), chunk.done()] })
    const { id } = await create()
    expect(await statusOf(id)).toBe('scheduled')

    const started = await send('POST', `/api/schedules/${id}/run`)
    expect(started.status).toBe(202)
    expect((await started.json()).schedule.status).toBe('running')

    await vi.waitFor(async () => expect(await statusOf(id)).toBe('unread'))

    const read = await send('PATCH', `/api/schedules/${id}`, { unread: false })
    expect((await read.json()).schedule.status).toBe('completed')
    expect(await statusOf(id)).toBe('completed')
  })

  it('reports a failed run', async () => {
    holder.fake!.push({ error: new Error('offline') })
    const { id } = await create()
    await send('POST', `/api/schedules/${id}/run`)
    await vi.waitFor(async () => expect(await statusOf(id)).toBe('failed'))
  })

  it('refuses to run the same schedule twice at once', async () => {
    holder.fake!.push({ chunks: [chunk.content('Slow')], hang: true })
    const { id } = await create()
    await send('POST', `/api/schedules/${id}/run`)
    expect((await send('POST', `/api/schedules/${id}/run`)).status).toBe(409)
    await send('DELETE', `/api/schedules/${id}`)
  })

  it('pauses, and resumes from now rather than making up missed runs', async () => {
    const { id } = await create()
    const paused = await (await send('PATCH', `/api/schedules/${id}`, { enabled: false })).json()
    expect(paused.schedule.status).toBe('paused')

    await getScheduleStore().update(id, (s) => (s.nextRunAt = '2020-01-01T09:00:00.000Z'))
    const resumed = await (await send('PATCH', `/api/schedules/${id}`, { enabled: true })).json()
    expect(resumed.schedule.status).toBe('scheduled')
    expect(new Date(resumed.schedule.nextRunAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('catch-up starts every schedule that is not up to date in the background and says which', async () => {
    holder.fake!.push({ chunks: [chunk.content('Report'), chunk.done()] }, { chunks: [chunk.content('Report'), chunk.done()] })
    const neverRun = await create()
    const failed = await create()
    const upToDate = await create()
    await getScheduleStore().update(failed.id, (s) => ((s.lastRunAt = new Date().toISOString()), (s.lastError = 'fetch failed')))
    await getScheduleStore().update(upToDate.id, (s) => (s.lastRunAt = new Date().toISOString()))

    const response = await send('POST', '/api/schedules/catch-up')
    expect(response.status).toBe(200)
    expect((await response.json()).started.sort()).toEqual([neverRun.id, failed.id].sort())
    await vi.waitFor(async () => expect(await statusOf(neverRun.id)).toBe('unread'))
    await vi.waitFor(async () => expect(await statusOf(failed.id)).toBe('unread'))
    expect(await statusOf(upToDate.id)).toBe('completed')
  })

  it('validates updates', async () => {
    const { id } = await create()
    expect((await send('PATCH', `/api/schedules/${id}`, { enabled: 'yes' })).status).toBe(400)
    expect((await send('PATCH', `/api/schedules/${id}`, { unread: 1 })).status).toBe(400)
    expect((await send('PATCH', '/api/schedules/missing', { unread: false })).status).toBe(404)
    expect((await send('POST', '/api/schedules/missing/run')).status).toBe(404)
  })

  it('deleting a schedule keeps its conversation', async () => {
    holder.fake!.push({ chunks: [chunk.content('Report'), chunk.done()] })
    const { id } = await create()
    await send('POST', `/api/schedules/${id}/run`)
    await vi.waitFor(async () => expect(await statusOf(id)).toBe('unread'))

    expect((await send('DELETE', `/api/schedules/${id}`)).status).toBe(200)
    expect((await send('DELETE', `/api/schedules/${id}`)).status).toBe(404)
    expect((await (await appFetch('/api/schedules')).json()).schedules).toEqual([])
    expect(await getStore().list()).toHaveLength(1)
  })
})
