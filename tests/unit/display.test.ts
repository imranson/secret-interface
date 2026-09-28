import { describe, expect, it } from 'vitest'
import { buildDisplayItems } from '@/lib/display'
import type { ChatMessage } from '@/lib/types'

const search = (query: string) => ({ function: { name: 'web_search', arguments: { query } } })

describe('buildDisplayItems', () => {
  it('groups a reply (thinking, tools, text) under one assistant block', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'hidden' },
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: '', thinking: 'plan', tool_calls: [search('a'), search('b')] },
      { role: 'tool', tool_name: 'web_search', content: 'result a' },
      { role: 'tool', tool_name: 'web_search', content: 'result b', tool_error: true },
      { role: 'assistant', content: 'Answer' },
      { role: 'user', content: 'Thanks' },
    ]
    const items = buildDisplayItems(messages)
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'user'])
    const reply = items[1]
    if (reply.kind !== 'assistant') throw new Error('expected assistant')
    expect(reply.parts).toEqual([
      { kind: 'thinking', text: 'plan', active: false },
      { kind: 'tool', name: 'web_search', args: { query: 'a' }, result: 'result a', error: false, pending: false },
      { kind: 'tool', name: 'web_search', args: { query: 'b' }, result: 'result b', error: true, pending: false },
      { kind: 'text', text: 'Answer' },
    ])
    expect(reply.streaming).toBe(false)
  })

  it('pairs results with calls by tool name', () => {
    const items = buildDisplayItems([
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [search('x'), { function: { name: 'get_current_datetime', arguments: {} } }],
      },
      { role: 'tool', tool_name: 'get_current_datetime', content: 'now' },
      { role: 'tool', tool_name: 'web_search', content: 'found' },
    ])
    const reply = items[1]
    if (reply.kind !== 'assistant') throw new Error('expected assistant')
    expect(reply.parts.map((p) => (p.kind === 'tool' ? [p.name, p.result] : p.kind))).toEqual([
      ['web_search', 'found'],
      ['get_current_datetime', 'now'],
    ])
  })

  it('marks live thinking and pending tools while streaming', () => {
    const thinking = buildDisplayItems([{ role: 'user', content: 'q' }, { role: 'assistant', content: '', thinking: 'hmm' }], true)
    const reply = thinking[1]
    if (reply.kind !== 'assistant') throw new Error('expected assistant')
    expect(reply.streaming).toBe(true)
    expect(reply.parts[0]).toMatchObject({ kind: 'thinking', active: true })

    const answering = buildDisplayItems(
      [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a', thinking: 'hmm' }],
      true,
    )
    const second = answering[1]
    if (second.kind !== 'assistant') throw new Error('expected assistant')
    expect(second.parts[0]).toMatchObject({ kind: 'thinking', active: false })

    const tools = buildDisplayItems([{ role: 'user', content: 'q' }, { role: 'assistant', content: '', tool_calls: [search('a')] }], true)
    const third = tools[1]
    if (third.kind !== 'assistant') throw new Error('expected assistant')
    expect(third.parts[0]).toMatchObject({ kind: 'tool', pending: true })
  })

  it('does not leave tools spinning once streaming has stopped', () => {
    const items = buildDisplayItems([{ role: 'user', content: 'q' }, { role: 'assistant', content: '', tool_calls: [search('a')] }])
    const reply = items[1]
    if (reply.kind !== 'assistant') throw new Error('expected assistant')
    expect(reply.parts[0]).toMatchObject({ kind: 'tool', pending: false })
    expect(reply.parts[0]).not.toHaveProperty('result')
  })

  it('shows orphan tool results as their own card', () => {
    const items = buildDisplayItems([{ role: 'user', content: 'q' }, { role: 'tool', tool_name: 'web_fetch', content: 'page' }])
    const reply = items[1]
    if (reply.kind !== 'assistant') throw new Error('expected assistant')
    expect(reply.parts).toEqual([{ kind: 'tool', name: 'web_fetch', args: {}, result: 'page', error: false, pending: false }])
  })
})
