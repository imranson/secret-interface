import type { AbortableAsyncIterator, ChatRequest, ChatResponse, Tool } from 'ollama'
import { toOllamaMessages } from './history'
import type { OllamaClient } from './ollama'
import { executeTool, parseToolArguments, TOOL_DEFINITIONS } from './tools'
import type { ChatMessage, StreamEvent, ThinkOption, ToolCallRecord } from './types'

export type AgentEvent = Extract<
  StreamEvent,
  { type: 'thinking' | 'content' | 'tool_call' | 'tool_result' | 'usage' | 'notice' }
>

export interface RunAgentOptions {
  client: Pick<OllamaClient, 'chat' | 'webSearch' | 'webFetch'>
  model: string
  /** Stored conversation so far, including the new user message. */
  history: ChatMessage[]
  systemPrompt: string
  think?: ThinkOption
  tools?: Tool[]
  timeZone?: string
  signal?: AbortSignal
  /**
   * Receives the assistant and tool messages as they are produced (assistant messages are filled in
   * while streaming), so callers can persist partial output if the run is aborted or fails.
   */
  output: ChatMessage[]
  now?: () => Date
}

const UNSUPPORTED_THINKING = /does not support think|thinking is not supported/i
const UNSUPPORTED_TOOLS = /does not support tools|tools are not supported/i

export function thinkParam(think: ThinkOption | undefined): ChatRequest['think'] {
  switch (think) {
    case 'on':
      return true
    case 'off':
      return false
    case 'low':
    case 'medium':
    case 'high':
      return think
    default:
      return undefined // 'auto'
  }
}

export function isEmptyMessage(message: ChatMessage): boolean {
  return !message.content && !message.thinking && !message.tool_calls?.length
}

/**
 * Runs the chat/tool-calling loop against Ollama, yielding thinking and content tokens, tool calls
 * and tool results as they happen.
 */
export async function* runAgent(opts: RunAgentOptions): AsyncGenerator<AgentEvent> {
  const { client, model, signal, output } = opts
  let think = thinkParam(opts.think)
  let tools = opts.tools ?? TOOL_DEFINITIONS

  while (!signal?.aborted) {
    const request: ChatRequest & { stream: true } = {
      model,
      messages: toOllamaMessages(opts.systemPrompt, [...opts.history, ...output]),
      stream: true,
      ...(think !== undefined && { think }),
      ...(tools.length > 0 && { tools }),
    }
    const assistant: ChatMessage = { role: 'assistant', content: '', created_at: new Date().toISOString(), model }

    let stream: AbortableAsyncIterator<ChatResponse> | undefined
    const onAbort = () => stream?.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      stream = await client.chat(request)
      if (signal?.aborted) stream.abort()
      output.push(assistant)
      for await (const chunk of stream) {
        const message = chunk.message
        if (message?.thinking) {
          assistant.thinking = (assistant.thinking ?? '') + message.thinking
          yield { type: 'thinking', delta: message.thinking }
        }
        if (message?.content) {
          assistant.content += message.content
          yield { type: 'content', delta: message.content }
        }
        for (const call of message?.tool_calls ?? []) {
          const record: ToolCallRecord = {
            ...call,
            function: { ...call.function, arguments: parseToolArguments(call.function?.arguments) },
          }
          assistant.tool_calls = [...(assistant.tool_calls ?? []), record]
          yield { type: 'tool_call', call: record }
        }
        if (chunk.done) {
          yield { type: 'usage', prompt_tokens: chunk.prompt_eval_count ?? 0, completion_tokens: chunk.eval_count ?? 0 }
        }
      }
    } catch (error) {
      if (signal?.aborted) return
      // Retry once without an unsupported feature, provided nothing has been streamed yet.
      if (isEmptyMessage(assistant)) {
        if (output.at(-1) === assistant) output.pop()
        const message = (error as Error).message ?? ''
        if (think && UNSUPPORTED_THINKING.test(message)) {
          think = undefined
          yield { type: 'notice', message: `${model} does not support thinking; answering without it.` }
          continue
        }
        if (tools.length && UNSUPPORTED_TOOLS.test(message)) {
          tools = []
          yield { type: 'notice', message: `${model} does not support tools; answering without web search.` }
          continue
        }
      }
      throw error
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }

    const calls = assistant.tool_calls ?? []
    if (calls.length === 0 || signal?.aborted) return

    // Run this turn's tools concurrently but report results in call order. Results are recorded even
    // if the run is aborted meanwhile, so the saved history never has unanswered tool calls.
    const pending = calls.map((call) => executeTool(call, { client, timeZone: opts.timeZone, now: opts.now }))
    for (const [i, call] of calls.entries()) {
      const result = await pending[i]
      output.push({
        role: 'tool',
        tool_name: call.function.name,
        content: result.content,
        created_at: new Date().toISOString(),
        ...(result.error && { tool_error: true }),
      })
      yield { type: 'tool_result', name: call.function.name, content: result.content, error: result.error }
    }
  }
}
