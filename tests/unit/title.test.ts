import { describe, expect, it } from 'vitest'
import { deriveTitle, MAX_TITLE_LENGTH } from '@/lib/title'

describe('deriveTitle', () => {
  it('uses the first non-empty line', () => {
    expect(deriveTitle('\n\n  Plan a trip to Lisbon  \nwith details')).toBe('Plan a trip to Lisbon')
  })

  it('strips Markdown syntax and keeps link text', () => {
    expect(deriveTitle('## **Compare** `bun` and [Node](https://nodejs.org)')).toBe('Compare bun and Node')
  })

  it('truncates long titles with an ellipsis', () => {
    const title = deriveTitle('word '.repeat(40))
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH)
    expect(title.endsWith('…')).toBe(true)
  })

  it('falls back for empty input', () => {
    expect(deriveTitle('   ')).toBe('New conversation')
    expect(deriveTitle('***')).toBe('New conversation')
  })
})
