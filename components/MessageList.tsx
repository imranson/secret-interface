'use client'

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { buildDisplayItems, type DisplayItem } from '@/lib/display'
import type { ChatMessage } from '@/lib/types'
import { CheckIcon, PencilIcon } from './Icons'
import { Markdown } from './Markdown'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallCard } from './ToolCallCard'

function AssistantMessage({ item }: { item: Extract<DisplayItem, { kind: 'assistant' }> }) {
  return (
    <article className="assistant" aria-label="Assistant message" aria-busy={item.streaming || undefined}>
      {item.parts.map((part, i) =>
        part.kind === 'thinking' ? (
          <ThinkingBlock key={i} text={part.text} active={part.active} />
        ) : part.kind === 'text' ? (
          <Markdown key={i} text={part.text} />
        ) : (
          <ToolCallCard key={i} part={part} />
        ),
      )}
    </article>
  )
}

interface UserMessageProps {
  item: Extract<DisplayItem, { kind: 'user' }>
  editing: boolean
  draft: string
  streaming: boolean
  onEdit: () => void
  onDraftChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}

function UserMessage({ item, editing, draft, streaming, onEdit, onDraftChange, onSave, onCancel }: UserMessageProps) {
  if (!editing) {
    return (
      <div className="user-row">
        <button
          type="button"
          className="user-edit"
          aria-label="Edit message"
          title="Edit message"
          disabled={streaming}
          onClick={onEdit}
        >
          <PencilIcon />
        </button>
        <div className="user-bubble">{item.content}</div>
      </div>
    )
  }
  return (
    <div className="user-row">
      <form
        className="user-edit-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim()) onSave()
        }}
      >
        <textarea
          className="user-edit-input"
          aria-label="Edit message"
          value={draft}
          rows={1}
          autoFocus
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (draft.trim()) onSave()
            } else if (e.key === 'Escape') {
              onCancel()
            }
          }}
        />
        <div className="user-edit-actions">
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="send-button" aria-label="Save and send" disabled={!draft.trim()}>
            <CheckIcon />
          </button>
        </div>
      </form>
    </div>
  )
}

export interface MessageListProps {
  /** Changes when a different conversation is shown, so the view jumps to its end. */
  conversationKey: string
  messages: ChatMessage[]
  streaming: boolean
  empty: ReactNode
  /** Replaces the user message at `index` and regenerates the reply after it. */
  onEditMessage: (index: number, content: string) => void
}

export function MessageList({ conversationKey, messages, streaming, empty, onEditMessage }: MessageListProps) {
  const items = useMemo(() => buildDisplayItems(messages, streaming), [messages, streaming])
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  // Which user message is being edited (keyed by its display item) and the in-progress text.
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const startEdit = (item: Extract<DisplayItem, { kind: 'user' }>) => {
    setEditingKey(item.key)
    setEditDraft(item.content)
  }

  const cancelEdit = () => {
    setEditingKey(null)
    setEditDraft('')
  }

  const saveEdit = (item: Extract<DisplayItem, { kind: 'user' }>) => {
    const text = editDraft.trim()
    if (!text) return
    setEditingKey(null)
    setEditDraft('')
    onEditMessage(item.index, text)
  }

  const onScroll = () => {
    const el = scrollRef.current
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  useLayoutEffect(() => {
    stickToBottom.current = true
  }, [conversationKey])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [items])

  const awaitingReply = streaming && items.at(-1)?.kind === 'user'

  return (
    <div className="messages" ref={scrollRef} onScroll={onScroll}>
      <div className="messages-inner">
        {items.length === 0
          ? empty
          : items.map((item) =>
              item.kind === 'user' ? (
                <UserMessage
                  key={item.key}
                  item={item}
                  editing={editingKey === item.key}
                  draft={editDraft}
                  streaming={streaming}
                  onEdit={() => startEdit(item)}
                  onDraftChange={setEditDraft}
                  onSave={() => saveEdit(item)}
                  onCancel={cancelEdit}
                />
              ) : (
                <AssistantMessage key={item.key} item={item} />
              ),
            )}
        {awaitingReply && (
          <div className="typing" role="status" aria-label="Assistant is responding">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
    </div>
  )
}
