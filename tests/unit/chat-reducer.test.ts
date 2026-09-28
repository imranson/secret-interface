import { describe, expect, it } from 'vitest'
import { applyStreamEvent } from '@/lib/chat-reducer'
import type { ChatMessage, StreamEvent } from '@/lib/types'

const now = () => 'T'
const reduce = (messages: ChatMessage[], events: StreamEvent[]) =>
  events.reduce((acc, e) => applyStreamEvent(acc, e, now), messages)

describe('applyStreamEvent', () => {
  const call = { function: { name: 'web_search', arguments: { query: 'q' } } }

  it('starts an assistant message after the user message and appends tokens', () => {
    const messages = reduce(
      [{ role: 'user', content: 'hi' }],
      [
        { type: 'thinking', delta: 'Hmm' },
        { type: 'thinking', delta: '…' },
        { type: 'content', delta: 'Hel' },
        { type: 'content', delta: 'lo' },
      ],
    )
    expect(messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello', thinking: 'Hmm…', created_at: 'T' },
    ])
  })

  it('attaches tool calls, records results and starts a new assistant message afterwards', () => {
    const messages = reduce(
      [{ role: 'user', content: 'hi' }],
      [
        { type: 'content', delta: 'Searching.' },
        { type: 'tool_call', call },
        { type: 'tool_result', name: 'web_search', content: 'results' },
        { type: 'tool_result', name: 'web_fetch', content: 'Error: x', error: true },
        { type: 'content', delta: 'Answer' },
      ],
    )
    expect(messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Searching.', tool_calls: [call], created_at: 'T' },
      { role: 'tool', tool_name: 'web_search', content: 'results', created_at: 'T' },
      { role: 'tool', tool_name: 'web_fetch', content: 'Error: x', created_at: 'T', tool_error: true },
      { role: 'assistant', content: 'Answer', created_at: 'T' },
    ])
  })

  it('does not mutate the previous state', () => {
    const before: ChatMessage[] = [{ role: 'assistant', content: 'a' }]
    const after = applyStreamEvent(before, { type: 'content', delta: 'b' })
    expect(before).toEqual([{ role: 'assistant', content: 'a' }])
    expect(after[0].content).toBe('ab')
    expect(after).not.toBe(before)
  })

  it('ignores lifecycle events', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'x' }]
    for (const event of [
      { type: 'usage', prompt_tokens: 1, completion_tokens: 1 },
      { type: 'notice', message: 'n' },
      { type: 'error', message: 'e' },
    ] as StreamEvent[]) {
      expect(applyStreamEvent(messages, event)).toBe(messages)
    }
  })
})
