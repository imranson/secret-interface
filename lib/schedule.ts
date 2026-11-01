import type { ScheduleKind, ScheduleRule, ScheduledMessage, ScheduleStatus } from './types'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const KINDS: readonly ScheduleKind[] = ['once', 'daily', 'weekly', 'monthly']
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY = new Map(DAY_NAMES.map((name, i) => [name, i]))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isValidScheduleKind(value: unknown): value is ScheduleKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value)
}

export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value)
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** Validates and normalises a rule from the API. Throws with a user-facing message on bad input. */
export function parseRule(rule: unknown): ScheduleRule {
  if (!isRecord(rule)) throw new Error('A schedule rule is required')
  const kind = rule.kind
  if (!isValidScheduleKind(kind)) throw new Error('Unknown schedule kind')

  if (kind === 'once') {
    const at = rule.at
    if (typeof at !== 'string' || Number.isNaN(new Date(at).getTime())) {
      throw new Error('A valid date and time is required')
    }
    return { kind: 'once', at: new Date(at).toISOString() }
  }

  if (!isValidTime(rule.time)) throw new Error('A valid time (HH:MM) is required')
  const timezone = typeof rule.timezone === 'string' && isValidTimeZone(rule.timezone) ? rule.timezone : undefined

  if (kind === 'daily') return { kind, time: rule.time as string, timezone }

  if (kind === 'weekly') {
    const weekdays = rule.weekdays
    if (
      !Array.isArray(weekdays) ||
      weekdays.length === 0 ||
      !weekdays.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)
    ) {
      throw new Error('Pick at least one weekday')
    }
    return { kind, time: rule.time as string, timezone, weekdays: [...new Set(weekdays as number[])].sort((a, b) => a - b) }
  }

  const dayOfMonth = rule.dayOfMonth
  if (!Number.isInteger(dayOfMonth) || (dayOfMonth as number) < 1 || (dayOfMonth as number) > 31) {
    throw new Error('Day of month must be 1–31')
  }
  return { kind, time: rule.time as string, timezone, dayOfMonth: dayOfMonth as number }
}

interface WallClock {
  y: number
  m: number
  d: number
  hh: number
  mm: number
  weekday: number
}

function formatter(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  })
}

/** The wall-clock parts of `date` in `tz`, with the weekday as 0 (Sun) … 6 (Sat). */
function wallClock(date: Date, tz: string): WallClock {
  const parts = formatter(tz).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return {
    y: get('year'),
    m: get('month'),
    d: get('day'),
    hh: get('hour') % 24,
    mm: get('minute'),
    weekday: WEEKDAY.get(parts.find((p) => p.type === 'weekday')?.value ?? '') ?? 0,
  }
}

/** The UTC offset (ms) of `tz` at `instant` — positive when the zone is ahead of UTC. */
function offsetAt(instant: number, tz: string): number {
  const w = wallClock(new Date(instant), tz)
  return Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, 0) - instant
}

/** Converts a wall-clock time in `tz` to a UTC instant (DST-correct). */
function wallToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm, 0)
  let ms = wallAsUtc
  for (let i = 0; i < 4; i++) ms = wallAsUtc - offsetAt(ms, tz)
  return ms
}

/**
 * The next absolute run time for `rule` strictly after `after`, or null when it has none
 * (a one-off already in the past, or an unsatisfiable monthly day). Recurring rules never
 * "catch up": an overdue run fires once, then the schedule moves to the next occurrence.
 */
export function nextRunAtFromRule(rule: ScheduleRule, after: Date): string | null {
  if (rule.kind === 'once') {
    if (!rule.at) return null
    const at = new Date(rule.at).getTime()
    return at > after.getTime() ? new Date(at).toISOString() : null
  }
  if (!isValidTime(rule.time)) return null
  const tz = rule.timezone && isValidTimeZone(rule.timezone) ? rule.timezone : 'UTC'
  const [hh, mm] = (rule.time as string).split(':').map(Number)
  const start = wallClock(after, tz)
  const horizon = rule.kind === 'monthly' ? 400 : 370
  for (let offset = 0; offset <= horizon; offset++) {
    const utc = wallToUtc(start.y, start.m, start.d + offset, hh, mm, tz)
    if (utc <= after.getTime()) continue
    const wall = wallClock(new Date(utc), tz)
    if (rule.kind === 'weekly' && !(rule.weekdays ?? []).includes(wall.weekday)) continue
    if (rule.kind === 'monthly' && wall.d !== rule.dayOfMonth) continue
    return new Date(utc).toISOString()
  }
  return null
}

export function scheduleStatus(schedule: ScheduledMessage): ScheduleStatus {
  if (!schedule.enabled) return 'paused'
  if (schedule.nextRunAt === null) return schedule.lastError ? 'error' : 'completed'
  return 'scheduled'
}

/** `09:05` → `9:05 AM`. */
export function formatClock(time: string): string {
  if (!isValidTime(time)) return time
  const [h, m] = time.split(':').map(Number)
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** A short human description of when a schedule runs (local time for one-offs). */
export function scheduleLabel(rule: ScheduleRule): string {
  if (rule.kind === 'once') {
    if (!rule.at) return 'One time'
    const date = new Date(rule.at)
    return Number.isNaN(date.getTime()) ? 'One time' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  }
  const time = rule.time ? `at ${formatClock(rule.time)}` : ''
  if (rule.kind === 'daily') return `Every day ${time}`.trim()
  if (rule.kind === 'weekly') {
    const days = (rule.weekdays ?? []).map((d) => DAY_NAMES[d]).join(', ')
    return `Every ${days} ${time}`.trim()
  }
  return `Day ${rule.dayOfMonth} of every month ${time}`.trim()
}
