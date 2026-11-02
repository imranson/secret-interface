'use client'

import Link from 'next/link'
import { countByStatus, describeRule, formatRunTime } from '@/lib/schedule'
import { conversationPath } from '@/lib/routes'
import type { ScheduleStatus, ScheduleView } from '@/lib/types'
import { AlertIcon, CheckIcon, ClockIcon, PauseIcon, PlayIcon, PlusIcon, RepeatIcon, TrashIcon } from './Icons'

const STATUS_LABELS: Record<ScheduleStatus, string> = {
  scheduled: 'Scheduled',
  running: 'Running',
  unread: 'Unread',
  completed: 'Completed',
  failed: 'Failed',
  paused: 'Paused',
}

/** The same mark everywhere a schedule's state appears: the summary, its row, and its conversation in Recent. */
export function StatusMark({ status }: { status: ScheduleStatus }) {
  return (
    <span className="status-mark" data-status={status} aria-hidden="true">
      {status === 'running' ? (
        <span className="spinner" />
      ) : status === 'unread' ? (
        <span className="status-dot" />
      ) : status === 'completed' ? (
        <CheckIcon width={13} height={13} />
      ) : status === 'failed' ? (
        <AlertIcon width={13} height={13} />
      ) : status === 'paused' ? (
        <PauseIcon width={13} height={13} />
      ) : (
        <ClockIcon width={13} height={13} />
      )}
    </span>
  )
}

export interface ScheduleListProps {
  schedules: ScheduleView[]
  currentId: string | null
  onNew: () => void
  onSelect: (conversationId: string) => void
  onRun: (id: string) => void
  onSetEnabled: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
}

export function ScheduleList({ schedules, currentId, onNew, onSelect, onRun, onSetEnabled, onDelete }: ScheduleListProps) {
  const counts = countByStatus(schedules)
  return (
    <div className="sched-view">
      <button type="button" className="sched-new" onClick={onNew}>
        <PlusIcon /> New schedule
      </button>

      {schedules.length === 0 ? (
        <p className="conv-empty">
          Nothing scheduled yet. Write a prompt, press <strong>Repeat</strong> and pick a time. Good for things like a
          daily news report.
        </p>
      ) : (
        <>
          <dl className="sched-summary" aria-label="Schedule status">
            {(['scheduled', 'unread', 'completed'] as const).map((status) => (
              <div key={status} className="sched-count">
                <StatusMark status={status} />
                <dd>{counts[status]}</dd>
                <dt>{STATUS_LABELS[status].toLowerCase()}</dt>
              </div>
            ))}
          </dl>
          <ul className="sched-list" aria-label="Schedules">
            {schedules.map((s) => (
              <li
                key={s.id}
                className="sched-item"
                data-status={s.status}
                data-active={(s.conversationId !== null && s.conversationId === currentId) || undefined}
              >
                <StatusMark status={s.status} />
                <div className="sched-body">
                  {s.conversationId ? (
                    <Link
                      href={conversationPath(s.conversationId)}
                      prefetch={false}
                      className="sched-title"
                      title={s.prompt}
                      onNavigate={() => onSelect(s.conversationId!)}
                    >
                      {s.title}
                    </Link>
                  ) : (
                    <span className="sched-title" title={s.prompt}>
                      {s.title}
                    </span>
                  )}
                  <p className="sched-meta">
                    <span className="sched-status">{STATUS_LABELS[s.status]}</span> · {describeRule(s.rule)}
                  </p>
                  {s.enabled && s.nextRunAt && <p className="sched-meta">Next: {formatRunTime(s.nextRunAt)}</p>}
                  {s.lastError && (
                    <p className="sched-error" title={s.lastError}>
                      {s.lastError}
                    </p>
                  )}
                </div>
                <div className="sched-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Run “${s.title}” now`}
                    title="Run now"
                    disabled={s.status === 'running'}
                    onClick={() => onRun(s.id)}
                  >
                    <RepeatIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`${s.enabled ? 'Pause' : 'Resume'} “${s.title}”`}
                    title={s.enabled ? 'Pause' : 'Resume'}
                    onClick={() => onSetEnabled(s.id, !s.enabled)}
                  >
                    {s.enabled ? <PauseIcon /> : <PlayIcon />}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Delete schedule “${s.title}”`}
                    title="Delete schedule (keeps its conversation)"
                    onClick={() => onDelete(s.id)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
