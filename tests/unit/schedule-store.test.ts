import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidScheduleId, ScheduleStore } from '@/lib/schedule-store'
import type { ScheduleRule } from '@/lib/types'
import { makeTempDataDir } from '../helpers/temp-data'

const rule: ScheduleRule = { kind: 'daily', time: '09:00', timezone: 'UTC' }

let dataDir: string
let cleanup: () => Promise<void>
let store: ScheduleStore

beforeEach(async () => {
  ;({ dir: dataDir, cleanup } = await makeTempDataDir())
  store = new ScheduleStore(dataDir)
})

afterEach(() => cleanup())

describe('ScheduleStore', () => {
  it('creates a schedule that is waiting for its first run', () => {
    const schedule = store.create({ prompt: '# Daily *news*\nMore detail', rule }, new Date('2026-11-02T10:00:00Z'))
    expect(schedule).toMatchObject({
      title: 'Daily news',
      enabled: true,
      conversationId: null,
      nextRunAt: '2026-11-03T09:00:00.000Z',
      lastRunAt: null,
      unread: false,
    })
    expect(isValidScheduleId(schedule.id)).toBe(true)
  })

  it('round-trips through disk without leaving temp files', async () => {
    const schedule = store.create({ prompt: 'News', rule, model: 'kimi-k2.6', think: 'high' })
    await store.save(schedule)
    expect(await store.get(schedule.id)).toEqual(schedule)
    expect(await readdir(store.dir)).toEqual([`${schedule.id}.json`])
  })

  it('lists the soonest run first and paused schedules last', async () => {
    const paused = { ...store.create({ prompt: 'Paused', rule }), enabled: false, nextRunAt: '2026-01-01T00:00:00.000Z' }
    const later = { ...store.create({ prompt: 'Later', rule }), nextRunAt: '2030-01-02T00:00:00.000Z' }
    const sooner = { ...store.create({ prompt: 'Sooner', rule }), nextRunAt: '2030-01-01T00:00:00.000Z' }
    await Promise.all([paused, later, sooner].map((s) => store.save(s)))
    expect((await store.list()).map((s) => s.title)).toEqual(['Sooner', 'Later', 'Paused'])
  })

  it('lists nothing before the folder exists', async () => {
    expect(await store.list()).toEqual([])
  })

  it('skips unreadable files rather than failing the whole list', async () => {
    const good = store.create({ prompt: 'Good', rule })
    await store.save(good)
    await mkdir(store.dir, { recursive: true })
    await writeFile(path.join(store.dir, 'broken.json'), '{nope')
    await writeFile(path.join(store.dir, 'other.json'), JSON.stringify({ message: 'not one of ours' }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await store.list()).map((s) => s.id)).toEqual([good.id])
  })

  it('applies concurrent updates one at a time so none are lost', async () => {
    const schedule = store.create({ prompt: 'News', rule })
    await store.save(schedule)
    await Promise.all([
      store.update(schedule.id, (s) => (s.unread = true)),
      store.update(schedule.id, (s) => (s.lastRunAt = '2026-11-02T09:00:00.000Z')),
      store.update(schedule.id, (s) => (s.conversationId = 'c1')),
    ])
    expect(await store.get(schedule.id)).toMatchObject({
      unread: true,
      lastRunAt: '2026-11-02T09:00:00.000Z',
      conversationId: 'c1',
    })
  })

  it('carries on after a failed update', async () => {
    const schedule = store.create({ prompt: 'News', rule })
    await store.save(schedule)
    await expect(
      store.update(schedule.id, () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await store.update(schedule.id, (s) => (s.unread = true))
    expect(JSON.parse(await readFile(path.join(store.dir, `${schedule.id}.json`), 'utf8')).unread).toBe(true)
  })

  it('returns null when updating a schedule that is gone', async () => {
    expect(await store.update('missing', () => {})).toBeNull()
  })

  it('never brings a deleted schedule back, whichever write comes first', async () => {
    for (let i = 0; i < 25; i++) {
      const schedule = store.create({ prompt: 'News', rule })
      await store.save(schedule)
      await Promise.all([store.update(schedule.id, (s) => (s.lastError = 'stopped')), store.delete(schedule.id)])
      expect(await store.get(schedule.id)).toBeNull()

      await store.save(schedule)
      await Promise.all([store.delete(schedule.id), store.update(schedule.id, (s) => (s.lastError = 'stopped'))])
      expect(await store.get(schedule.id)).toBeNull()
    }
  })

  it('deletes schedules and reports when there was nothing to delete', async () => {
    const schedule = store.create({ prompt: 'News', rule })
    await store.save(schedule)
    expect(await store.delete(schedule.id)).toBe(true)
    expect(await store.delete(schedule.id)).toBe(false)
    expect(await store.delete('../evil')).toBe(false)
  })
})
