'use client'

import Link from 'next/link'
import { groupByDate } from '@/lib/format'
import { conversationPath } from '@/lib/routes'
import type { ConversationSummary, ScheduleView } from '@/lib/types'
import { ArchiveIcon, PlusIcon, RestoreIcon } from './Icons'
import { ScheduleList, StatusMark } from './ScheduleList'

export type SidebarView = 'recent' | 'scheduled' | 'archived'

export interface SidebarProps {
  view: SidebarView
  onViewChange: (view: SidebarView) => void
  conversations: ConversationSummary[]
  /** `null` until the archive has been loaded. */
  archived: ConversationSummary[] | null
  schedules: ScheduleView[]
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
  onRunSchedule: (id: string) => void
  onSetScheduleEnabled: (id: string, enabled: boolean) => void
  onDeleteSchedule: (id: string) => void
}

export function Sidebar(props: SidebarProps) {
  const { view, conversations, archived, schedules, currentId, busyId, open, collapsed } = props
  const list = view === 'archived' ? archived : conversations
  const groups = list ? groupByDate(list) : []
  const scheduleFor = new Map(schedules.map((s) => [s.conversationId, s]))
  const unread = schedules.filter((s) => s.unread).length

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
        <button
          type="button"
          aria-pressed={view === 'scheduled'}
          aria-label={unread ? `Scheduled, ${unread} unread` : 'Scheduled'}
          onClick={() => props.onViewChange('scheduled')}
        >
          Scheduled{unread > 0 && <span className="tab-badge">{unread}</span>}
        </button>
        <button type="button" aria-pressed={view === 'archived'} onClick={() => props.onViewChange('archived')}>
          Archived{archived ? ` (${archived.length})` : ''}
        </button>
      </div>

      {view === 'scheduled' ? (
        <ScheduleList
          schedules={schedules}
          currentId={currentId}
          onNew={props.onNewSchedule}
          onSelect={props.onSelect}
          onRun={props.onRunSchedule}
          onSetEnabled={props.onSetScheduleEnabled}
          onDelete={props.onDeleteSchedule}
        />
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
                  {group.items.map((c) => {
                    const schedule = view === 'recent' ? scheduleFor.get(c.id) : undefined
                    return (
                      <li key={c.id} className="conv-item" data-active={c.id === currentId || undefined}>
                        <Link
                          href={conversationPath(c.id)}
                          // The chat fetches the conversation itself; prefetching would only add a request per visible link.
                          prefetch={false}
                          className="conv-open"
                          aria-current={c.id === currentId ? 'page' : undefined}
                          aria-label={schedule?.unread ? `Unread: ${c.title}` : undefined}
                          onNavigate={() => props.onSelect(c.id)}
                          title={c.title}
                        >
                          {c.title}
                        </Link>
                        {schedule && <StatusMark status={schedule.status} />}
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
                    )
                  })}
                </ul>
              </section>
            ))
          )}
        </nav>
      )}
    </aside>
  )
}
