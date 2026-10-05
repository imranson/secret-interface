import { describe, expect, it } from 'vitest'
import { conversationIdFromPath, conversationPath } from '@/lib/routes'

describe('conversation routes', () => {
  it('round-trips a conversation id through its path', () => {
    expect(conversationPath('abc_123-x')).toBe('/c/abc_123-x')
    expect(conversationIdFromPath(conversationPath('abc_123-x'))).toBe('abc_123-x')
    expect(conversationIdFromPath('/c/abc/')).toBe('abc')
  })

  it('treats any other path as a new conversation', () => {
    for (const path of ['/', '/c', '/c/', '/c/a/b', '/x/abc', null]) expect(conversationIdFromPath(path)).toBeNull()
  })

  it('tolerates malformed escapes', () => {
    expect(conversationIdFromPath('/c/%E0%A4%A')).toBe('%E0%A4%A')
  })
})
