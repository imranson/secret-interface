import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as chatPOST } from '@/app/api/chat/route'
import { DELETE as scheduleDELETE } from '@/app/api/schedules/[id]/route'
import { beginChat, endChat, isRunning } from '@/lib/run-state'
import { getScheduleStore } from '@/lib/schedule-store'
import { startRun, tickSchedules } from '@/lib/scheduler'
import { getStore } from '@/lib/store'
import type { Schedule, ScheduleRule } from '@/lib/types'
import { chunk, createFakeOllama, HttpError, type FakeOllama } from '../helpers/fake-ollama'
import { makeTempDataDir } from '../helpers/temp-data'

const holder = vi.hoisted(() => ({ fake: undefined as FakeOllama | undefined }))
vi.mock('@/lib/ollama', () => ({ getOllamaClient: () => holder.fake!.client }))

const rule: ScheduleRule = { kind: 'daily', time: '09:00', timezone: 'UTC' }
const report = (text: string) => ({ chunks: [chunk.content(text), chunk.done()] })

let dataDir: string
let cleanup: () => Promise<void>

beforeEach(async () => {
  ;({ dir: dataDir, cleanup } = await makeTempDataDir())
  vi.stubEnv('DATA_DIR', dataDir)
  vi.stubEnv('OLLAMA_API_KEY', 'test-key')
  vi.stubEnv('OLLAMA_HOST', '')
  vi.stubEnv('OLLAMA_MODEL', 'kimi-k2.6:cloud')
  vi.stubEnv('SYSTEM_PROMPT', 'Be brief.')
  holder.fake = createFakeOllama()
})

afterEach(() => cleanup())

async function dueSchedule(overrides: Partial<Schedule> = {}): Promise<Schedule> {
  const schedule: Schedule = {
    ...getScheduleStore().create({ prompt: 'Daily news', rule }),
    nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  }
  await getScheduleStore().save(schedule)
  return schedule
}

const latest = async (id: string) => (await getScheduleStore().get(id))!
const contents = async (id: string) => (await getStore().get(id))!.messages.map((m) => m.content)

async function runNow(id: string) {
  await startRun(await latest(id))
  return latest(id)
}

async function seedReport(title = 'Daily news') {
  const conversation = getStore().create({ title })
  conversation.messages.push({ role: 'user', content: 'Daily news' }, { role: 'assistant', content: 'Monday report' })
  await getStore().save(conversation)
  return conversation
}

describe('a recurring run', () => {
  it('creates the conversation on the first run and marks it unread', async () => {
    holder.fake!.push(report('Monday report'))
    const { id } = await dueSchedule()

    const after = await runNow(id)

    expect(after).toMatchObject({ unread: true, lastError: null })
    expect(after.conversationId).toBeTruthy()
    expect(await contents(after.conversationId!)).toEqual(['Daily news', 'Monday report'])
    expect(await getStore().get(after.conversationId!)).toMatchObject({ title: 'Daily news', model: 'kimi-k2.6' })
  })

  it('sends the prompt on its own, with the schedule’s model, thinking and time zone', async () => {
    holder.fake!.push({ chunks: [chunk.toolCall('get_current_datetime', {}), chunk.done()] }, report('Done'))
    const { id } = await dueSchedule({
      model: 'gpt-oss:120b',
      think: 'high',
      rule: { ...rule, timezone: 'Asia/Tokyo' },
    })

    const after = await runNow(id)

    expect(holder.fake!.requests[0]).toMatchObject({
      model: 'gpt-oss:120b',
      think: 'high',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Daily news' },
      ],
    })
    const saved = await getStore().get(after.conversationId!)
    expect(saved!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(saved!.messages[2].content).toContain('Asia/Tokyo')
  })

  it('refreshes the same conversation on every later run, so one schedule owns one conversation', async () => {
    holder.fake!.push(report('Monday report'), report('Tuesday report'), report('Wednesday report'))
    const { id } = await dueSchedule()

    const first = await runNow(id)
    const second = await runNow(id)
    const third = await runNow(id)

    expect(second.conversationId).toBe(first.conversationId)
    expect(third.conversationId).toBe(first.conversationId)
    expect(await getStore().list()).toHaveLength(1)
    expect(await contents(first.conversationId!)).toEqual(['Daily news', 'Wednesday report'])
  })

  it('starts each refresh from scratch instead of feeding the model the old report', async () => {
    const old = await seedReport()
    const { id } = await dueSchedule({ conversationId: old.id })

    await runNow(id)

    expect(holder.fake!.requests[0].messages).toHaveLength(2)
    expect(JSON.stringify(holder.fake!.requests[0].messages)).not.toContain('Monday report')
  })

  it('moves the conversation back to the top of Recent', async () => {
    const old = await seedReport()
    const other = await seedReport('Newer chat')
    const { id } = await dueSchedule({ conversationId: old.id })

    await runNow(id)

    expect((await getStore().list()).map((c) => c.id)).toEqual([old.id, other.id])
  })

  it('creates a replacement if its conversation has gone', async () => {
    holder.fake!.push(report('Fresh report'))
    const { id } = await dueSchedule({ conversationId: 'deleted' })

    const after = await runNow(id)

    expect(after.conversationId).not.toBe('deleted')
    expect(await contents(after.conversationId!)).toEqual(['Daily news', 'Fresh report'])
  })

  it('leaves an archived conversation alone and starts a new one', async () => {
    const kept = await seedReport()
    await getStore().setArchived(kept.id, true)
    holder.fake!.push(report('Tuesday report'))
    const { id } = await dueSchedule({ conversationId: kept.id })

    const after = await runNow(id)

    expect(after.conversationId).not.toBe(kept.id)
    expect(await contents(kept.id)).toEqual(['Daily news', 'Monday report'])
  })
})

describe('a failed run', () => {
  it('keeps the last report and records why', async () => {
    const old = await seedReport()
    holder.fake!.push({ error: new HttpError('unauthorized', 401) })
    const { id } = await dueSchedule({ conversationId: old.id })

    const after = await runNow(id)

    expect(after.lastError).toContain('unauthorized')
    expect(after.unread).toBe(false)
    expect(await contents(old.id)).toEqual(['Daily news', 'Monday report'])
  })

  it('keeps the last report when the stream dies part way through', async () => {
    const old = await seedReport()
    holder.fake!.push({ chunks: [chunk.content('Half a rep')], streamError: new Error('connection lost') })
    const { id } = await dueSchedule({ conversationId: old.id })

    expect((await runNow(id)).lastError).toContain('connection lost')
    expect(await contents(old.id)).toEqual(['Daily news', 'Monday report'])
  })

  it('treats an empty reply as a failure', async () => {
    const old = await seedReport()
    holder.fake!.push({ chunks: [chunk.done()] })
    const { id } = await dueSchedule({ conversationId: old.id })

    expect((await runNow(id)).lastError).toContain('empty reply')
    expect(await contents(old.id)).toEqual(['Daily news', 'Monday report'])
  })

  it('creates no conversation on a failed first run, then recovers', async () => {
    holder.fake!.push({ error: new Error('offline') }, report('Back online'))
    const { id } = await dueSchedule()

    const failed = await runNow(id)
    expect(failed).toMatchObject({ conversationId: null, lastError: 'offline' })
    expect(await getStore().list()).toEqual([])

    const recovered = await runNow(id)
    expect(recovered).toMatchObject({ lastError: null, unread: true })
    expect(await getStore().list()).toHaveLength(1)
  })

  it('does not hammer the model: the next attempt waits for the next scheduled time', async () => {
    holder.fake!.push({ error: new Error('offline') })
    const { id } = await dueSchedule()

    await tickSchedules()
    await tickSchedules()

    expect(holder.fake!.client.chat).toHaveBeenCalledTimes(1)
    expect(new Date((await latest(id)).nextRunAt!).getTime()).toBeGreaterThan(Date.now())
  })
})

describe('tickSchedules', () => {
  it('runs what is due, once, however long overdue it is, and leaves the rest', async () => {
    holder.fake!.push(report('Caught up'))
    const overdue = await dueSchedule({ nextRunAt: '2020-01-01T09:00:00.000Z' })
    const future = await dueSchedule({ nextRunAt: '2099-01-01T09:00:00.000Z' })
    const paused = await dueSchedule({ enabled: false })

    await tickSchedules()
    await tickSchedules()

    expect(holder.fake!.client.chat).toHaveBeenCalledTimes(1)
    expect((await latest(overdue.id)).unread).toBe(true)
    expect(new Date((await latest(overdue.id)).nextRunAt!).getTime()).toBeGreaterThan(Date.now())
    expect((await latest(future.id)).lastRunAt).toBeNull()
    expect((await latest(paused.id)).lastRunAt).toBeNull()
  })

  it('leaves a run due if the server dies before it finishes', async () => {
    holder.fake!.push({ chunks: [chunk.content('Half')], hang: true })
    const { id, nextRunAt } = await dueSchedule()

    const run = startRun(await latest(id))!
    await vi.waitFor(() => expect(holder.fake!.client.chat).toHaveBeenCalled())
    expect((await latest(id)).nextRunAt).toBe(nextRunAt)

    await scheduleDELETE(new Request('http://localhost'), { params: Promise.resolve({ id }) })
    await run
  })

  it('does not run a schedule that is already running', async () => {
    holder.fake!.push({ chunks: [chunk.content('Slow')], hang: true })
    const schedule = await dueSchedule()

    const run = startRun(schedule)!
    expect(isRunning(schedule.id)).toBe(true)
    expect(startRun(schedule)).toBeNull()

    await scheduleDELETE(new Request('http://localhost'), { params: Promise.resolve({ id: schedule.id }) })
    await run
    expect(isRunning(schedule.id)).toBe(false)
  })

  it('leaves the next run alone when run early by hand', async () => {
    holder.fake!.push(report('Early'))
    const { id } = await dueSchedule({ nextRunAt: '2099-01-01T09:00:00.000Z' })

    expect((await runNow(id)).nextRunAt).toBe('2099-01-01T09:00:00.000Z')
  })
})

describe('sharing a conversation with the person using it', () => {
  const chat = (conversationId: string) =>
    chatPOST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({ conversationId, message: 'A follow-up' }),
      }),
    )

  it('waits for a reply in progress, then runs on a later tick', async () => {
    const old = await seedReport()
    holder.fake!.push(report('Tuesday report'))
    const { id } = await dueSchedule({ conversationId: old.id })

    beginChat(old.id)
    await tickSchedules()
    expect(holder.fake!.client.chat).not.toHaveBeenCalled()
    expect((await latest(id)).lastRunAt).toBeNull()

    endChat(old.id)
    await tickSchedules()
    expect(await contents(old.id)).toEqual(['Daily news', 'Tuesday report'])
  })

  it('refuses a message while the conversation is refreshing, so neither overwrites the other', async () => {
    const old = await seedReport()
    holder.fake!.push({ chunks: [chunk.content('Slow')], hang: true })
    const schedule = await dueSchedule({ conversationId: old.id })

    const run = startRun(schedule)!
    await vi.waitFor(() => expect(holder.fake!.client.chat).toHaveBeenCalled())

    const response = await chat(old.id)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: expect.stringContaining('refreshing') })

    await scheduleDELETE(new Request('http://localhost'), { params: Promise.resolve({ id: schedule.id }) })
    await run
  })

  it('frees the conversation once a reply finishes, however it ended', async () => {
    // Rejected before any reply started.
    expect((await chat('missing')).status).toBe(404)
    holder.fake!.push(report('Recreated'))
    const rejected = await dueSchedule({ conversationId: 'missing' })
    await tickSchedules()
    expect((await latest(rejected.id)).lastRunAt).not.toBeNull()

    // Replied to in full.
    const old = await seedReport()
    holder.fake!.push(report('A reply'))
    await (await chat(old.id)).text()
    holder.fake!.push(report('Tuesday report'))
    const replied = await dueSchedule({ conversationId: old.id })
    await tickSchedules()
    expect((await latest(replied.id)).lastRunAt).not.toBeNull()
  })

  it('replaces follow-up replies on the next refresh', async () => {
    const old = await seedReport()
    holder.fake!.push(report('A reply'), report('Tuesday report'))
    await (await chat(old.id)).text()
    expect(await contents(old.id)).toHaveLength(4)

    const { id } = await dueSchedule({ conversationId: old.id })
    await runNow(id)

    expect(await contents(old.id)).toEqual(['Daily news', 'Tuesday report'])
  })

  it('stops a run when its schedule is deleted, without creating a conversation', async () => {
    holder.fake!.push({ chunks: [chunk.content('Half')], hang: true })
    const schedule = await dueSchedule()

    const run = startRun(schedule)!
    await vi.waitFor(() => expect(holder.fake!.client.chat).toHaveBeenCalled())
    await scheduleDELETE(new Request('http://localhost'), { params: Promise.resolve({ id: schedule.id }) })
    await run

    expect(await getScheduleStore().get(schedule.id)).toBeNull()
    expect(await getStore().list()).toEqual([])
  })
})
