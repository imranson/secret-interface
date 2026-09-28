'use client'

import { groupByDate } from '@/lib/format'
import type { ConversationSummary } from '@/lib/types'
import { ArchiveIcon, PlusIcon, RestoreIcon } from './Icons'

export type SidebarView = 'recent' | 'archived'

export interface SidebarProps {
  view: SidebarView
  onViewChange: (view: SidebarView) => void
  conversations: ConversationSummary[]
  /** `null` until the archive has been loaded. */
  archived: ConversationSummary[] | null
  currentId: string | null
  /** Conversation whose reply is streaming; it cannot be archived until the reply finishes. */
  busyId: string | null
  open: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onArchive: (id: string) => void
  onRestore: (id: string) => void
}

export function Sidebar(props: SidebarProps) {
  const { view, conversations, archived, currentId, busyId, open } = props
  const list = view === 'recent' ? conversations : archived
  const groups = list ? groupByDate(list) : []

  return (
    <aside className="sidebar" data-open={open || undefined} aria-label="Conversation history">
      <div className="sidebar-head">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">§</span> secret interface
        </div>
        <button type="button" className="new-chat" onClick={props.onNew}>
          <PlusIcon /> New conversation
        </button>
      </div>

      <div className="view-switch" role="group" aria-label="Show">
        <button type="button" aria-pressed={view === 'recent'} onClick={() => props.onViewChange('recent')}>
          Recent
        </button>
        <button type="button" aria-pressed={view === 'archived'} onClick={() => props.onViewChange('archived')}>
          Archived{archived ? ` (${archived.length})` : ''}
        </button>
      </div>

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
                    <button
                      type="button"
                      className="conv-open"
                      aria-current={c.id === currentId ? 'page' : undefined}
                      onClick={() => props.onSelect(c.id)}
                      title={c.title}
                    >
                      {c.title}
                    </button>
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
    </aside>
  )
}
