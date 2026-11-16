import { randomUUID } from 'node:crypto'
import { getDb, type Database } from './db'
import { isRunning } from './run-state'
import { nextRunAt, parseRule, scheduleStatus } from './schedule'
import { deriveTitle } from './title'
import {
  isBackend,
  THINK_OPTIONS,
  type Backend,
  type Schedule,
  type ScheduleRule,
  type ScheduleView,
  type ThinkOption,
} from './types'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function isValidScheduleId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id)
}

export function toScheduleView(schedule: Schedule): ScheduleView {
  const { userId: _userId, ...rest } = schedule
  return { ...rest, status: scheduleStatus(schedule, isRunning(schedule.id)) }
}

const optionalString = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

/**
 * Rebuilds a schedule from stored data (a database row's `data`, or a file older versions wrote), or returns null if
 * it isn't one.
 */
export function normalizeSchedule(raw: unknown, id: string, userId: string): Schedule | null {
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
    userId,
    title: optionalString(obj.title) ?? deriveTitle(obj.prompt),
    prompt: obj.prompt,
    rule,
    model: optionalString(obj.model) ?? undefined,
    backend: isBackend(obj.backend) ? obj.backend : undefined,
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

interface ScheduleRow {
  id: string
  user_id: string
  data: unknown
}

function fromRow(row: ScheduleRow): Schedule | null {
  const schedule = normalizeSchedule(row.data, row.id, row.user_id)
  if (!schedule) console.warn(`Skipping unreadable schedule ${row.id}`)
  return schedule
}

function rowParams(schedule: Schedule): unknown[] {
  if (!isValidScheduleId(schedule.id)) throw new Error(`Invalid schedule id: ${schedule.id}`)
  const { id, userId, ...data } = schedule
  return [id, userId, JSON.stringify(data), schedule.created_at]
}

const INSERT = 'INSERT INTO schedules (id, user_id, data, created_at) VALUES ($1, $2, $3::jsonb, $4)'

// Route handlers and the background scheduler are bundled separately and each get their own copy of this module,
// so the queue lives on globalThis or it wouldn't serialise anything between them.
const QUEUE = Symbol.for('secret-interface.schedule-writes')
const shared = globalThis as { [QUEUE]?: Promise<unknown> }

/**
 * Schedules, in the `schedules` table. Methods that take a `userId` only see that user's schedules; without one they
 * see everyone's, which is for the background scheduler. Schedules saved before accounts existed are left out until
 * the first account claims them.
 */
export class ScheduleStore {
  constructor(private readonly db: Database) {}

  create(
    init: { userId: string; prompt: string; rule: ScheduleRule; model?: string; backend?: Backend; think?: ThinkOption },
    now = new Date(),
  ): Schedule {
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

  async get(id: string, userId?: string): Promise<Schedule | null> {
    if (!isValidScheduleId(id)) return null
    const [row] =
      userId === undefined
        ? await this.db.query<ScheduleRow>('SELECT id, user_id, data FROM schedules WHERE id = $1 AND user_id IS NOT NULL', [id])
        : await this.db.query<ScheduleRow>('SELECT id, user_id, data FROM schedules WHERE id = $1 AND user_id = $2', [id, userId])
    return row ? fromRow(row) : null
  }

  async list(userId?: string): Promise<Schedule[]> {
    const rows =
      userId === undefined
        ? await this.db.query<ScheduleRow>('SELECT id, user_id, data FROM schedules WHERE user_id IS NOT NULL')
        : await this.db.query<ScheduleRow>('SELECT id, user_id, data FROM schedules WHERE user_id = $1', [userId])
    return rows
      .map(fromRow)
      .filter((s): s is Schedule => s !== null)
      .sort(compare)
  }

  /** Inserts or replaces the schedule. Throws if its id belongs to another user's schedule. */
  async save(schedule: Schedule): Promise<void> {
    const rows = await this.db.query(
      `${INSERT} ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
      WHERE schedules.user_id = EXCLUDED.user_id RETURNING id`,
      rowParams(schedule),
    )
    if (rows.length === 0) throw new Error(`Schedule ${schedule.id} belongs to another account`)
  }

  /** Adds a schedule unless one with its id is already stored. True if it was added. */
  async importSchedule(schedule: Schedule): Promise<boolean> {
    return (await this.db.query(`${INSERT} ON CONFLICT (id) DO NOTHING RETURNING id`, rowParams(schedule))).length > 0
  }

  /** Runs writes to existing schedules one at a time. */
  private enqueue<T>(write: () => Promise<T>): Promise<T> {
    const result = (shared[QUEUE] ?? Promise.resolve()).then(write)
    shared[QUEUE] = result.catch(() => {})
    return result
  }

  /**
   * Applies `change` to the latest stored copy, so marking a report read while a run finishes can't lose either
   * update. Returns null if the schedule no longer exists (or isn't `userId`'s).
   */
  update(id: string, change: (schedule: Schedule) => void, userId?: string): Promise<Schedule | null> {
    return this.enqueue(async () => {
      const schedule = await this.get(id, userId)
      if (!schedule) return null
      change(schedule)
      schedule.updated_at = new Date().toISOString()
      await this.save(schedule)
      return schedule
    })
  }

  /** Queued with updates, or a run finishing as it is cancelled could write a deleted schedule back. */
  delete(id: string, userId?: string): Promise<boolean> {
    if (!isValidScheduleId(id)) return Promise.resolve(false)
    return this.enqueue(async () => {
      const rows =
        userId === undefined
          ? await this.db.query('DELETE FROM schedules WHERE id = $1 RETURNING id', [id])
          : await this.db.query('DELETE FROM schedules WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId])
      return rows.length > 0
    })
  }
}

export function getScheduleStore(): ScheduleStore {
  return new ScheduleStore(getDb())
}
