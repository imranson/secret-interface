import { describe, expect, it } from 'vitest'
import { countByStatus, describeRule, formatRunTime, nextRunAt, parseRule, scheduleStatus } from '@/lib/schedule'
import type { Schedule, ScheduleRule, ScheduleView } from '@/lib/types'

const schedule = (overrides: Partial<Schedule> = {}): Schedule => ({
  id: 'a',
  title: 'News',
  prompt: 'News',
  rule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
  enabled: true,
  conversationId: null,
  nextRunAt: '2026-11-03T09:00:00.000Z',
  lastRunAt: null,
  lastError: null,
  unread: false,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
  ...overrides,
})

describe('parseRule', () => {
  it('normalises each frequency', () => {
    expect(parseRule({ kind: 'daily', time: '09:00', timezone: 'Europe/London' })).toEqual({
      kind: 'daily',
      time: '09:00',
      timezone: 'Europe/London',
    })
    expect(parseRule({ kind: 'weekly', time: '08:30', timezone: 'UTC', weekdays: [3, 1, 1] }).weekdays).toEqual([1, 3])
    expect(parseRule({ kind: 'monthly', time: '07:00', timezone: 'UTC', dayOfMonth: 15 }).dayOfMonth).toBe(15)
  })

  it('falls back to UTC for an unknown time zone', () => {
    expect(parseRule({ kind: 'daily', time: '09:00', timezone: 'Mars/Olympus' }).timezone).toBe('UTC')
  })

  it.each([
    [null, /rule/],
    [{ kind: 'daily' }, /time/],
    [{ kind: 'daily', time: '25:00' }, /time/],
    [{ kind: 'sometimes', time: '09:00' }, /frequency/],
    [{ kind: 'weekly', time: '09:00' }, /day/],
    [{ kind: 'weekly', time: '09:00', weekdays: [7] }, /day/],
    [{ kind: 'monthly', time: '09:00' }, /1–31/],
    [{ kind: 'monthly', time: '09:00', dayOfMonth: 32 }, /1–31/],
  ])('rejects %j', (input, message) => {
    expect(() => parseRule(input)).toThrow(message)
  })
})

describe('nextRunAt', () => {
  const daily: ScheduleRule = { kind: 'daily', time: '09:00', timezone: 'UTC' }

  it('finds the next daily run, never the current instant', () => {
    expect(nextRunAt(daily, new Date('2026-11-01T08:00:00Z'))).toBe('2026-11-01T09:00:00.000Z')
    expect(nextRunAt(daily, new Date('2026-11-01T09:00:00Z'))).toBe('2026-11-02T09:00:00.000Z')
  })

  it('honours the chosen weekdays', () => {
    // 2026-11-02 is a Monday.
    const rule: ScheduleRule = { kind: 'weekly', time: '09:00', timezone: 'UTC', weekdays: [1, 3] }
    expect(nextRunAt(rule, new Date('2026-11-02T00:00:00Z'))).toBe('2026-11-02T09:00:00.000Z')
    expect(nextRunAt(rule, new Date('2026-11-02T10:00:00Z'))).toBe('2026-11-04T09:00:00.000Z')
  })

  it('uses the weekday in the rule’s time zone, not UTC', () => {
    // 23:00 on Monday in Los Angeles is already Tuesday in UTC.
    const rule: ScheduleRule = { kind: 'weekly', time: '23:00', timezone: 'America/Los_Angeles', weekdays: [1] }
    expect(nextRunAt(rule, new Date('2026-11-02T12:00:00Z'))).toBe('2026-11-03T07:00:00.000Z')
  })

  it('runs on the last day of months too short for the chosen day', () => {
    const rule: ScheduleRule = { kind: 'monthly', time: '09:00', timezone: 'UTC', dayOfMonth: 31 }
    expect(nextRunAt(rule, new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-30T09:00:00.000Z')
    expect(nextRunAt(rule, new Date('2027-02-01T00:00:00Z'))).toBe('2027-02-28T09:00:00.000Z')
  })

  it('crosses into the next year', () => {
    const rule: ScheduleRule = { kind: 'monthly', time: '09:00', timezone: 'UTC', dayOfMonth: 1 }
    expect(nextRunAt(rule, new Date('2026-12-15T00:00:00Z'))).toBe('2027-01-01T09:00:00.000Z')
  })

  it('keeps the same wall-clock time across daylight saving', () => {
    const rule: ScheduleRule = { kind: 'daily', time: '09:00', timezone: 'Europe/London' }
    expect(nextRunAt(rule, new Date('2026-03-28T12:00:00Z'))).toBe('2026-03-29T08:00:00.000Z')
    expect(nextRunAt(rule, new Date('2026-10-24T12:00:00Z'))).toBe('2026-10-25T09:00:00.000Z')
  })

  it('still runs once on a day when the chosen time does not exist or happens twice', () => {
    const skipped: ScheduleRule = { kind: 'daily', time: '01:30', timezone: 'Europe/London' }
    const spring = nextRunAt(skipped, new Date('2026-03-28T12:00:00Z'))!
    expect(spring.startsWith('2026-03-29')).toBe(true)
    const autumn = nextRunAt(skipped, new Date('2026-10-24T12:00:00Z'))!
    expect(autumn.startsWith('2026-10-25')).toBe(true)
    expect(nextRunAt(skipped, new Date(autumn))!.startsWith('2026-10-26')).toBe(true)
  })
})

describe('scheduleStatus', () => {
  it('follows a schedule through its life', () => {
    expect(scheduleStatus(schedule(), false)).toBe('scheduled')
    expect(scheduleStatus(schedule(), true)).toBe('running')
    expect(scheduleStatus(schedule({ lastRunAt: 'x', unread: true }), false)).toBe('unread')
    expect(scheduleStatus(schedule({ lastRunAt: 'x' }), false)).toBe('completed')
    expect(scheduleStatus(schedule({ enabled: false }), false)).toBe('paused')
    expect(scheduleStatus(schedule({ lastRunAt: 'x', lastError: 'boom' }), false)).toBe('failed')
  })

  it('does not hide a problem or news behind a lesser state', () => {
    expect(scheduleStatus(schedule({ lastError: 'boom', unread: true }), false)).toBe('failed')
    expect(scheduleStatus(schedule({ unread: true, enabled: false }), false)).toBe('unread')
  })

  it('counts schedules by status', () => {
    const views = ['unread', 'unread', 'scheduled'].map((status) => ({ status }) as ScheduleView)
    expect(countByStatus(views)).toMatchObject({ unread: 2, scheduled: 1, completed: 0 })
  })
})

describe('describeRule', () => {
  it.each<[ScheduleRule, string]>([
    [{ kind: 'daily', time: '09:00', timezone: 'UTC' }, 'Every day at 09:00'],
    [{ kind: 'weekly', time: '09:00', timezone: 'UTC', weekdays: [1, 2, 3, 4, 5] }, 'Weekdays at 09:00'],
    [{ kind: 'weekly', time: '09:00', timezone: 'UTC', weekdays: [0, 1, 2, 3, 4, 5, 6] }, 'Every day at 09:00'],
    [{ kind: 'weekly', time: '17:30', timezone: 'UTC', weekdays: [1, 3] }, 'Every Mon, Wed at 17:30'],
    [{ kind: 'monthly', time: '07:00', timezone: 'UTC', dayOfMonth: 15 }, 'Day 15 of each month at 07:00'],
  ])('describes %j', (rule, label) => {
    expect(describeRule(rule)).toBe(label)
  })
})

describe('formatRunTime', () => {
  const now = new Date(2026, 10, 2, 12, 0)

  it('uses relative names close to now and dates further out', () => {
    expect(formatRunTime(new Date(2026, 10, 2, 18, 5).toISOString(), now)).toBe('Today 18:05')
    expect(formatRunTime(new Date(2026, 10, 3, 9, 0).toISOString(), now)).toBe('Tomorrow 09:00')
    expect(formatRunTime(new Date(2026, 10, 1, 9, 0).toISOString(), now)).toBe('Yesterday 09:00')
    expect(formatRunTime(new Date(2026, 10, 10, 9, 0).toISOString(), now)).toBe('Tue 10 Nov, 09:00')
  })
})
