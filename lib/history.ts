import type { Message } from 'ollama'
import type { ChatMessage, Role } from './types'

const ROLES: ReadonlySet<string> = new Set<Role>(['system', 'user', 'assistant', 'tool'])

/**
 * Converts stored messages into the payload sent to Ollama.
 *
 * - Prepends the system prompt unless the conversation already starts with a system message.
 * - Keeps `thinking` only for the current turn (after the last user message), which tool-calling
 *   models need mid-loop; older reasoning is dropped to save context.
 * - Strips UI-only metadata and drops messages with roles Ollama does not understand.
 */
export function toOllamaMessages(systemPrompt: string, messages: ChatMessage[]): Message[] {
  let lastUser = -1
  messages.forEach((m, i) => {
    if (m.role === 'user') lastUser = i
  })

  const out: Message[] = []
  if (systemPrompt && messages[0]?.role !== 'system') {
    out.push({ role: 'system', content: systemPrompt })
  }
  messages.forEach((m, i) => {
    if (!ROLES.has(m.role)) return
    const msg: Message = { role: m.role, content: m.content ?? '' }
    if (m.thinking && i > lastUser) msg.thinking = m.thinking
    if (m.tool_calls?.length) msg.tool_calls = m.tool_calls
    if (m.tool_name) msg.tool_name = m.tool_name
    out.push(msg)
  })
  return out
}
