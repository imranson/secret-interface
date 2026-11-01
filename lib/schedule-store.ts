import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getConfig } from './config'
import { nextRunAtFromRule, parseRule } from './schedule'
import { THINK_OPTIONS, type ScheduledMessage, type ScheduleRule, type ThinkOption } from './types'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function newScheduleId(): string {
  return randomUUID().replace(/-/g, '')
}

export function isValidScheduleId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id)
}

function normalize(raw: unknown, id: string): ScheduledMessage | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.message !== 'string') return null
  let rule: ScheduleRule
  try {
    rule = parseRule(obj.rule)
  } catch {
    return null
  }
  const think = THINK_OPTIONS.includes(obj.think as ThinkOption) ? (obj.think as ThinkOption) : undefined
  return {
    id,
    message: obj.message,
    rule,
    model: typeof obj.model === 'string' && obj.model ? obj.model : undefined,
    think,
    timezone: typeof obj.timezone === 'string' && obj.timezone ? obj.timezone : undefined,
    conversationId: typeof obj.conversationId === 'string' && obj.conversationId ? obj.conversationId : null,
    enabled: obj.enabled !== false,
    nextRunAt: typeof obj.nextRunAt === 'string' && obj.nextRunAt ? obj.nextRunAt : null,
    lastRunAt: typeof obj.lastRunAt === 'string' && obj.lastRunAt ? obj.lastRunAt : null,
    lastConversationId: typeof obj.lastConversationId === 'string' && obj.lastConversationId ? obj.lastConversationId : null,
    unread: obj.unread === true,
    lastError: typeof obj.lastError === 'string' && obj.lastError ? obj.lastError : null,
    created_at: typeof obj.created_at === 'string' ? obj.created_at : new Date(0).toISOString(),
    updated_at: typeof obj.updated_at === 'string' ? obj.updated_at : new Date(0).toISOString(),
  }
}

/** Upcoming schedules first, then those with no next run (completed/failed) newest first. */
function compareSchedules(a: ScheduledMessage, b: ScheduledMessage): number {
  const an = a.nextRunAt ? new Date(a.nextRunAt).getTime() : Number.POSITIVE_INFINITY
  const bn = b.nextRunAt ? new Date(b.nextRunAt).getTime() : Number.POSITIVE_INFINITY
  if (an !== bn) return an - bn
  return b.created_at.localeCompare(a.created_at)
}

export interface CreateScheduleParams {
  message: string
  rule: ScheduleRule
  model?: string
  think?: ThinkOption
  timezone?: string
  conversationId?: string | null
}

/**
 * File-based store for scheduled messages: `<dataDir>/schedules/<id>.json`.
 */
export class ScheduledStore {
  readonly dir: string

  constructor(readonly dataDir: string) {
    this.dir = path.join(dataDir, 'schedules')
  }

  fileFor(id: string): string {
    if (!isValidScheduleId(id)) throw new Error(`Invalid schedule id: ${id}`)
    return path.join(this.dir, `${id}.json`)
  }

  create(params: CreateScheduleParams, now: Date = new Date()): ScheduledMessage {
    const iso = now.toISOString()
    return {
      id: newScheduleId(),
      message: params.message,
      rule: params.rule,
      model: params.model,
      think: params.think,
      timezone: params.timezone,
      conversationId: params.conversationId ?? null,
      enabled: true,
      nextRunAt: nextRunAtFromRule(params.rule, now),
      lastRunAt: null,
      lastConversationId: null,
      unread: false,
      lastError: null,
      created_at: iso,
      updated_at: iso,
    }
  }

  async list(): Promise<ScheduledMessage[]> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(this.dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const schedules: ScheduledMessage[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const id = entry.name.slice(0, -'.json'.length)
      if (!isValidScheduleId(id)) continue
      try {
        const schedule = normalize(JSON.parse(await fs.readFile(this.fileFor(id), 'utf8')), id)
        if (schedule) schedules.push(schedule)
      } catch (error) {
        console.warn(`Skipping unreadable schedule ${id}:`, (error as Error).message)
      }
    }
    return schedules.sort(compareSchedules)
  }

  async get(id: string): Promise<ScheduledMessage | null> {
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

  async save(schedule: ScheduledMessage): Promise<void> {
    const file = this.fileFor(schedule.id)
    await fs.mkdir(this.dir, { recursive: true })
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(schedule, null, 2), 'utf8')
    await fs.rename(tmp, file)
  }

  async delete(id: string): Promise<boolean> {
    if (!isValidScheduleId(id)) return false
    try {
      await fs.unlink(this.fileFor(id))
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  /** Enabled schedules whose next run is due at or before `now`. */
  async listDue(now: Date = new Date()): Promise<ScheduledMessage[]> {
    const time = now.getTime()
    return (await this.list()).filter(
      (s) => s.enabled && s.nextRunAt !== null && new Date(s.nextRunAt).getTime() <= time,
    )
  }
}

const stores = new Map<string, ScheduledStore>()

export function getScheduledStore(dataDir: string = getConfig().dataDir): ScheduledStore {
  let store = stores.get(dataDir)
  if (!store) {
    store = new ScheduledStore(dataDir)
    stores.set(dataDir, store)
  }
  return store
}
