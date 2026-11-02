import type { Schedule, ScheduleRule, ScheduleStatus, ScheduleView } from './types'

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = [1, 2, 3, 4, 5]
/** Far enough ahead to reach any weekday or day of the month. */
const SEARCH_DAYS = 370

function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** Validates a rule from the API or disk. Throws with a user-facing message on bad input. */
export function parseRule(input: unknown): ScheduleRule {
  if (typeof input !== 'object' || input === null) throw new Error('A schedule rule is required')
  const { kind, time, timezone, weekdays, dayOfMonth } = input as Record<string, unknown>
  if (typeof time !== 'string' || !TIME_PATTERN.test(time)) throw new Error('Pick a time (HH:MM)')
  const zone = isValidTimeZone(timezone) ? timezone : 'UTC'
  switch (kind) {
    case 'daily':
      return { kind, time, timezone: zone }
    case 'weekly': {
      const days = Array.isArray(weekdays) ? weekdays : []
      if (days.length === 0 || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
        throw new Error('Pick at least one day')
      }
      return { kind, time, timezone: zone, weekdays: [...new Set<number>(days)].sort((a, b) => a - b) }
    }
    case 'monthly':
      if (!Number.isInteger(dayOfMonth) || (dayOfMonth as number) < 1 || (dayOfMonth as number) > 31) {
        throw new Error('Day of the month must be 1–31')
      }
      return { kind, time, timezone: zone, dayOfMonth: dayOfMonth as number }
    default:
      throw new Error('Unknown schedule frequency')
  }
}

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

/** `date` as read off a clock in `timeZone`. */
function wallClock(date: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  }).formatToParts(date)
  const text = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    year: Number(text('year')),
    month: Number(text('month')),
    day: Number(text('day')),
    hour: Number(text('hour')) % 24,
    minute: Number(text('minute')),
    weekday: DAY_NAMES.indexOf(text('weekday')),
  }
}

/** The instant a clock in `timeZone` shows this time. Overflowing `day` rolls into later months. */
function wallToInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const target = Date.UTC(year, month - 1, day, hour, minute)
  let instant = target
  // Converges in a couple of steps; repeating covers a daylight-saving change between the guess and the answer.
  for (let i = 0; i < 4; i++) {
    const shown = wallClock(new Date(instant), timeZone)
    const offset = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute) - instant
    instant = target - offset
  }
  return instant
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** The first run strictly after `after`. Missed runs are never replayed: an overdue schedule runs once, then moves on. */
export function nextRunAt(rule: ScheduleRule, after: Date): string | null {
  const [hour, minute] = rule.time.split(':').map(Number)
  const start = wallClock(after, rule.timezone)
  for (let offset = 0; offset <= SEARCH_DAYS; offset++) {
    const instant = wallToInstant(start.year, start.month, start.day + offset, hour, minute, rule.timezone)
    if (instant <= after.getTime()) continue
    const wall = wallClock(new Date(instant), rule.timezone)
    if (rule.kind === 'weekly' && !rule.weekdays?.includes(wall.weekday)) continue
    if (rule.kind === 'monthly') {
      const runDay = Math.min(rule.dayOfMonth ?? 1, lastDayOfMonth(wall.year, wall.month))
      if (wall.day !== runDay) continue
    }
    return new Date(instant).toISOString()
  }
  return null
}

/** What the schedule picker edits; `weekdays` and `dayOfMonth` only apply to their own frequency. */
export interface ScheduleDraft {
  frequency: 'daily' | 'weekdays' | 'weekly' | 'monthly'
  time: string
  weekdays: number[]
  dayOfMonth: number
}

export function defaultScheduleDraft(now: Date = new Date()): ScheduleDraft {
  return { frequency: 'daily', time: '09:00', weekdays: [now.getDay()], dayOfMonth: now.getDate() }
}

/** The rule a draft describes, or null while it is incomplete. */
export function ruleFromDraft(draft: ScheduleDraft, timezone: string): ScheduleRule | null {
  const { frequency, time, weekdays, dayOfMonth } = draft
  try {
    if (frequency === 'daily') return parseRule({ kind: 'daily', time, timezone })
    if (frequency === 'monthly') return parseRule({ kind: 'monthly', time, timezone, dayOfMonth })
    return parseRule({ kind: 'weekly', time, timezone, weekdays: frequency === 'weekdays' ? WEEKDAYS : weekdays })
  } catch {
    return null
  }
}

/** One status per schedule, most urgent first: a problem outranks news, and news outranks being paused. */
export function scheduleStatus(schedule: Schedule, running: boolean): ScheduleStatus {
  if (running) return 'running'
  if (schedule.lastError) return 'failed'
  if (schedule.unread) return 'unread'
  if (!schedule.enabled) return 'paused'
  return schedule.lastRunAt ? 'completed' : 'scheduled'
}

export function countByStatus(schedules: ScheduleView[]): Record<ScheduleStatus, number> {
  const counts: Record<ScheduleStatus, number> = { scheduled: 0, running: 0, unread: 0, completed: 0, failed: 0, paused: 0 }
  for (const schedule of schedules) counts[schedule.status]++
  return counts
}

/** `Every day at 09:00`, `Weekdays at 09:00`, `Every Mon, Wed at 17:30`, `Day 15 of each month at 07:00`. */
export function describeRule(rule: ScheduleRule): string {
  if (rule.kind === 'daily') return `Every day at ${rule.time}`
  if (rule.kind === 'monthly') return `Day ${rule.dayOfMonth} of each month at ${rule.time}`
  const days = rule.weekdays ?? []
  if (days.length === 7) return `Every day at ${rule.time}`
  if (days.length === WEEKDAYS.length && WEEKDAYS.every((d) => days.includes(d))) return `Weekdays at ${rule.time}`
  return `Every ${days.map((d) => DAY_NAMES[d]).join(', ')} at ${rule.time}`
}

/** `Today 09:00`, `Tomorrow 09:00` or `Tue 10 Nov, 09:00`, in the viewer's time zone. */
export function formatRunTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  // Rounded because a day with a daylight-saving change isn't exactly 24 hours long.
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000)
  if (days === 0) return `Today ${clock}`
  if (days === 1) return `Tomorrow ${clock}`
  if (days === -1) return `Yesterday ${clock}`
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}, ${clock}`
}
