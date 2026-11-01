import { isEmptyMessage, runAgent } from './agent'
import { getConfig, normalizeModelName } from './config'
import { describeError } from './errors'
import { getOllamaClient } from './ollama'
import { getStore, summarize } from './store'
import { deriveTitle } from './title'
import type { ChatMessage, Conversation, StreamEvent, ThinkOption } from './types'

export interface RunChatTurnOptions {
  message: string
  /** Continue this conversation (with any edit already applied), or omit to start a new one. */
  conversation?: Conversation
  think?: ThinkOption
  model?: string
  timezone?: string
  signal?: AbortSignal
}

/**
 * Runs one chat turn against Ollama and persists it, yielding the same events POST /api/chat
 * streams to the browser. Shared by the chat route (which wraps it in a response stream) and the
 * scheduler (which drains it without a browser attached).
 */
export async function* runChatTurn(options: RunChatTurnOptions): AsyncGenerator<StreamEvent> {
  const config = getConfig()
  const store = getStore()
  const conversation = options.conversation ?? store.create({ title: deriveTitle(options.message) })
  const model = normalizeModelName(options.model?.trim() || conversation.model || config.defaultModel, config.host)
  const now = new Date().toISOString()
  conversation.messages.push({ role: 'user', content: options.message, created_at: now })
  conversation.model = model
  conversation.updated_at = now
  // Persist the user's message before calling the model so it survives failures.
  await store.save(conversation)

  const history = [...conversation.messages]
  const produced: ChatMessage[] = []
  yield { type: 'start', conversation: summarize(conversation), model }
  try {
    for await (const event of runAgent({
      client: getOllamaClient(),
      model,
      history,
      systemPrompt: config.systemPrompt,
      think: options.think,
      timeZone: options.timezone,
      signal: options.signal,
      output: produced,
    })) {
      yield event
    }
  } catch (error) {
    yield { type: 'error', message: describeError(error) }
  } finally {
    conversation.messages.push(...produced.filter((m) => !isEmptyMessage(m)))
    conversation.updated_at = new Date().toISOString()
    try {
      await store.save(conversation)
    } catch (error) {
      yield { type: 'error', message: `Could not save the conversation: ${describeError(error)}` }
    }
    yield { type: 'done', conversation: summarize(conversation), aborted: options.signal?.aborted ?? false }
  }
}
