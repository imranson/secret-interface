import type { ChatMessage } from './types'

export type AssistantPart =
  | { kind: 'thinking'; text: string; active: boolean }
  | { kind: 'text'; text: string }
  | {
      kind: 'tool'
      name: string
      args: Record<string, unknown>
      result?: string
      error?: boolean
      pending: boolean
    }

export type DisplayItem =
  | { kind: 'user'; key: string; content: string }
  | { kind: 'assistant'; key: string; parts: AssistantPart[]; streaming: boolean }

type ToolPart = Extract<AssistantPart, { kind: 'tool' }>

/**
 * Groups stored messages into what the UI shows: a user bubble per user message, and one assistant
 * block per reply that interleaves thinking, text and tool-call cards (with their results attached).
 */
export function buildDisplayItems(messages: ChatMessage[], streaming = false): DisplayItem[] {
  const items: DisplayItem[] = []
  let current: Extract<DisplayItem, { kind: 'assistant' }> | null = null
  let unresolved: ToolPart[] = []

  messages.forEach((message, index) => {
    if (message.role === 'user') {
      current = null
      items.push({ kind: 'user', key: `u${index}`, content: message.content })
      return
    }
    if (message.role !== 'assistant' && message.role !== 'tool') return

    if (!current) {
      current = { kind: 'assistant', key: `a${index}`, parts: [], streaming: false }
      unresolved = []
      items.push(current)
    }

    if (message.role === 'assistant') {
      if (message.thinking) current.parts.push({ kind: 'thinking', text: message.thinking, active: false })
      if (message.content) current.parts.push({ kind: 'text', text: message.content })
      for (const call of message.tool_calls ?? []) {
        const part: ToolPart = {
          kind: 'tool',
          name: call.function?.name ?? 'tool',
          args: call.function?.arguments ?? {},
          pending: true,
        }
        current.parts.push(part)
        unresolved.push(part)
      }
      return
    }

    // Tool results pair with the earliest unanswered call of the same name (else the earliest call).
    const match =
      unresolved.find((p) => p.name === message.tool_name) ?? (message.tool_name ? undefined : unresolved[0])
    if (match) {
      unresolved = unresolved.filter((p) => p !== match)
      match.result = message.content
      match.error = Boolean(message.tool_error)
      match.pending = false
    } else {
      current.parts.push({
        kind: 'tool',
        name: message.tool_name ?? 'tool',
        args: {},
        result: message.content,
        error: Boolean(message.tool_error),
        pending: false,
      })
    }
  })

  const last = items.at(-1)
  for (const item of items) {
    if (item.kind !== 'assistant') continue
    const live = streaming && item === last
    item.streaming = live
    item.parts.forEach((part, i) => {
      if (part.kind === 'thinking') part.active = live && i === item.parts.length - 1
      if (part.kind === 'tool' && !live) part.pending = false
    })
  }
  return items
}
