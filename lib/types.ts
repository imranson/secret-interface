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
export const THINK_OPTIONS = ['auto', 'off', 'on', 'low', 'medium', 'high', 'max'] as const
export type ThinkOption = (typeof THINK_OPTIONS)[number]

export interface ChatRequestBody {
  conversationId?: string | null
  message: string
  think?: ThinkOption
  model?: string
  /** The browser's IANA time zone, used by the datetime tool. */
  timezone?: string
  /**
   * When editing a message, the index in the stored conversation at which to drop messages before
   * appending the new user message. The edited message and everything after it are replaced.
   */
  editIndex?: number
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

/** How a scheduled message repeats (or runs once). */
export type ScheduleKind = 'once' | 'daily' | 'weekly' | 'monthly'

export interface ScheduleRule {
  kind: ScheduleKind
  /** `once`: the absolute run time (ISO 8601). */
  at?: string
  /** Recurring kinds: local wall-clock time, `HH:MM` (24-hour) in `timezone`. */
  time?: string
  /** IANA time zone the recurring `time` is expressed in. */
  timezone?: string
  /** `weekly`: weekdays to run, 0 (Sunday) … 6 (Saturday). */
  weekdays?: number[]
  /** `monthly`: day of the month, 1–31. */
  dayOfMonth?: number
}

/** A message the scheduler sends to the AI at a future time. */
export interface ScheduledMessage {
  id: string
  message: string
  rule: ScheduleRule
  model?: string
  think?: ThinkOption
  /** Time zone passed to the datetime tool when this runs. */
  timezone?: string
  /** `once`: which conversation to append to; null/omitted starts a new conversation. */
  conversationId?: string | null
  enabled: boolean
  /** When this next runs (ISO); null when it has no further runs. */
  nextRunAt: string | null
  lastRunAt?: string | null
  lastConversationId?: string | null
  /** The last run produced a reply the user has not opened yet. */
  unread: boolean
  lastError?: string | null
  created_at: string
  updated_at: string
}

export type ScheduleStatus = 'scheduled' | 'completed' | 'paused' | 'error'

export interface CreateScheduleInput {
  message: string
  rule: ScheduleRule
  model?: string
  think?: ThinkOption
  timezone?: string
  conversationId?: string | null
}
