/**
 * Who is writing to which conversation right now. A chat reply and a schedule refresh each save a whole conversation
 * when they finish, so if they overlapped the last one to finish would silently erase the other.
 *
 * Route handlers and the background scheduler are bundled separately and each get their own copy of this module, so
 * the state lives on globalThis. It is deliberately in memory: a restart ends every run, and its state with it.
 */
interface ScheduleRun {
  conversationId: string | null
  controller: AbortController
}

interface RunState {
  runs: Map<string, ScheduleRun>
  chats: Map<string, number>
}

const KEY = Symbol.for('secret-interface.run-state')
const shared = globalThis as { [KEY]?: RunState }
const state = (): RunState => (shared[KEY] ??= { runs: new Map(), chats: new Map() })

const refreshing = (conversationId: string) =>
  [...state().runs.values()].some((run) => run.conversationId === conversationId)

/** Claims a conversation for a chat reply; false while a schedule is refreshing it. */
export function beginChat(conversationId: string): boolean {
  if (refreshing(conversationId)) return false
  const { chats } = state()
  chats.set(conversationId, (chats.get(conversationId) ?? 0) + 1)
  return true
}

export function endChat(conversationId: string): void {
  const { chats } = state()
  const remaining = (chats.get(conversationId) ?? 0) - 1
  if (remaining > 0) chats.set(conversationId, remaining)
  else chats.delete(conversationId)
}

/** Claims a schedule's run; null if it is already running or its conversation has a reply in progress. */
export function beginRun(scheduleId: string, conversationId: string | null): AbortController | null {
  const { runs, chats } = state()
  if (runs.has(scheduleId) || (conversationId && chats.has(conversationId))) return null
  const controller = new AbortController()
  runs.set(scheduleId, { conversationId, controller })
  return controller
}

export function endRun(scheduleId: string): void {
  state().runs.delete(scheduleId)
}

export function isRunning(scheduleId: string): boolean {
  return state().runs.has(scheduleId)
}

export function cancelRun(scheduleId: string): void {
  state().runs.get(scheduleId)?.controller.abort()
}
