import { runChatTurn } from './chat'
import { describeError } from './errors'
import { nextRunAtFromRule } from './schedule'
import { getScheduledStore } from './schedule-store'
import { getStore } from './store'
import type { Conversation, ScheduledMessage } from './types'

const TICK_MS = 30_000

/** Schedules being run right now, so overlapping ticks (or the manual endpoint) never double-run. */
const running = new Set<string>()

/**
 * Sends one scheduled message to the AI. A one-off is appended to its target conversation (or a
 * new one when that is missing/archived); a recurring schedule always starts a fresh conversation.
 */
export async function runSchedule(schedule: ScheduledMessage): Promise<void> {
  const scheduleStore = getScheduledStore()
  const now = new Date()

  // Claim the run up front so a crash mid-run cannot re-fire it on restart.
  schedule.nextRunAt = schedule.rule.kind === 'once' ? null : nextRunAtFromRule(schedule.rule, now)
  schedule.lastRunAt = now.toISOString()
  schedule.lastError = null
  await scheduleStore.save(schedule)

  let conversation: Conversation | undefined
  if (schedule.rule.kind === 'once' && schedule.conversationId) {
    const existing = await getStore().get(schedule.conversationId)
    if (existing && !existing.archived) conversation = existing
  }

  let conversationId: string | null = null
  const errors: string[] = []
  try {
    for await (const event of runChatTurn({
      message: schedule.message,
      conversation,
      think: schedule.think,
      model: schedule.model,
      timezone: schedule.timezone,
    })) {
      if (event.type === 'start' || event.type === 'done') conversationId = event.conversation.id
      else if (event.type === 'error') errors.push(event.message)
    }
  } catch (error) {
    errors.push(describeError(error))
  }

  schedule.lastConversationId = conversationId
  schedule.unread = conversationId !== null && errors.length === 0
  schedule.lastError = errors.length > 0 ? errors.join(' ') : null
  schedule.updated_at = new Date().toISOString()
  await scheduleStore.save(schedule)
}

/**
 * Starts every due schedule. Returns how many were started. By default runs are fired and forgotten
 * (the interval calls this); pass `await: true` to wait for all of them (the manual endpoint/tests).
 */
export async function tickSchedules(options: { await?: boolean } = {}): Promise<number> {
  const due = await getScheduledStore().listDue()
  const tasks: Promise<void>[] = []
  let started = 0
  for (const schedule of due) {
    if (running.has(schedule.id)) continue
    running.add(schedule.id)
    started++
    const task = runSchedule(schedule)
      .catch((error) => console.error(`Scheduled run failed for ${schedule.id}:`, error))
      .finally(() => running.delete(schedule.id))
    if (options.await) tasks.push(task)
  }
  if (options.await) await Promise.all(tasks)
  return started
}

/** Starts the background interval (once per process). Used by instrumentation.ts. */
export function startScheduler(): void {
  const key = Symbol.for('secret-interface.scheduler')
  const global = globalThis as { [key: symbol]: ReturnType<typeof setInterval> | undefined }
  if (global[key]) return
  const tick = () => {
    tickSchedules().catch((error) => console.error('Scheduler tick failed:', error))
  }
  global[key] = setInterval(tick, TICK_MS)
  // Catch anything overdue while the server was down, shortly after boot.
  setTimeout(tick, 2000)
}
