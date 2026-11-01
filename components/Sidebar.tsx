'use client'

import Link from 'next/link'
import { groupByDate } from '@/lib/format'
import { conversationPath } from '@/lib/routes'
import { scheduleLabel, scheduleStatus } from '@/lib/schedule'
import type { ConversationSummary, ScheduledMessage, ScheduleStatus } from '@/lib/types'
import { ArchiveIcon, CalendarIcon, PauseIcon, PlayIcon, PlusIcon, RestoreIcon, TrashIcon } from './Icons'

export type SidebarView = 'recent' | 'archived' | 'scheduled'

const STATUS_LABEL: Record<ScheduleStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  paused: 'Paused',
  error: 'Failed',
}

export interface SidebarProps {
  view: SidebarView
  onViewChange: (view: SidebarView) => void
  conversations: ConversationSummary[]
  /** `null` until the archive has been loaded. */
  archived: ConversationSummary[] | null
  /** Scheduled messages; `null` until they have been loaded. */
  schedules: ScheduledMessage[] | null
  currentId: string | null
  /** Conversation whose reply is streaming; it cannot be archived until the reply finishes. */
  busyId: string | null
  /** Drawer state on small screens. */
  open: boolean
  /** Folded out of view on wide screens. */
  collapsed: boolean
  /** Called as a link click navigates in this tab (not when it opens a new one). */
  onSelect: (id: string) => void
  onNew: () => void
  onArchive: (id: string) => void
  onRestore: (id: string) => void
  onNewSchedule: () => void
  onDeleteSchedule: (id: string) => void
  onToggleSchedule: (id: string, enabled: boolean) => void
}

export function Sidebar(props: SidebarProps) {
  const { view, conversations, archived, schedules, currentId, busyId, open, collapsed } = props
  const list = view === 'recent' ? conversations : archived
  const groups = list ? groupByDate(list) : []

  return (
    <aside
      className="sidebar"
      data-open={open || undefined}
      data-collapsed={collapsed || undefined}
      inert={collapsed}
      aria-label="Conversation history"
    >
      <div className="sidebar-head">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">§</span> secret interface
        </div>
        <Link href="/" className="new-chat" onNavigate={props.onNew}>
          <PlusIcon /> New conversation
        </Link>
      </div>

      <div className="view-switch" role="group" aria-label="Show">
        <button type="button" aria-pressed={view === 'recent'} onClick={() => props.onViewChange('recent')}>
          Recent
        </button>
        <button type="button" aria-pressed={view === 'scheduled'} onClick={() => props.onViewChange('scheduled')}>
          Scheduled
        </button>
        <button type="button" aria-pressed={view === 'archived'} onClick={() => props.onViewChange('archived')}>
          Archived{archived ? ` (${archived.length})` : ''}
        </button>
      </div>

      {view === 'scheduled' ? (
        <div className="sched-wrap">
          <button type="button" className="new-chat sched-new" onClick={props.onNewSchedule}>
            <CalendarIcon /> Schedule a message
          </button>
          {schedules === null ? (
            <p className="conv-empty">Loading…</p>
          ) : schedules.length === 0 ? (
            <p className="conv-empty">No scheduled messages. Write one and it will ask the AI for you.</p>
          ) : (
            <ul className="sched-list">
              {schedules.map((s) => {
                const status = scheduleStatus(s)
                return (
                  <li key={s.id} className="sched-item" data-unread={s.unread || undefined}>
                    <div className="sched-body">
                      <div className="sched-msg">{s.message}</div>
                      <div className="sched-meta">
                        <span className="sched-status" data-status={status}>
                          {STATUS_LABEL[status]}
                        </span>
                        <span className="sched-label">{scheduleLabel(s.rule)}</span>
                      </div>
                      {s.lastError && <div className="sched-error">{s.lastError}</div>}
                    </div>
                    <button
                      type="button"
                      className="icon-button sched-action"
                      aria-label={s.enabled ? `Pause “${s.message}”` : `Resume “${s.message}”`}
                      title={s.enabled ? 'Pause' : 'Resume'}
                      onClick={() => props.onToggleSchedule(s.id, !s.enabled)}
                    >
                      {s.enabled ? <PauseIcon /> : <PlayIcon />}
                    </button>
                    <button
                      type="button"
                      className="icon-button sched-action"
                      aria-label={`Delete “${s.message}”`}
                      title="Delete"
                      onClick={() => props.onDeleteSchedule(s.id)}
                    >
                      <TrashIcon />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : (
        <nav className="conv-nav" aria-label={view === 'recent' ? 'Recent conversations' : 'Archived conversations'}>
          {list === null ? (
            <p className="conv-empty">Loading…</p>
          ) : list.length === 0 ? (
            <p className="conv-empty">{view === 'recent' ? 'No conversations yet.' : 'Nothing archived.'}</p>
          ) : (
            groups.map((group) => (
              <section key={group.label} className="conv-group">
                <h2 className="conv-group-label">{group.label}</h2>
                <ul className="conv-list">
                  {group.items.map((c) => (
                    <li key={c.id} className="conv-item" data-active={c.id === currentId || undefined}>
                      <Link
                        href={conversationPath(c.id)}
                        // The chat fetches the conversation itself; prefetching would only add a request per visible link.
                        prefetch={false}
                        className="conv-open"
                        aria-current={c.id === currentId ? 'page' : undefined}
                        onNavigate={() => props.onSelect(c.id)}
                        title={c.title}
                      >
                        {c.title}
                      </Link>
                      {view === 'recent' ? (
                        <button
                          type="button"
                          className="icon-button conv-action"
                          aria-label={`Archive “${c.title}”`}
                          title={c.id === busyId ? 'Wait for the reply to finish' : 'Archive'}
                          disabled={c.id === busyId}
                          onClick={() => props.onArchive(c.id)}
                        >
                          <ArchiveIcon />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="icon-button conv-action"
                          aria-label={`Restore “${c.title}”`}
                          title="Restore"
                          onClick={() => props.onRestore(c.id)}
                        >
                          <RestoreIcon />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </nav>
      )}
    </aside>
  )
}
