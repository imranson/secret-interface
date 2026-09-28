import { describe, expect, it } from 'vitest'
import { groupByDate, upsertConversation } from '@/lib/format'
import type { ConversationSummary } from '@/lib/types'

const summary = (id: string, updated_at: string): ConversationSummary => ({
  id,
  title: id,
  created_at: updated_at,
  updated_at,
  archived: false,
  message_count: 1,
})

describe('groupByDate', () => {
  it('buckets conversations relative to now', () => {
    const now = new Date(2026, 8, 27, 15, 0)
    const at = (d: number, h = 12) => new Date(2026, 8, d, h).toISOString()
    const groups = groupByDate(
      [
        summary('today', at(27, 9)),
        summary('yesterday', at(26)),
        summary('week', at(22)),
        summary('month', at(5)),
        summary('older', new Date(2026, 5, 1).toISOString()),
      ],
      now,
    )
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Today', ['today']],
      ['Yesterday', ['yesterday']],
      ['Previous 7 days', ['week']],
      ['Previous 30 days', ['month']],
      ['June 2026', ['older']],
    ])
  })
})

describe('upsertConversation', () => {
  it('replaces an existing entry and keeps newest first', () => {
    const list = [summary('b', '2026-02-01T00:00:00Z'), summary('a', '2026-01-01T00:00:00Z')]
    const updated = upsertConversation(list, summary('a', '2026-03-01T00:00:00Z'))
    expect(updated.map((c) => c.id)).toEqual(['a', 'b'])
    expect(upsertConversation(list, summary('c', '2026-01-15T00:00:00Z')).map((c) => c.id)).toEqual(['b', 'c', 'a'])
  })
})
