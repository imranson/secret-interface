import { describe, expect, it } from 'vitest'
import { estimateContextTokens, estimateTokens, formatTokenCount, MESSAGE_OVERHEAD_TOKENS } from '@/lib/tokens'
import { TOOL_DEFINITIONS } from '@/lib/tool-definitions'

describe('estimateTokens', () => {
  it('uses ~4 characters per token', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens(undefined)).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
    expect(estimateTokens('x'.repeat(4000))).toBe(1000)
  })
})

describe('estimateContextTokens', () => {
  it('counts the system prompt, messages, tools and draft', () => {
    const base = estimateContextTokens({ systemPrompt: 'x'.repeat(40), messages: [] })
    expect(base).toBe(MESSAGE_OVERHEAD_TOKENS + 10)

    const withMessage = estimateContextTokens({
      systemPrompt: 'x'.repeat(40),
      messages: [{ role: 'user', content: 'y'.repeat(400) }],
    })
    expect(withMessage).toBe(base + MESSAGE_OVERHEAD_TOKENS + 100)

    const withTools = estimateContextTokens({ systemPrompt: 'x'.repeat(40), messages: [], tools: TOOL_DEFINITIONS })
    expect(withTools).toBeGreaterThan(base + 50)

    const withDraft = estimateContextTokens({ systemPrompt: 'x'.repeat(40), messages: [], draft: 'z'.repeat(80) })
    expect(withDraft).toBe(base + MESSAGE_OVERHEAD_TOKENS + 20)
  })

  it('ignores thinking from earlier turns, like the request does', () => {
    const messages = [
      { role: 'user' as const, content: 'q' },
      { role: 'assistant' as const, content: 'a', thinking: 't'.repeat(4000) },
      { role: 'user' as const, content: 'q2' },
    ]
    const tokens = estimateContextTokens({ systemPrompt: '', messages })
    expect(tokens).toBeLessThan(50)
  })

  it('counts tool calls and results', () => {
    const tokens = estimateContextTokens({
      systemPrompt: '',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '', tool_calls: [{ function: { name: 'web_search', arguments: { query: 'abc' } } }] },
        { role: 'tool', content: 'r'.repeat(800), tool_name: 'web_search' },
      ],
    })
    expect(tokens).toBeGreaterThan(200)
  })
})

describe('formatTokenCount', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatTokenCount(950)).toBe('950')
    expect(formatTokenCount(1000)).toBe('1k')
    expect(formatTokenCount(1234)).toBe('1.2k')
    expect(formatTokenCount(12_345)).toBe('12k')
    expect(formatTokenCount(128_000)).toBe('128k')
    expect(formatTokenCount(1_000_000)).toBe('1M')
    expect(formatTokenCount(1_250_000)).toBe('1.3M')
  })
})
