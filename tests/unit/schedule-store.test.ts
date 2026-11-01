import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getScheduledStore, isValidScheduleId, newScheduleId, ScheduledStore } from '@/lib/schedule-store'
import type { ScheduleRule } from '@/lib/types'
import { makeTempDataDir } from '../helpers/temp-data'

let dir: string
let cleanup: () => Promise<void>
let store: ScheduledStore

beforeEach(async () => {
  ;({ dir, cleanup } = await makeTempDataDir())
  store = new ScheduledStore(dir)
})

afterEach(() => cleanup())

async function writeRaw(relative: string, value: unknown) {
  const file = path.join(dir, 'schedules', relative)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value))
  return file
}

const rule = (overrides: Record<string, unknown> = {}): ScheduleRule =>
  ({ kind: 'daily', time: '09:00', timezone: 'UTC', ...overrides }) as ScheduleRule

describe('ids', () => {
  it('generates 32-character hex ids', () => {
    expect(newScheduleId()).toMatch(/^[0-9a-f]{32}$/)
    expect(isValidScheduleId('a'.repeat(32))).toBe(true)
    expect(isValidScheduleId('../etc')).toBe(false)
    expect(() => store.fileFor('../x')).toThrow()
  })
})

describe('create / save / get', () => {
  it('round-trips a schedule and computes its next run', () => {
    const created = store.create({ message: 'Remind me', rule: rule() }, new Date('2026-11-01T00:00:00Z'))
    expect(created).toMatchObject({
      message: 'Remind me',
      enabled: true,
      unread: false,
      nextRunAt: '2026-11-01T09:00:00.000Z',
    })
  })

  it('persists to <dataDir>/schedules/<id>.json', async () => {
    const created = store.create({ message: 'Hi', rule: rule() })
    await store.save(created)
    const onDisk = JSON.parse(await readFile(path.join(dir, 'schedules', `${created.id}.json`), 'utf8'))
    expect(onDisk).toEqual(created)
    expect(await store.get(created.id)).toEqual(created)
  })

  it('returns null for unknown or invalid ids', async () => {
    expect(await store.get('0'.repeat(32))).toBeNull()
    expect(await store.get('../x')).toBeNull()
  })
})

describe('list', () => {
  it('returns [] when the folder does not exist', async () => {
    expect(await store.list()).toEqual([])
    expect(await store.listDue()).toEqual([])
  })

  it('sorts upcoming schedules first and skips corrupt files', async () => {
    const later = store.create({ message: 'Later', rule: rule() }, new Date('2026-11-01T00:00:00Z'))
    const sooner = store.create({ message: 'Sooner', rule: rule({ time: '07:00' }) }, new Date('2026-11-01T00:00:00Z'))
    const done = store.create({ message: 'Done', rule: { kind: 'once', at: '2026-01-01T00:00:00Z' } }, new Date('2026-11-01T00:00:00Z'))
    await store.save(later)
    await store.save(sooner)
    await store.save(done)
    await writeRaw('broken.json', '{not json')

    const list = await store.list()
    expect(list.map((s) => s.message)).toEqual(['Sooner', 'Later', 'Done'])
    expect(list[2].nextRunAt).toBeNull()
  })

  it('only lists enabled schedules that are due for listDue', async () => {
    const due = store.create({ message: 'Due', rule: rule({ time: '08:00' }) }, new Date('2026-11-01T00:00:00Z'))
    const paused = store.create({ message: 'Paused', rule: rule({ time: '08:00' }) }, new Date('2026-11-01T00:00:00Z'))
    const future = store.create({ message: 'Future', rule: rule({ time: '12:00' }) }, new Date('2026-11-01T00:00:00Z'))
    await store.save(due)
    await store.save(paused)
    await store.save(future)

    const p = (await store.get(paused.id))!
    p.enabled = false
    await store.save(p)

    const dueNow = await store.listDue(new Date('2026-11-01T09:30:00Z'))
    expect(dueNow.map((s) => s.message)).toEqual(['Due'])
  })
})

describe('delete', () => {
  it('removes the file and reports success', async () => {
    const created = store.create({ message: 'Gone', rule: rule() })
    await store.save(created)
    expect(await store.delete(created.id)).toBe(true)
    expect(existsSync(path.join(dir, 'schedules', `${created.id}.json`))).toBe(false)
    expect(await store.delete(created.id)).toBe(false)
    expect(await store.delete('../x')).toBe(false)
  })
})

describe('getScheduledStore', () => {
  it('returns one store per data directory', () => {
    expect(getScheduledStore(dir)).toBe(getScheduledStore(dir))
    expect(getScheduledStore(dir)).not.toBe(getScheduledStore(path.join(dir, 'other')))
  })
})
