import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getConfig } from './config'
import { isRunning } from './run-state'
import { nextRunAt, parseRule, scheduleStatus } from './schedule'
import { deriveTitle } from './title'
import { THINK_OPTIONS, type Schedule, type ScheduleRule, type ScheduleView, type ThinkOption } from './types'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function isValidScheduleId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id)
}

export function toScheduleView(schedule: Schedule): ScheduleView {
  return { ...schedule, status: scheduleStatus(schedule, isRunning(schedule.id)) }
}

const optionalString = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

/** Rebuilds a schedule from its file, or returns null if the file isn't one. */
function normalize(raw: unknown, id: string): Schedule | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.prompt !== 'string' || !obj.prompt) return null
  let rule: ScheduleRule
  try {
    rule = parseRule(obj.rule)
  } catch {
    return null
  }
  return {
    id,
    title: optionalString(obj.title) ?? deriveTitle(obj.prompt),
    prompt: obj.prompt,
    rule,
    model: optionalString(obj.model) ?? undefined,
    think: THINK_OPTIONS.includes(obj.think as ThinkOption) ? (obj.think as ThinkOption) : undefined,
    enabled: obj.enabled !== false,
    conversationId: optionalString(obj.conversationId),
    nextRunAt: optionalString(obj.nextRunAt),
    lastRunAt: optionalString(obj.lastRunAt),
    lastError: optionalString(obj.lastError),
    unread: obj.unread === true,
    created_at: optionalString(obj.created_at) ?? new Date(0).toISOString(),
    updated_at: optionalString(obj.updated_at) ?? new Date(0).toISOString(),
  }
}

/** Soonest run first; paused schedules, which have nothing coming up, sink to the end. */
function compare(a: Schedule, b: Schedule): number {
  const when = (s: Schedule) => (s.enabled && s.nextRunAt ? new Date(s.nextRunAt).getTime() : Number.POSITIVE_INFINITY)
  return when(a) - when(b) || b.created_at.localeCompare(a.created_at)
}

// Route handlers and the background scheduler are bundled separately and each get their own copy of this module,
// so the queue lives on globalThis or it wouldn't serialise anything between them.
const QUEUE = Symbol.for('secret-interface.schedule-writes')
const shared = globalThis as { [QUEUE]?: Promise<unknown> }

/** File-based schedule store: `<dataDir>/schedules/<id>.json`. */
export class ScheduleStore {
  readonly dir: string

  constructor(readonly dataDir: string) {
    this.dir = path.join(dataDir, 'schedules')
  }

  private fileFor(id: string): string {
    if (!isValidScheduleId(id)) throw new Error(`Invalid schedule id: ${id}`)
    return path.join(this.dir, `${id}.json`)
  }

  create(init: { prompt: string; rule: ScheduleRule; model?: string; think?: ThinkOption }, now = new Date()): Schedule {
    const iso = now.toISOString()
    return {
      ...init,
      id: randomUUID().replace(/-/g, ''),
      title: deriveTitle(init.prompt),
      enabled: true,
      conversationId: null,
      nextRunAt: nextRunAt(init.rule, now),
      lastRunAt: null,
      lastError: null,
      unread: false,
      created_at: iso,
      updated_at: iso,
    }
  }

  async get(id: string): Promise<Schedule | null> {
    if (!isValidScheduleId(id)) return null
    let text: string
    try {
      text = await fs.readFile(this.fileFor(id), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    return normalize(JSON.parse(text), id)
  }

  async list(): Promise<Schedule[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const ids = names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -'.json'.length))
    const schedules = await Promise.all(
      ids.filter(isValidScheduleId).map((id) =>
        this.get(id).catch((error) => {
          console.warn(`Skipping unreadable schedule ${id}:`, (error as Error).message)
          return null
        }),
      ),
    )
    return schedules.filter((s): s is Schedule => s !== null).sort(compare)
  }

  async save(schedule: Schedule): Promise<void> {
    const file = this.fileFor(schedule.id)
    await fs.mkdir(this.dir, { recursive: true })
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(schedule, null, 2), 'utf8')
    await fs.rename(tmp, file)
  }

  /** Runs writes to existing schedules one at a time. */
  private enqueue<T>(write: () => Promise<T>): Promise<T> {
    const result = (shared[QUEUE] ?? Promise.resolve()).then(write)
    shared[QUEUE] = result.catch(() => {})
    return result
  }

  /**
   * Applies `change` to the latest copy on disk, so marking a report read while a run finishes can't lose either
   * update. Returns null if the schedule no longer exists.
   */
  update(id: string, change: (schedule: Schedule) => void): Promise<Schedule | null> {
    return this.enqueue(async () => {
      const schedule = await this.get(id)
      if (!schedule) return null
      change(schedule)
      schedule.updated_at = new Date().toISOString()
      await this.save(schedule)
      return schedule
    })
  }

  /** Queued with updates, or a run finishing as it is cancelled could write a deleted schedule back. */
  delete(id: string): Promise<boolean> {
    if (!isValidScheduleId(id)) return Promise.resolve(false)
    return this.enqueue(async () => {
      try {
        await fs.unlink(this.fileFor(id))
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      }
    })
  }
}

const stores = new Map<string, ScheduleStore>()

export function getScheduleStore(dataDir: string = getConfig().dataDir): ScheduleStore {
  let store = stores.get(dataDir)
  if (!store) {
    store = new ScheduleStore(dataDir)
    stores.set(dataDir, store)
  }
  return store
}
