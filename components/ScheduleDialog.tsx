'use client'

import { useEffect, useRef, useState } from 'react'
import type { ConversationSummary, ScheduleKind, ScheduleRule, ThinkOption } from '@/lib/types'

export interface ScheduleDraft {
  message: string
  rule: ScheduleRule
  timezone: string
  conversationId: string | null
  model?: string
  think?: ThinkOption
}

export interface ScheduleDialogProps {
  open: boolean
  initialMessage?: string
  conversations: ConversationSummary[]
  model: string
  think: ThinkOption
  onClose: () => void
  onCreate: (draft: ScheduleDraft) => void
}

const KINDS: { value: ScheduleKind; label: string }[] = [
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
]

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Tomorrow at 9:00 AM, local time, as a `datetime-local` value. */
function defaultAt(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000)
  d.setHours(9, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ScheduleDialog({ open, initialMessage, conversations, model, think, onClose, onCreate }: ScheduleDialogProps) {
  const [message, setMessage] = useState('')
  const [kind, setKind] = useState<ScheduleKind>('once')
  const [at, setAt] = useState(defaultAt)
  const [time, setTime] = useState('09:00')
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [dayOfMonth, setDayOfMonth] = useState(1)
  const [conversationId, setConversationId] = useState('')
  const messageRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    setMessage(initialMessage ?? '')
    setKind('once')
    setAt(defaultAt())
    setTime('09:00')
    setWeekdays([1, 2, 3, 4, 5])
    setDayOfMonth(1)
    setConversationId('')
    messageRef.current?.focus()
  }, [open, initialMessage])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const toggleWeekday = (day: number) => {
    setWeekdays((days) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b)))
  }

  const valid =
    message.trim().length > 0 &&
    (kind === 'once'
      ? at.trim().length > 0 && !Number.isNaN(new Date(at).getTime())
      : time.trim().length > 0 &&
        (kind === 'daily' ||
          (kind === 'weekly' && weekdays.length > 0) ||
          (kind === 'monthly' && Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31)))

  const submit = () => {
    if (!valid) return
    const timezone = browserTimeZone()
    const rule: ScheduleRule =
      kind === 'once'
        ? { kind: 'once', at: new Date(at).toISOString() }
        : kind === 'daily'
          ? { kind: 'daily', time, timezone }
          : kind === 'weekly'
            ? { kind: 'weekly', time, timezone, weekdays }
            : { kind: 'monthly', time, timezone, dayOfMonth }
    onCreate({
      message: message.trim(),
      rule,
      timezone,
      conversationId: kind === 'once' && conversationId ? conversationId : null,
      model,
      think,
    })
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Schedule a message">
        <div className="modal-head">
          <h2 className="modal-title">Schedule a message</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <label className="field">
            <span className="field-label">Message</span>
            <textarea
              ref={messageRef}
              className="field-input"
              rows={3}
              value={message}
              placeholder="What should I ask you about?"
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">Repeat</span>
            <select className="field-input" value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>

          {kind === 'once' ? (
            <>
              <label className="field">
                <span className="field-label">When</span>
                <input type="datetime-local" className="field-input" value={at} onChange={(e) => setAt(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Send in</span>
                <select className="field-input" value={conversationId} onChange={(e) => setConversationId(e.target.value)}>
                  <option value="">New conversation</option>
                  {conversations.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span className="field-label">Time</span>
                <input type="time" className="field-input" value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
              {kind === 'weekly' && (
                <div className="field">
                  <span className="field-label">Days</span>
                  <div className="weekday-picker" role="group" aria-label="Days">
                    {WEEKDAYS.map((name, day) => (
                      <button
                        key={name}
                        type="button"
                        className="weekday-button"
                        aria-pressed={weekdays.includes(day)}
                        onClick={() => toggleWeekday(day)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {kind === 'monthly' && (
                <label className="field">
                  <span className="field-label">Day of month</span>
                  <input
                    type="number"
                    className="field-input"
                    min={1}
                    max={31}
                    value={dayOfMonth}
                    onChange={(e) => setDayOfMonth(Number.parseInt(e.target.value, 10) || 0)}
                  />
                </label>
              )}
            </>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-button" disabled={!valid} onClick={submit}>
            Schedule
          </button>
        </div>
      </div>
    </div>
  )
}
