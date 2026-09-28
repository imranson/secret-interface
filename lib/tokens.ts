import type { Tool } from 'ollama'
import { toOllamaMessages } from './history'
import type { ChatMessage } from './types'

// A deliberately rough heuristic: ~4 characters per token for English prose and code, plus a
// small per-message overhead for the chat template.
export const CHARS_PER_TOKEN = 4
export const MESSAGE_OVERHEAD_TOKENS = 4

export function estimateTokens(text: string | undefined | null): number {
  return text ? Math.ceil(text.length / CHARS_PER_TOKEN) : 0
}

export interface ContextEstimateInput {
  systemPrompt: string
  messages: ChatMessage[]
  tools?: Tool[]
  /** Unsent text in the composer. */
  draft?: string
}

export function estimateContextTokens({ systemPrompt, messages, tools, draft }: ContextEstimateInput): number {
  let total = 0
  for (const m of toOllamaMessages(systemPrompt, messages)) {
    total += MESSAGE_OVERHEAD_TOKENS + estimateTokens(m.content) + estimateTokens(m.thinking)
    if (m.tool_calls?.length) total += estimateTokens(JSON.stringify(m.tool_calls))
  }
  if (tools?.length) total += estimateTokens(JSON.stringify(tools))
  if (draft?.trim()) total += MESSAGE_OVERHEAD_TOKENS + estimateTokens(draft)
  return total
}

export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}
