import { describe, expect, it } from 'vitest'
import { formatClock, isValidTime, nextRunAtFromRule, parseRule, scheduleLabel, scheduleStatus } from '@/lib/schedule'
import type { ScheduledMessage, ScheduleRule } from '@/lib/types'

const schedule = (overrides: Partial<ScheduledMessage> = {}): ScheduledMessage => ({
  id: 'a'.repeat(32),
  message: 'ping',
  rule: { kind: 'daily', time: '09:00' },
  enabled: true,
  nextRunAt: '2026-11-02T09:00:00.000Z',
  lastRunAt: null,
  lastConversationId: null,
  unread: false,
  lastError: null,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
  ...overrides,
})

describe('parseRule', () => {
  it('parses a one-off with an absolute time', () => {
    expect(parseRule({ kind: 'once', at: '2026-11-05T15:00:00Z' })).toEqual({
      kind: 'once',
      at: '2026-11-05T15:00:00.000Z',
    })
  })

  it('parses recurring kinds and normalises weekly weekdays', () => {
    expect(parseRule({ kind: 'daily', time: '09:00', timezone: 'Europe/London' })).toEqual({
      kind: 'daily',
      time: '09:00',
      timezone: 'Europe/London',
    })
    expect(parseRule({ kind: 'weekly', time: '08:30', weekdays: [3, 1, 1] })).toEqual({
      kind: 'weekly',
      time: '08:30',
      timezone: undefined,
      weekdays: [1, 3],
    })
    expect(parseRule({ kind: 'monthly', time: '07:00', dayOfMonth: 15 })).toEqual({
      kind: 'monthly',
      time: '07:00',
      timezone: undefined,
      dayOfMonth: 15,
    })
  })

  it('rejects invalid input', () => {
    expect(() => parseRule(null)).toThrow()
    expect(() => parseRule({ kind: 'sometimes' })).toThrow(/Unknown schedule kind/)
    expect(() => parseRule({ kind: 'once', at: 'not a date' })).toThrow(/date and time/)
    expect(() => parseRule({ kind: 'daily' })).toThrow(/HH:MM/)
    expect(() => parseRule({ kind: 'daily', time: '25:00' })).toThrow(/HH:MM/)
    expect(() => parseRule({ kind: 'weekly', time: '09:00' })).toThrow(/weekday/)
    expect(() => parseRule({ kind: 'weekly', time: '09:00', weekdays: [7] })).toThrow(/weekday/)
    expect(() => parseRule({ kind: 'monthly', time: '09:00' })).toThrow(/Day of month/)
    expect(() => parseRule({ kind: 'monthly', time: '09:00', dayOfMonth: 0 })).toThrow(/Day of month/)
  })

  it('drops an invalid time zone so the rule falls back to UTC', () => {
    expect(parseRule({ kind: 'daily', time: '09:00', timezone: 'Mars/Olympus' })).toEqual({
      kind: 'daily',
      time: '09:00',
      timezone: undefined,
    })
  })
})

describe('nextRunAtFromRule', () => {
  it('returns a one-off time only while it is still in the future', () => {
    const rule = { kind: 'once', at: '2026-11-05T15:00:00Z' } as const
    expect(nextRunAtFromRule(rule, new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-05T15:00:00.000Z')
    expect(nextRunAtFromRule(rule, new Date('2026-11-06T00:00:00Z'))).toBeNull()
  })

  it('finds the next daily occurrence after the given instant', () => {
    const rule = { kind: 'daily', time: '09:00', timezone: 'UTC' } as const
    expect(nextRunAtFromRule(rule, new Date('2026-11-01T08:00:00Z'))).toBe('2026-11-01T09:00:00.000Z')
    expect(nextRunAtFromRule(rule, new Date('2026-11-01T10:00:00Z'))).toBe('2026-11-02T09:00:00.000Z')
  })

  it('honours the chosen weekdays', () => {
    // 2026-11-02 is a Monday, 2026-11-04 is a Wednesday.
    const rule: ScheduleRule = { kind: 'weekly', time: '09:00', timezone: 'UTC', weekdays: [1, 3] }
    expect(nextRunAtFromRule(rule, new Date('2026-11-02T00:00:00Z'))).toBe('2026-11-02T09:00:00.000Z')
    expect(nextRunAtFromRule(rule, new Date('2026-11-02T10:00:00Z'))).toBe('2026-11-04T09:00:00.000Z')
  })

  it('finds the next day-of-month, skipping months without that day', () => {
    const rule = { kind: 'monthly', time: '09:00', timezone: 'UTC', dayOfMonth: 31 } as const
    // November has 30 days, so the next run after Nov 1 is Dec 31.
    expect(nextRunAtFromRule(rule, new Date('2026-11-01T00:00:00Z'))).toBe('2026-12-31T09:00:00.000Z')
  })

  it('tracks daylight-saving transitions in the rule time zone', () => {
    const rule = { kind: 'daily', time: '09:00', timezone: 'America/New_York' } as const
    // 2026-03-08 09:00 EDT (UTC-4) and 2026-11-01 09:00 EST (UTC-5).
    expect(nextRunAtFromRule(rule, new Date('2026-03-07T20:00:00Z'))).toBe('2026-03-08T13:00:00.000Z')
    expect(nextRunAtFromRule(rule, new Date('2026-10-31T20:00:00Z'))).toBe('2026-11-01T14:00:00.000Z')
  })

  it('never returns a time at or before the given instant', () => {
    const rule = { kind: 'daily', time: '09:00', timezone: 'UTC' } as const
    const next = nextRunAtFromRule(rule, new Date('2026-11-01T09:00:00Z'))
    expect(next).toBe('2026-11-02T09:00:00.000Z')
  })
})

describe('scheduleStatus', () => {
  it('classifies the four states', () => {
    expect(scheduleStatus(schedule())).toBe('scheduled')
    expect(scheduleStatus(schedule({ nextRunAt: null }))).toBe('completed')
    expect(scheduleStatus(schedule({ nextRunAt: null, lastError: 'boom' }))).toBe('error')
    expect(scheduleStatus(schedule({ enabled: false }))).toBe('paused')
  })
})

describe('formatClock', () => {
  it('renders 24-hour times as 12-hour', () => {
    expect(formatClock('09:00')).toBe('9:00 AM')
    expect(formatClock('17:30')).toBe('5:30 PM')
    expect(formatClock('00:00')).toBe('12:00 AM')
    expect(formatClock('12:00')).toBe('12:00 PM')
  })
})

describe('scheduleLabel', () => {
  it('describes recurring rules', () => {
    expect(scheduleLabel({ kind: 'daily', time: '09:00' })).toBe('Every day at 9:00 AM')
    expect(scheduleLabel({ kind: 'weekly', time: '17:30', weekdays: [1, 3] })).toBe('Every Mon, Wed at 5:30 PM')
    expect(scheduleLabel({ kind: 'monthly', time: '09:00', dayOfMonth: 15 })).toBe('Day 15 of every month at 9:00 AM')
  })

  it('falls back for a one-off without a time', () => {
    expect(scheduleLabel({ kind: 'once' })).toBe('One time')
    expect(scheduleLabel({ kind: 'once', at: 'not a date' })).toBe('One time')
  })
})

describe('isValidTime', () => {
  it('accepts only HH:MM values', () => {
    expect(isValidTime('09:00')).toBe(true)
    expect(isValidTime('23:59')).toBe(true)
    expect(isValidTime('9:00')).toBe(false)
    expect(isValidTime('24:00')).toBe(false)
    expect(isValidTime('09:60')).toBe(false)
  })
})
