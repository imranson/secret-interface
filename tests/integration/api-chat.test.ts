import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyStreamEvent } from '@/lib/chat-reducer'
import { parseNdjson } from '@/lib/ndjson'
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/prompts'
import { getStore } from '@/lib/store'
import { TOOL_DEFINITIONS } from '@/lib/tool-definitions'
import type { ChatMessage, StreamEvent } from '@/lib/types'
import { chunk, createFakeOllama, HttpError, type FakeOllama } from '../helpers/fake-ollama'
import { makeTempDataDir } from '../helpers/temp-data'

const holder = vi.hoisted(() => ({ fake: undefined as FakeOllama | undefined }))
vi.mock('@/lib/ollama', () => ({ getOllamaClient: () => holder.fake!.client }))

const { POST } = await import('@/app/api/chat/route')

let dataDir: string
let cleanup: () => Promise<void>

beforeEach(async () => {
  ;({ dir: dataDir, cleanup } = await makeTempDataDir())
  vi.stubEnv('DATA_DIR', dataDir)
  vi.stubEnv('OLLAMA_API_KEY', 'test-key')
  vi.stubEnv('OLLAMA_HOST', '')
  vi.stubEnv('OLLAMA_MODEL', 'kimi-k2.6:cloud')
  vi.stubEnv('SYSTEM_PROMPT', '')
  holder.fake = createFakeOllama()
})

afterEach(() => cleanup())

function post(body: unknown, init: RequestInit = {}) {
  return POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...init,
    }),
  )
}

async function events(response: Response): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const event of parseNdjson<StreamEvent>(response.body!)) out.push(event)
  return out
}

async function readConversationFile(id: string, archived = false) {
  const file = path.join(dataDir, 'conversations', ...(archived ? ['archived'] : []), `${id}.json`)
  return JSON.parse(await readFile(file, 'utf8'))
}

describe('POST /api/chat', () => {
  it('streams a reply for a new conversation and saves it to disk', async () => {
    holder.fake!.push({
      chunks: [chunk.thinking('Greeting.'), chunk.content('Hello, '), chunk.content('**world**.'), chunk.done(20, 4)],
    })
    const response = await post({ message: '  Say hello  ', think: 'on' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/x-ndjson')

    const stream = await events(response)
    expect(stream.map((e) => e.type)).toEqual(['start', 'thinking', 'content', 'content', 'usage', 'done'])
    const start = stream[0] as Extract<StreamEvent, { type: 'start' }>
    expect(start.model).toBe('kimi-k2.6')
    expect(start.conversation).toMatchObject({ title: 'Say hello', archived: false })

    const request = holder.fake!.requests[0]
    expect(request).toMatchObject({ model: 'kimi-k2.6', stream: true, think: true, tools: TOOL_DEFINITIONS })
    expect(request.messages).toEqual([
      { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
      { role: 'user', content: 'Say hello' },
    ])

    const saved = await readConversationFile(start.conversation.id)
    expect(saved).toMatchObject({ id: start.conversation.id, title: 'Say hello', model: 'kimi-k2.6' })
    expect(saved.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'Say hello' }),
      expect.objectContaining({ role: 'assistant', content: 'Hello, **world**.', thinking: 'Greeting.', model: 'kimi-k2.6' }),
    ])
    const done = stream.at(-1) as Extract<StreamEvent, { type: 'done' }>
    expect(done).toMatchObject({ aborted: false, conversation: { id: start.conversation.id, message_count: 2 } })
  })

  it('runs web tools mid-stream and the client reducer reproduces the saved messages', async () => {
    holder.fake!.push(
      { chunks: [chunk.toolCall('web_search', { query: 'ollama cloud' }), chunk.done()] },
      { chunks: [chunk.toolCall('web_fetch', { url: 'https://ollama.com/' }), chunk.done()] },
      { chunks: [chunk.content('Ollama has a cloud ([source](https://ollama.com/)).'), chunk.done()] },
    )
    const stream = await events(await post({ message: 'What is Ollama cloud?' }))
    expect(stream.map((e) => e.type)).toEqual([
      'start',
      'tool_call',
      'usage',
      'tool_result',
      'tool_call',
      'usage',
      'tool_result',
      'content',
      'usage',
      'done',
    ])
    expect(holder.fake!.client.webSearch).toHaveBeenCalledWith({ query: 'ollama cloud', max_results: 5 })
    expect(holder.fake!.client.webFetch).toHaveBeenCalledWith({ url: 'https://ollama.com/' })

    const id = (stream[0] as Extract<StreamEvent, { type: 'start' }>).conversation.id
    const saved = await readConversationFile(id)
    expect(saved.messages.map((m: ChatMessage) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant'])

    // What the browser builds from the stream matches what the server stored.
    const strip = ({ role, content, thinking, tool_calls, tool_name, tool_error }: ChatMessage) =>
      JSON.parse(JSON.stringify({ role, content, thinking, tool_calls, tool_name, tool_error }))
    const client = stream.reduce<ChatMessage[]>((acc, e) => applyStreamEvent(acc, e), [
      { role: 'user', content: 'What is Ollama cloud?' },
    ])
    expect(client.map(strip)).toEqual(saved.messages.map(strip))
  })

  it('continues an existing conversation with its history', async () => {
    holder.fake!.push({ chunks: [chunk.content('First answer'), chunk.done()] })
    const first = await events(await post({ message: 'First question' }))
    const id = (first[0] as Extract<StreamEvent, { type: 'start' }>).conversation.id

    holder.fake!.push({ chunks: [chunk.content('Second answer'), chunk.done()] })
    const second = await events(await post({ conversationId: id, message: 'Second question', model: 'gpt-oss:120b-cloud', think: 'low' }))
    expect(second[0]).toMatchObject({ type: 'start', model: 'gpt-oss:120b', conversation: { id } })

    expect(holder.fake!.requests[1]).toMatchObject({ model: 'gpt-oss:120b', think: 'low' })
    expect(holder.fake!.requests[1].messages!.slice(1)).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Second question' },
    ])
    const saved = await readConversationFile(id)
    expect(saved.messages).toHaveLength(4)
    expect(saved.title).toBe('First question')
    expect(saved.model).toBe('gpt-oss:120b')
  })

  it('passes the browser time zone to the datetime tool', async () => {
    holder.fake!.push(
      { chunks: [chunk.toolCall('get_current_datetime', {}), chunk.done()] },
      { chunks: [chunk.content('It is today.'), chunk.done()] },
    )
    const stream = await events(await post({ message: 'What day is it?', timezone: 'Asia/Tokyo' }))
    const result = stream.find((e) => e.type === 'tool_result') as Extract<StreamEvent, { type: 'tool_result' }>
    expect(JSON.parse(result.content).timezone).toBe('Asia/Tokyo')
  })

  it('streams an error event but keeps the user message when Ollama fails', async () => {
    holder.fake!.push({ error: new HttpError('unauthorized', 401) })
    const stream = await events(await post({ message: 'Hi' }))
    expect(stream.map((e) => e.type)).toEqual(['start', 'error', 'done'])
    expect(stream[1]).toEqual({
      type: 'error',
      message: 'Ollama rejected the request (401): unauthorized. Check OLLAMA_API_KEY in .env.local.',
    })
    const id = (stream[0] as Extract<StreamEvent, { type: 'start' }>).conversation.id
    expect((await readConversationFile(id)).messages).toEqual([expect.objectContaining({ role: 'user', content: 'Hi' })])
  })

  it('saves the partial reply when the client disconnects', async () => {
    holder.fake!.push({ chunks: [chunk.content('Half an ans')], hang: true })
    const controller = new AbortController()
    const response = await post({ message: 'Long question' }, { signal: controller.signal })
    const reader = parseNdjson<StreamEvent>(response.body!)[Symbol.asyncIterator]()
    const start = (await reader.next()).value as Extract<StreamEvent, { type: 'start' }>
    expect((await reader.next()).value).toEqual({ type: 'content', delta: 'Half an ans' })
    await reader.return?.(undefined)
    await response.body?.cancel().catch(() => {})
    controller.abort()

    await vi.waitFor(async () => {
      const saved = await readConversationFile(start.conversation.id)
      expect(saved.messages).toEqual([
        expect.objectContaining({ role: 'user' }),
        expect.objectContaining({ role: 'assistant', content: 'Half an ans' }),
      ])
    })
  })

  it('validates the request', async () => {
    expect((await post('not json')).status).toBe(400)
    expect(await (await post({ message: '   ' })).json()).toEqual({ error: 'Message is required' })
    expect((await post({ message: 'hi', think: 'maybe' })).status).toBe(400)
    expect((await post({ message: 'hi', conversationId: '../../etc' })).status).toBe(400)
    expect((await post({ message: 'hi', conversationId: 'f'.repeat(32) })).status).toBe(404)
    expect(holder.fake!.client.chat).not.toHaveBeenCalled()
  })

  it('refuses to continue archived conversations', async () => {
    const store = getStore(dataDir)
    const conversation = store.create()
    await store.save(conversation)
    await store.setArchived(conversation.id, true)
    const response = await post({ message: 'hi', conversationId: conversation.id })
    expect(response.status).toBe(409)
    expect(existsSync(path.join(dataDir, 'conversations', `${conversation.id}.json`))).toBe(false)
  })

  it('explains a missing API key', async () => {
    vi.stubEnv('OLLAMA_API_KEY', '')
    const response = await post({ message: 'hi' })
    expect(response.status).toBe(500)
    expect((await response.json()).error).toMatch(/OLLAMA_API_KEY is not set/)
  })
})
