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

/** When a schedule runs. `time` is `HH:MM` wall-clock time in `timezone`, so it stays put across daylight saving. */
export interface ScheduleRule {
  kind: 'daily' | 'weekly' | 'monthly'
  time: string
  timezone: string
  /** Weekly only: 0 (Sun) … 6 (Sat). */
  weekdays?: number[]
  /** Monthly only: 1–31; shorter months run on their last day. */
  dayOfMonth?: number
}

/** A recurring prompt. It owns at most one conversation, which every successful run refreshes. */
export interface Schedule {
  id: string
  title: string
  prompt: string
  rule: ScheduleRule
  model?: string
  think?: ThinkOption
  enabled: boolean
  /** The conversation this schedule refreshes; `null` until the first successful run. */
  conversationId: string | null
  nextRunAt: string | null
  /** When the last run finished, successfully or not. */
  lastRunAt: string | null
  /** Why the last run failed; its conversation keeps the previous report. */
  lastError: string | null
  /** The latest report has not been opened yet. */
  unread: boolean
  created_at: string
  updated_at: string
}

export type ScheduleStatus = 'scheduled' | 'running' | 'unread' | 'completed' | 'failed' | 'paused'

/** A schedule as sent to the browser. */
export interface ScheduleView extends Schedule {
  status: ScheduleStatus
}

export interface CreateScheduleBody {
  prompt: string
  rule: ScheduleRule
  model?: string
  think?: ThinkOption
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
