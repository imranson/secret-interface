// Types shared by the server (route handlers, store, agent) and the client UI.

export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCallRecord {
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

/** A message as persisted on disk and rendered in the UI (Ollama message shape plus metadata). */
export interface ChatMessage {
  role: Role
  content: string
  thinking?: string
  tool_calls?: ToolCallRecord[]
  tool_name?: string
  /** Set on tool messages whose execution failed. */
  tool_error?: boolean
  created_at?: string
  model?: string
  /** Unknown fields from older conversation files are preserved on save. */
  [extra: string]: unknown
}

export interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
  model?: string
  archived: boolean
  messages: ChatMessage[]
}

export interface ConversationSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
  model?: string
  archived: boolean
  message_count: number
}

/** `auto` leaves thinking to the model's default; the levels are for models such as gpt-oss. */
export const THINK_OPTIONS = ['auto', 'off', 'on', 'low', 'medium', 'high'] as const
export type ThinkOption = (typeof THINK_OPTIONS)[number]

export interface ChatRequestBody {
  conversationId?: string | null
  message: string
  think?: ThinkOption
  model?: string
  /** The browser's IANA time zone, used by the datetime tool. */
  timezone?: string
}

/** Events streamed (as NDJSON) from POST /api/chat to the browser. */
export type StreamEvent =
  | { type: 'start'; conversation: ConversationSummary; model: string }
  | { type: 'thinking'; delta: string }
  | { type: 'content'; delta: string }
  | { type: 'tool_call'; call: ToolCallRecord }
  | { type: 'tool_result'; name: string; content: string; error?: boolean }
  | { type: 'usage'; prompt_tokens: number; completion_tokens: number }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; conversation: ConversationSummary; aborted: boolean }
