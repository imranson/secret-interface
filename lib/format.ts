import type { ConversationSummary } from './types'

export interface ConversationGroup {
  label: string
  items: ConversationSummary[]
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const DAY = 86_400_000

/** Buckets conversations (already sorted newest first) into Today / Yesterday / … groups. */
export function groupByDate(conversations: ConversationSummary[], now: Date = new Date()): ConversationGroup[] {
  const today = startOfDay(now)
  const buckets: [string, (t: number) => boolean][] = [
    ['Today', (t) => t >= today],
    ['Yesterday', (t) => t >= today - DAY],
    ['Previous 7 days', (t) => t >= today - 7 * DAY],
    ['Previous 30 days', (t) => t >= today - 30 * DAY],
  ]
  const groups = new Map<string, ConversationSummary[]>()
  for (const conversation of conversations) {
    const time = new Date(conversation.updated_at).getTime()
    const label =
      buckets.find(([, test]) => test(time))?.[0] ??
      new Date(time).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    groups.set(label, [...(groups.get(label) ?? []), conversation])
  }
  return [...groups].map(([label, items]) => ({ label, items }))
}

/** Inserts or replaces a summary, keeping the list sorted newest first. */
export function upsertConversation(list: ConversationSummary[], summary: ConversationSummary): ConversationSummary[] {
  return [summary, ...list.filter((c) => c.id !== summary.id)].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}
