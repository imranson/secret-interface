import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from '@/lib/db'
import { isValidScheduleId, normalizeSchedule, ScheduleStore, toScheduleView } from '@/lib/schedule-store'
import type { ScheduleRule } from '@/lib/types'

const rule: ScheduleRule = { kind: 'daily', time: '09:00', timezone: 'UTC' }

// A PGlite of this file's own, used directly, so tests can look at the table.
let pglite: PGlite
let store: ScheduleStore

beforeAll(async () => {
  pglite = new PGlite()
  await pglite.waitReady
})

afterAll(() => pglite.close())

beforeEach(async () => {
  await pglite.exec('DROP TABLE IF EXISTS schedules, conversations, sessions, users')
  const db = new Database(pglite)
  await db.query(`INSERT INTO users (id, username, password_hash) VALUES ('ada', 'ada', 'x'), ('bob', 'bob', 'x')`)
  store = new ScheduleStore(db)
})

const make = (prompt: string, userId = 'ada') => store.create({ userId, prompt, rule })

describe('ScheduleStore', () => {
  it('creates a schedule that is waiting for its first run', () => {
    const schedule = store.create(
      { userId: 'ada', prompt: '# Daily *news*\nMore detail', rule },
      new Date('2026-11-02T10:00:00Z'),
    )
    expect(schedule).toMatchObject({
      userId: 'ada',
      title: 'Daily news',
      enabled: true,
      conversationId: null,
      nextRunAt: '2026-11-03T09:00:00.000Z',
      lastRunAt: null,
      unread: false,
    })
    expect(isValidScheduleId(schedule.id)).toBe(true)
  })

  it('round-trips through the database', async () => {
    const schedule = store.create({ userId: 'ada', prompt: 'News', rule, model: 'kimi-k2.6', think: 'high' })
    await store.save(schedule)
    expect(await store.get(schedule.id)).toEqual(schedule)
    expect(await store.get(schedule.id, 'ada')).toEqual(schedule)
  })

  it('lists the soonest run first and paused schedules last', async () => {
    const paused = { ...make('Paused'), enabled: false, nextRunAt: '2026-01-01T00:00:00.000Z' }
    const later = { ...make('Later'), nextRunAt: '2030-01-02T00:00:00.000Z' }
    const sooner = { ...make('Sooner'), nextRunAt: '2030-01-01T00:00:00.000Z' }
    await Promise.all([paused, later, sooner].map((s) => store.save(s)))
    expect((await store.list('ada')).map((s) => s.title)).toEqual(['Sooner', 'Later', 'Paused'])
  })

  it('keeps each account’s schedules to itself, while the scheduler sees everyone’s', async () => {
    const adas = make('Ada’s')
    const bobs = make('Bob’s', 'bob')
    await store.save(adas)
    await store.save(bobs)

    expect((await store.list('ada')).map((s) => s.id)).toEqual([adas.id])
    expect((await store.list()).map((s) => s.id).sort()).toEqual([adas.id, bobs.id].sort())
    expect(await store.get(adas.id, 'bob')).toBeNull()
    expect(await store.update(adas.id, (s) => (s.enabled = false), 'bob')).toBeNull()
    expect(await store.delete(adas.id, 'bob')).toBe(false)
    await expect(store.save({ ...adas, userId: 'bob' })).rejects.toThrow('belongs to another account')
    expect(await store.get(adas.id)).toEqual(adas)
  })

  it('leaves schedules from before accounts existed out until they are claimed', async () => {
    const old = make('From v2')
    await store.save(old)
    await pglite.query('UPDATE schedules SET user_id = NULL')
    expect(await store.list()).toEqual([])
    expect(await store.get(old.id)).toBeNull()
  })

  it('skips unreadable rows rather than failing the whole list', async () => {
    const good = make('Good')
    await store.save(good)
    await pglite.query(
      `INSERT INTO schedules (id, user_id, data, created_at) VALUES ('broken', 'ada', '{"message": "not one of ours"}', now())`,
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await store.list('ada')).map((s) => s.id)).toEqual([good.id])
  })

  it('applies concurrent updates one at a time so none are lost', async () => {
    const schedule = make('News')
    await store.save(schedule)
    await Promise.all([
      store.update(schedule.id, (s) => (s.unread = true)),
      store.update(schedule.id, (s) => (s.lastRunAt = '2026-11-02T09:00:00.000Z')),
      store.update(schedule.id, (s) => (s.conversationId = 'c1'), 'ada'),
    ])
    expect(await store.get(schedule.id)).toMatchObject({
      unread: true,
      lastRunAt: '2026-11-02T09:00:00.000Z',
      conversationId: 'c1',
    })
  })

  it('carries on after a failed update', async () => {
    const schedule = make('News')
    await store.save(schedule)
    await expect(
      store.update(schedule.id, () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await store.update(schedule.id, (s) => (s.unread = true))
    expect((await store.get(schedule.id))?.unread).toBe(true)
  })

  it('returns null when updating a schedule that is gone', async () => {
    expect(await store.update('missing', () => {})).toBeNull()
  })

  it('never brings a deleted schedule back, whichever write comes first', async () => {
    for (let i = 0; i < 10; i++) {
      const schedule = make('News')
      await store.save(schedule)
      await Promise.all([store.update(schedule.id, (s) => (s.lastError = 'stopped')), store.delete(schedule.id)])
      expect(await store.get(schedule.id)).toBeNull()

      await store.save(schedule)
      await Promise.all([store.delete(schedule.id), store.update(schedule.id, (s) => (s.lastError = 'stopped'))])
      expect(await store.get(schedule.id)).toBeNull()
    }
  })

  it('deletes schedules and reports when there was nothing to delete', async () => {
    const schedule = make('News')
    await store.save(schedule)
    expect(await store.delete(schedule.id, 'ada')).toBe(true)
    expect(await store.delete(schedule.id)).toBe(false)
    expect(await store.delete('../evil')).toBe(false)
  })

  it('imports a schedule once and never overwrites one already stored', async () => {
    const schedule = make('From disk')
    expect(await store.importSchedule(schedule)).toBe(true)
    expect(await store.importSchedule({ ...schedule, prompt: 'Changed' })).toBe(false)
    expect(await store.get(schedule.id)).toEqual(schedule)
  })
})

describe('normalizeSchedule', () => {
  it('reads a file older versions wrote, for the given account', () => {
    const schedule = normalizeSchedule({ prompt: 'News', rule, enabled: false, unread: true }, 'abc', 'ada')
    expect(schedule).toMatchObject({ id: 'abc', userId: 'ada', title: 'News', enabled: false, unread: true })
  })

  it('rejects anything that is not a schedule', () => {
    expect(normalizeSchedule({ prompt: 'News' }, 'abc', 'ada')).toBeNull()
    expect(normalizeSchedule({ rule }, 'abc', 'ada')).toBeNull()
    expect(normalizeSchedule([], 'abc', 'ada')).toBeNull()
  })
})

describe('toScheduleView', () => {
  it('leaves out the owner', () => {
    expect(toScheduleView(make('News'))).not.toHaveProperty('userId')
  })
})
