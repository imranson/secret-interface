import { describe, expect, it } from 'vitest'
import { isEmptyMessage, runAgent, thinkParam, type AgentEvent, type RunAgentOptions } from '@/lib/agent'
import { TOOL_DEFINITIONS } from '@/lib/tool-definitions'
import type { ChatMessage } from '@/lib/types'
import { chunk, createFakeOllama, HttpError, type FakeOllama } from '../helpers/fake-ollama'

async function run(fake: FakeOllama, overrides: Partial<RunAgentOptions> = {}) {
  const output: ChatMessage[] = []
  const events: AgentEvent[] = []
  let error: unknown
  try {
    for await (const event of runAgent({
      client: fake.sdk,
      model: 'test-model',
      history: [{ role: 'user', content: 'Hello' }],
      systemPrompt: 'SYS',
      output,
      ...overrides,
    })) {
      events.push(event)
    }
  } catch (e) {
    error = e
  }
  return { output, events, error }
}

describe('thinkParam', () => {
  it('maps the UI option to the Ollama think parameter', () => {
    expect(thinkParam('auto')).toBeUndefined()
    expect(thinkParam(undefined)).toBeUndefined()
    expect(thinkParam('off')).toBe(false)
    expect(thinkParam('on')).toBe(true)
    expect(thinkParam('low')).toBe('low')
    expect(thinkParam('medium')).toBe('medium')
    expect(thinkParam('high')).toBe('high')
  })
})

describe('runAgent', () => {
  it('streams thinking and content tokens and reports usage', async () => {
    const fake = createFakeOllama([
      { chunks: [chunk.thinking('Let me '), chunk.thinking('think.'), chunk.content('Hi '), chunk.content('there!'), chunk.done(42, 7)] },
    ])
    const { output, events, error } = await run(fake, { think: 'on' })
    expect(error).toBeUndefined()
    expect(events).toEqual([
      { type: 'thinking', delta: 'Let me ' },
      { type: 'thinking', delta: 'think.' },
      { type: 'content', delta: 'Hi ' },
      { type: 'content', delta: 'there!' },
      { type: 'usage', prompt_tokens: 42, completion_tokens: 7 },
    ])
    expect(output).toHaveLength(1)
    expect(output[0]).toMatchObject({ role: 'assistant', content: 'Hi there!', thinking: 'Let me think.', model: 'test-model' })
  })

  it('sends the system prompt, history, tools, think and stream flag', async () => {
    const fake = createFakeOllama([{ chunks: [chunk.content('ok'), chunk.done()] }])
    await run(fake, { think: 'high' })
    expect(fake.requests[0]).toEqual({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'Hello' },
      ],
      stream: true,
      think: 'high',
      tools: TOOL_DEFINITIONS,
    })
  })

  it('omits think when set to auto', async () => {
    const fake = createFakeOllama([{ chunks: [chunk.done()] }])
    await run(fake, { think: 'auto' })
    expect(fake.requests[0]).not.toHaveProperty('think')
  })

  it('executes tool calls, feeds results back and continues', async () => {
    const fake = createFakeOllama([
      { chunks: [chunk.thinking('Need to search.'), chunk.toolCall('web_search', { query: 'ollama' }), chunk.done()] },
      { chunks: [chunk.content('Ollama runs models [source](https://ollama.com/).'), chunk.done()] },
    ])
    const { output, events } = await run(fake)

    expect(events.map((e) => e.type)).toEqual(['thinking', 'tool_call', 'usage', 'tool_result', 'content', 'usage'])
    expect(events[1]).toEqual({
      type: 'tool_call',
      call: { function: { name: 'web_search', arguments: { query: 'ollama' } } },
    })
    expect(events[3]).toMatchObject({ type: 'tool_result', name: 'web_search' })
    expect(fake.client.webSearch).toHaveBeenCalledWith({ query: 'ollama', max_results: 5 })

    expect(output.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant'])
    expect(output[1]).toMatchObject({ role: 'tool', tool_name: 'web_search' })
    expect(output[1].content).toContain('Ollama runs models')

    // The second request carries the assistant tool call (with its thinking) and the tool result.
    const second = fake.requests[1].messages!
    expect(second.slice(-2)).toEqual([
      {
        role: 'assistant',
        content: '',
        thinking: 'Need to search.',
        tool_calls: [{ function: { name: 'web_search', arguments: { query: 'ollama' } } }],
      },
      { role: 'tool', content: output[1].content, tool_name: 'web_search' },
    ])
  })

  it('runs several tool calls from one turn and records results in order', async () => {
    const fake = createFakeOllama([
      {
        chunks: [
          chunk.toolCall('get_current_datetime', { timezone: 'UTC' }),
          chunk.toolCall('web_fetch', { url: 'https://example.com' }),
          chunk.done(),
        ],
      },
      { chunks: [chunk.content('Done.'), chunk.done()] },
    ])
    const { output, events } = await run(fake, { now: () => new Date('2026-01-01T00:00:00Z') })
    const results = events.filter((e) => e.type === 'tool_result')
    expect(results.map((e) => e.name)).toEqual(['get_current_datetime', 'web_fetch'])
    expect(output.filter((m) => m.role === 'tool').map((m) => m.tool_name)).toEqual(['get_current_datetime', 'web_fetch'])
    expect(output[1].content).toContain('2026-01-01T00:00:00+00:00')
  })

  it('marks failed tool results', async () => {
    const fake = createFakeOllama([
      { chunks: [chunk.toolCall('web_fetch', { url: 'ftp://nope' }), chunk.done()] },
      { chunks: [chunk.content('Could not fetch.'), chunk.done()] },
    ])
    const { output, events } = await run(fake)
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ error: true })
    expect(output[1]).toMatchObject({ role: 'tool', tool_error: true })
  })

  it('retries without thinking when the model does not support it', async () => {
    const fake = createFakeOllama([
      { error: new HttpError('"test-model" does not support thinking', 400) },
      { chunks: [chunk.content('Plain answer'), chunk.done()] },
    ])
    const { output, events, error } = await run(fake, { think: 'on' })
    expect(error).toBeUndefined()
    expect(fake.requests[0].think).toBe(true)
    expect(fake.requests[1]).not.toHaveProperty('think')
    expect(events[0]).toEqual({ type: 'notice', message: 'test-model does not support thinking; answering without it.' })
    expect(output).toEqual([expect.objectContaining({ role: 'assistant', content: 'Plain answer' })])
  })

  it('retries without tools when the model does not support them', async () => {
    const fake = createFakeOllama([
      { error: new HttpError('registry.ollama.ai/library/test-model does not support tools', 400) },
      { chunks: [chunk.content('No tools here'), chunk.done()] },
    ])
    const { events, error } = await run(fake)
    expect(error).toBeUndefined()
    expect(fake.requests[1]).not.toHaveProperty('tools')
    expect(events[0].type).toBe('notice')
  })

  it('throws other errors', async () => {
    const fake = createFakeOllama([{ error: new HttpError('unauthorized', 401) }])
    const { error, output } = await run(fake)
    expect((error as Error).message).toBe('unauthorized')
    expect(output).toEqual([])
  })

  it('keeps partial output when the stream fails midway', async () => {
    const fake = createFakeOllama([{ chunks: [chunk.content('Partial')], streamError: new Error('connection reset') }])
    const { error, output } = await run(fake)
    expect((error as Error).message).toBe('connection reset')
    expect(output).toEqual([expect.objectContaining({ content: 'Partial' })])
  })

  it('stops quietly when aborted and keeps what was streamed', async () => {
    const fake = createFakeOllama([{ chunks: [chunk.content('Streaming…')], hang: true }])
    const controller = new AbortController()
    const output: ChatMessage[] = []
    const events: AgentEvent[] = []
    for await (const event of runAgent({
      client: fake.sdk,
      model: 'm',
      history: [{ role: 'user', content: 'hi' }],
      systemPrompt: '',
      output,
      signal: controller.signal,
    })) {
      events.push(event)
      if (event.type === 'content') controller.abort()
    }
    expect(events).toEqual([{ type: 'content', delta: 'Streaming…' }])
    expect(output).toEqual([expect.objectContaining({ role: 'assistant', content: 'Streaming…' })])
  })

  it('does nothing if already aborted', async () => {
    const fake = createFakeOllama()
    const controller = new AbortController()
    controller.abort()
    const { output, events } = await run(fake, { signal: controller.signal })
    expect(fake.client.chat).not.toHaveBeenCalled()
    expect(output).toEqual([])
    expect(events).toEqual([])
  })
})

describe('isEmptyMessage', () => {
  it('detects messages with nothing to show', () => {
    expect(isEmptyMessage({ role: 'assistant', content: '' })).toBe(true)
    expect(isEmptyMessage({ role: 'assistant', content: '', thinking: 't' })).toBe(false)
    expect(isEmptyMessage({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'x', arguments: {} } }] })).toBe(false)
  })
})
