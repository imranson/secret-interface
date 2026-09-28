'use client'

import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { buildDisplayItems, type DisplayItem } from '@/lib/display'
import type { ChatMessage } from '@/lib/types'
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

export interface MessageListProps {
  /** Changes when a different conversation is shown, so the view jumps to its end. */
  conversationKey: string
  messages: ChatMessage[]
  streaming: boolean
  empty: ReactNode
}

export function MessageList({ conversationKey, messages, streaming, empty }: MessageListProps) {
  const items = useMemo(() => buildDisplayItems(messages, streaming), [messages, streaming])
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

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
                <div key={item.key} className="user-row">
                  <div className="user-bubble">{item.content}</div>
                </div>
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
