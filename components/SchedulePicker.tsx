'use client'

import { DAY_NAMES, describeRule, formatRunTime, nextRunAt, ruleFromDraft, type ScheduleDraft } from '@/lib/schedule'

const FREQUENCIES: { value: ScheduleDraft['frequency']; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

export interface SchedulePickerProps {
  draft: ScheduleDraft
  timezone: string
  onChange: (draft: ScheduleDraft) => void
}

export function SchedulePicker({ draft, timezone, onChange }: SchedulePickerProps) {
  const rule = ruleFromDraft(draft, timezone)
  const next = rule && nextRunAt(rule, new Date())

  const toggleDay = (day: number) => {
    const weekdays = draft.weekdays.includes(day) ? draft.weekdays.filter((d) => d !== day) : [...draft.weekdays, day]
    onChange({ ...draft, weekdays })
  }

  return (
    <div className="schedule-picker" role="group" aria-label="Schedule">
      <div className="schedule-row">
        <div className="schedule-options" role="group" aria-label="Repeat">
          {FREQUENCIES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className="schedule-option"
              aria-pressed={draft.frequency === value}
              onClick={() => onChange({ ...draft, frequency: value })}
            >
              {label}
            </button>
          ))}
        </div>
        {draft.frequency === 'monthly' && (
          <label className="schedule-field">
            on day
            <input
              type="number"
              min={1}
              max={31}
              value={draft.dayOfMonth || ''}
              onChange={(e) => onChange({ ...draft, dayOfMonth: e.target.valueAsNumber || 0 })}
            />
          </label>
        )}
        <label className="schedule-field">
          at
          <input
            type="time"
            aria-label="Time"
            value={draft.time}
            onChange={(e) => onChange({ ...draft, time: e.target.value })}
          />
        </label>
      </div>
      {draft.frequency === 'weekly' && (
        <div className="schedule-options" role="group" aria-label="Days">
          {DAY_NAMES.map((name, day) => (
            <button
              key={name}
              type="button"
              className="schedule-option"
              aria-pressed={draft.weekdays.includes(day)}
              onClick={() => toggleDay(day)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <p className="schedule-preview" role="status">
        {rule && next ? `${describeRule(rule)}. First run: ${formatRunTime(next)}.` : 'Pick when this should run.'}
      </p>
    </div>
  )
}
