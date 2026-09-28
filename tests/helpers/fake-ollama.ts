import type { AbortableAsyncIterator, ChatRequest, ChatResponse } from 'ollama'
import { vi } from 'vitest'
import type { OllamaClient } from '@/lib/ollama'

export type Chunk = Pick<ChatResponse, 'message' | 'done'> & Partial<ChatResponse>

export const chunk = {
  thinking: (text: string): Chunk => ({ message: { role: 'assistant', content: '', thinking: text }, done: false }),
  content: (text: string): Chunk => ({ message: { role: 'assistant', content: text }, done: false }),
  toolCall: (name: string, args: Record<string, unknown>): Chunk => ({
    message: { role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: args } }] },
    done: false,
  }),
  done: (prompt = 10, output = 5): Chunk => ({
    message: { role: 'assistant', content: '' },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: prompt,
    eval_count: output,
  }),
}

export interface Turn {
  chunks?: Chunk[]
  /** Rejects the chat() call itself (like an HTTP error from Ollama). */
  error?: Error
  /** Throws from the stream after the chunks are yielded. */
  streamError?: Error
  /** After the chunks, wait until aborted instead of finishing. */
  hang?: boolean
}

function abortError() {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

export function makeStream(turn: Turn): AbortableAsyncIterator<ChatResponse> {
  let aborted = false
  let onAbort: () => void = () => {}
  const abortedPromise = new Promise<void>((resolve) => (onAbort = resolve))
  const stream = {
    abort() {
      aborted = true
      onAbort()
    },
    async *[Symbol.asyncIterator]() {
      for (const c of turn.chunks ?? []) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (aborted) throw abortError()
        yield c
      }
      if (turn.streamError) throw turn.streamError
      if (turn.hang) {
        await abortedPromise
        throw abortError()
      }
    },
  }
  return stream as unknown as AbortableAsyncIterator<ChatResponse>
}

/** A scripted stand-in for the Ollama SDK client. Each chat() call consumes the next turn. */
export function createFakeOllama(script: Turn[] = []) {
  const turns = [...script]
  const requests: ChatRequest[] = []
  const client = {
    chat: vi.fn(async (request: ChatRequest) => {
      requests.push(structuredClone(request))
      const turn = turns.shift() ?? { chunks: [chunk.content('(no scripted reply)'), chunk.done()] }
      if (turn.error) throw turn.error
      return makeStream(turn)
    }),
    webSearch: vi.fn(async (request: { query: string }) => ({
      results: [
        { title: 'Ollama', url: 'https://ollama.com/', content: `About ${request.query}: Ollama runs models.` },
      ],
    })),
    webFetch: vi.fn(async (request: { url: string }) => ({
      title: 'Example Domain',
      url: request.url,
      content: 'This domain is for use in illustrative examples.',
      links: ['https://www.iana.org/domains/example'],
    })),
    list: vi.fn(async () => ({
      models: [
        { name: 'kimi-k2.6', model: 'kimi-k2.6' },
        { name: 'gpt-oss:120b', model: 'gpt-oss:120b' },
      ],
    })),
    show: vi.fn(
      async (_request: { model: string }): Promise<{ model_info: Record<string, unknown> }> => ({
        model_info: { 'general.architecture': 'gptoss', 'gptoss.context_length': 131072 },
      }),
    ),
  }
  return {
    client,
    /** The same fake, typed as the SDK client (whose overloaded chat() mocks can't express). */
    sdk: client as unknown as OllamaClient,
    requests,
    /** Queues more turns. */
    push: (...more: Turn[]) => turns.push(...more),
  }
}

export type FakeOllama = ReturnType<typeof createFakeOllama>

export class HttpError extends Error {
  constructor(
    message: string,
    public status_code: number,
  ) {
    super(message)
  }
}
