import { isEmptyMessage, runAgent } from './agent'
import { getConfig, normalizeModelName } from './config'
import { describeError } from './errors'
import { getOllamaClient } from './ollama'
import { beginRun, endRun } from './run-state'
import { nextRunAt } from './schedule'
import { getScheduleStore } from './schedule-store'
import { getStore } from './store'
import type { ChatMessage, Schedule } from './types'

const TICK_MS = 30_000
const FIRST_TICK_MS = 2_000
const RUN_TIMEOUT_MS = 15 * 60_000

/** Asks the model for a fresh report. Nothing is saved here, so a failed run leaves the last report untouched. */
async function generateReport(schedule: Schedule, signal: AbortSignal): Promise<{ messages: ChatMessage[]; model: string }> {
  const config = getConfig()
  const model = normalizeModelName(schedule.model || config.defaultModel, config.host)
  const history: ChatMessage[] = [{ role: 'user', content: schedule.prompt, created_at: new Date().toISOString() }]
  const output: ChatMessage[] = []
  const events = runAgent({
    client: getOllamaClient(),
    model,
    history,
    systemPrompt: config.systemPrompt,
    think: schedule.think,
    timeZone: schedule.rule.timezone,
    signal,
    output,
  })
  for await (const _event of events) {
    // Nobody is watching a scheduled run live; the result is read back from `output`.
  }
  if (signal.aborted) throw new Error('The run was stopped before it finished.')
  const produced = output.filter((m) => !isEmptyMessage(m))
  if (!produced.at(-1)?.content.trim()) throw new Error('The model returned an empty reply.')
  return { messages: [...history, ...produced], model }
}

/**
 * Replaces the schedule's conversation with the new report, or creates it if there isn't one, so a schedule never
 * owns more than one. An archived conversation counts as gone: archiving keeps a report, so it is left as it is.
 */
async function publishReport(schedule: Schedule, messages: ChatMessage[], model: string): Promise<string> {
  const store = getStore()
  const existing = schedule.conversationId ? await store.get(schedule.conversationId) : null
  const conversation = existing && !existing.archived ? existing : store.create({ title: schedule.title })
  conversation.messages = messages
  conversation.model = model
  conversation.updated_at = new Date().toISOString()
  await store.save(conversation)
  return conversation.id
}

async function run(schedule: Schedule, controller: AbortController): Promise<void> {
  const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS)
  let conversationId = schedule.conversationId
  let error: string | null = null
  try {
    const { messages, model } = await generateReport(schedule, controller.signal)
    conversationId = await publishReport(schedule, messages, model)
  } catch (e) {
    error = describeError(e)
  } finally {
    clearTimeout(timeout)
  }

  const finished = new Date()
  await getScheduleStore().update(schedule.id, (latest) => {
    latest.lastRunAt = finished.toISOString()
    latest.lastError = error
    if (!error) {
      latest.conversationId = conversationId
      latest.unread = true
    }
    // Moved on only now: if the server dies mid-run the schedule is still due, and running it again just replaces the
    // report. This also covers "Run now" overlapping a scheduled time, which shouldn't then run twice.
    if (latest.nextRunAt && new Date(latest.nextRunAt) <= finished) latest.nextRunAt = nextRunAt(latest.rule, finished)
  })
}

/**
 * Starts a run in the background. Returns a promise for its end (it never rejects), or null if it can't start because
 * it is already running or its conversation has a reply in progress.
 */
export function startRun(schedule: Schedule): Promise<void> | null {
  const controller = beginRun(schedule.id, schedule.conversationId)
  if (!controller) return null
  return run(schedule, controller)
    .catch((error) => console.error(`Scheduled run failed for ${schedule.id}:`, error))
    .finally(() => endRun(schedule.id))
}

/**
 * Starts every due schedule and resolves once those runs end. A schedule that can't start stays due, so the next tick
 * retries it; that is how a refresh waits for a reply in progress.
 */
export async function tickSchedules(now: Date = new Date()): Promise<void> {
  const schedules = await getScheduleStore().list()
  const due = schedules.filter((s) => s.enabled && s.nextRunAt !== null && new Date(s.nextRunAt) <= now)
  await Promise.all(due.map(startRun))
}

/** Starts the background clock, once per process. Called from instrumentation.ts. */
export function startScheduler(): void {
  const key = Symbol.for('secret-interface.scheduler')
  const shared = globalThis as { [key]?: boolean }
  if (shared[key]) return
  shared[key] = true
  const tick = () => {
    tickSchedules().catch((error) => console.error('Scheduler tick failed:', error))
  }
  setInterval(tick, TICK_MS)
  // Picks up anything that came due while the server was down.
  setTimeout(tick, FIRST_TICK_MS)
}
