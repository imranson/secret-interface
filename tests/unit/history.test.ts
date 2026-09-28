import { describe, expect, it } from 'vitest'
import { toOllamaMessages } from '@/lib/history'
import type { ChatMessage } from '@/lib/types'

describe('toOllamaMessages', () => {
  const call = { function: { name: 'web_search', arguments: { query: 'x' } } }

  it('prepends the system prompt', () => {
    const out = toOllamaMessages('SYS', [{ role: 'user', content: 'hi' }])
    expect(out).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'hi' },
    ])
  })

  it('does not add a system prompt when the conversation has one', () => {
    const out = toOllamaMessages('SYS', [
      { role: 'system', content: 'custom' },
      { role: 'user', content: 'hi' },
    ])
    expect(out[0]).toEqual({ role: 'system', content: 'custom' })
    expect(out).toHaveLength(2)
  })

  it('keeps thinking only for the current turn and strips UI metadata', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'q1', created_at: 't' },
      { role: 'assistant', content: 'a1', thinking: 'old thoughts', model: 'm' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: '', thinking: 'new thoughts', tool_calls: [call] },
      { role: 'tool', content: 'result', tool_name: 'web_search', tool_error: false },
    ]
    const out = toOllamaMessages('', messages)
    expect(out).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: '', thinking: 'new thoughts', tool_calls: [call] },
      { role: 'tool', content: 'result', tool_name: 'web_search' },
    ])
  })

  it('drops roles Ollama does not understand', () => {
    const out = toOllamaMessages('', [
      { role: 'user', content: 'hi' },
      { role: 'function' as never, content: 'legacy' },
    ])
    expect(out).toEqual([{ role: 'user', content: 'hi' }])
  })
})
