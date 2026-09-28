import type { ChatMessage, StreamEvent } from './types'

/**
 * Applies a streamed event to the client's message list, mirroring how the server builds the
 * stored conversation: tokens and tool calls extend the trailing assistant message (or start one),
 * and each tool result becomes a `tool` message.
 */
export function applyStreamEvent(
  messages: ChatMessage[],
  event: StreamEvent,
  now: () => string = () => new Date().toISOString(),
): ChatMessage[] {
  switch (event.type) {
    case 'thinking':
    case 'content':
    case 'tool_call': {
      const last = messages.at(-1)
      const continuing = last?.role === 'assistant'
      const next: ChatMessage = continuing ? { ...last } : { role: 'assistant', content: '', created_at: now() }
      if (event.type === 'thinking') next.thinking = (next.thinking ?? '') + event.delta
      else if (event.type === 'content') next.content = (next.content ?? '') + event.delta
      else next.tool_calls = [...(next.tool_calls ?? []), event.call]
      return continuing ? [...messages.slice(0, -1), next] : [...messages, next]
    }
    case 'tool_result':
      return [
        ...messages,
        {
          role: 'tool',
          tool_name: event.name,
          content: event.content,
          created_at: now(),
          ...(event.error && { tool_error: true }),
        },
      ]
    default:
      return messages
  }
}
