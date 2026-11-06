'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  getConversation,
  getModelInfo,
  listConversations,
  listModels,
  setArchived as setArchivedApi,
  streamChat,
} from '@/lib/api-client'
import { applyStreamEvent } from '@/lib/chat-reducer'
import { upsertConversation } from '@/lib/format'
import { conversationIdFromPath, conversationPath } from '@/lib/routes'
import { defaultScheduleDraft, describeRule, formatRunTime, ruleFromDraft, type ScheduleDraft } from '@/lib/schedule'
import { sidebarCookie } from '@/lib/sidebar'
import { estimateContextTokens, estimateTokens, MESSAGE_OVERHEAD_TOKENS } from '@/lib/tokens'
import { TOOL_DEFINITIONS } from '@/lib/tool-definitions'
import {
  BACKENDS,
  isBackend,
  THINK_OPTIONS,
  type Backend,
  type ChatMessage,
  type ConversationSummary,
  type ThinkOption,
} from '@/lib/types'
import { Composer } from './Composer'
import { ContextMeter } from './ContextMeter'
import { ArchiveIcon, RepeatIcon, RestoreIcon, SidebarIcon } from './Icons'
import { MessageList } from './MessageList'
import { SchedulePicker } from './SchedulePicker'
import { Sidebar, type SidebarView } from './Sidebar'
import { useSchedules } from './useSchedules'

const THINK_LABELS: Record<ThinkOption, string> = {
  auto: 'Thinking: auto',
  off: 'Thinking: off',
  on: 'Thinking: on',
  low: 'Thinking: low',
  medium: 'Thinking: medium',
  high: 'Thinking: high',
  max: 'Thinking: max',
}

const BACKEND_LABELS: Record<Backend, string> = { cloud: 'Cloud', local: 'Local' }

const PREF_THINK = 'secret-interface.think'
const PREF_MODEL = 'secret-interface.model'
const PREF_BACKEND = 'secret-interface.backend'

/** Each backend remembers its own model; the cloud keeps the original key. */
const modelPref = (backend: Backend) => (backend === 'cloud' ? PREF_MODEL : `${PREF_MODEL}.${backend}`)

function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage unavailable (private mode etc.); preferences just won't persist.
  }
}

// The small-screen breakpoint in globals.css, below which the sidebar is a drawer instead of a column.
const NARROW_SCREEN = '(max-width: 820px)'

function narrowScreenQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_SCREEN) : null
}

function subscribeToScreenSize(onChange: () => void) {
  const query = narrowScreenQuery()
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

const isNarrowScreen = () => narrowScreenQuery()?.matches ?? false
const isNarrowScreenOnServer = () => false

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface CurrentConversation {
  id: string | null
  title: string
  archived: boolean
  messages: ChatMessage[]
}

const NEW_CONVERSATION: CurrentConversation = { id: null, title: 'New conversation', archived: false, messages: [] }

export interface ChatAppProps {
  defaultModel: string
  defaultContextWindow: number
  systemPrompt: string
  /** Start with the sidebar collapsed on wide screens (restored from a cookie by the page). */
  sidebarCollapsed?: boolean
}

export function ChatApp({
  defaultModel,
  defaultContextWindow,
  systemPrompt,
  sidebarCollapsed: initiallyCollapsed = false,
}: ChatAppProps) {
  const router = useRouter()
  const routeId = conversationIdFromPath(usePathname())
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [archivedList, setArchivedList] = useState<ConversationSummary[] | null>(null)
  const [view, setView] = useState<SidebarView>('recent')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initiallyCollapsed)
  const narrow = useSyncExternalStore(subscribeToScreenSize, isNarrowScreen, isNarrowScreenOnServer)
  const [current, setCurrent] = useState<CurrentConversation>(NEW_CONVERSATION)
  // A conversation URL loads its conversation once mounted; say so from the first paint.
  const [loading, setLoading] = useState(routeId !== null)
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [backend, setBackend] = useState<Backend>('cloud')
  // The host the model list came from, shown as the backend picker's tooltip.
  const [host, setHost] = useState<string | null>(null)
  // `null` while the backend's models are loading.
  const [models, setModels] = useState<string[] | null>([defaultModel])
  const [model, setModel] = useState(defaultModel)
  const [think, setThink] = useState<ThinkOption>('auto')
  const [contextWindow, setContextWindow] = useState(defaultContextWindow)
  const [lastUsage, setLastUsage] = useState<{ prompt_tokens: number; completion_tokens: number } | null>(null)
  // Set while the composer is scheduling its text rather than sending it.
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  // The conversation shown or being loaded. Clicks update it and the URL together, so the view only follows the URL
  // when it moves on its own (first load, back/forward).
  const viewIdRef = useRef<string | null>(null)
  // Bumped whenever the view changes conversation, so late events from an old stream are ignored.
  const runRef = useRef(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Bumped per model-list request, so switching backends quickly can't apply a stale list.
  const modelsRequestRef = useRef(0)

  const scheduling = useSchedules((schedule) => {
    listConversations()
      .then(setConversations)
      .catch(() => {})
    // Swap in the new report if it's on screen. Replying is blocked during a refresh, so nothing here is in progress.
    const id = schedule.conversationId
    if (!id || id !== viewIdRef.current || schedule.lastError) return
    const run = runRef.current
    getConversation(id)
      .then((c) => {
        if (run === runRef.current) setCurrent({ id: c.id, title: c.title, archived: c.archived, messages: c.messages })
      })
      .catch(() => {})
  })
  const { schedules, markRead } = scheduling
  const openSchedule = current.id ? schedules.find((s) => s.conversationId === current.id) : undefined
  const refreshing = openSchedule?.status === 'running'

  const openScheduleId = openSchedule?.id
  const openScheduleUnread = openSchedule?.unread
  useEffect(() => {
    if (openScheduleId && openScheduleUnread) markRead(openScheduleId).catch(() => {})
  }, [openScheduleId, openScheduleUnread, markRead])

  const loadModels = useCallback(async (target: Backend) => {
    const request = ++modelsRequestRef.current
    try {
      const list = await listModels(target)
      if (request !== modelsRequestRef.current) return
      setModels(list.models)
      setHost(list.host)
      const saved = readPref(modelPref(target))
      setModel(saved && list.models.includes(saved) ? saved : list.defaultModel)
      if (list.error) setError(`Could not list models from ${list.host}: ${list.error}`)
    } catch (e) {
      if (request !== modelsRequestRef.current) return
      // Keep the server-rendered default on the cloud; a local list has nothing to fall back to.
      setModels((current) => current ?? [])
      setError(`Could not list models: ${messageOf(e)}`)
    }
  }, [])

  /** Clears the model until the new backend's list arrives, so a reply can't pair one backend with another's model. */
  const switchBackend = (next: Backend) => {
    setBackend(next)
    setModels(null)
    setModel('')
    setHost(null)
    setError(null)
    loadModels(next)
  }

  useEffect(() => {
    listConversations()
      .then(setConversations)
      .catch((e) => setError(`Could not load conversations: ${messageOf(e)}`))
    const savedBackend = readPref(PREF_BACKEND)
    const initialBackend = isBackend(savedBackend) ? savedBackend : 'cloud'
    if (initialBackend !== 'cloud') {
      // The server rendered the cloud default, which means nothing to another backend.
      setBackend(initialBackend)
      setModels(null)
      setModel('')
    }
    loadModels(initialBackend)
    const savedThink = readPref(PREF_THINK)
    if (savedThink && (THINK_OPTIONS as readonly string[]).includes(savedThink)) setThink(savedThink as ThinkOption)
  }, [loadModels])

  useEffect(() => {
    if (!model) return
    let cancelled = false
    getModelInfo(model, backend)
      .then((info) => {
        if (!cancelled) setContextWindow(info.contextLength)
      })
      .catch(() => {
        if (!cancelled) setContextWindow(defaultContextWindow)
      })
    return () => {
      cancelled = true
    }
  }, [model, backend, defaultContextWindow])

  const historyTokens = useMemo(
    () => estimateContextTokens({ systemPrompt, messages: current.messages, tools: TOOL_DEFINITIONS }),
    [systemPrompt, current.messages],
  )
  const draftTokens = draft.trim() ? MESSAGE_OVERHEAD_TOKENS + estimateTokens(draft) : 0

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const resetView = useCallback(() => {
    stopStreaming()
    runRef.current++
    setStreaming(false)
    setError(null)
    setNotice(null)
    setLastUsage(null)
    setSidebarOpen(false)
  }, [stopStreaming])

  const newConversation = useCallback(() => {
    resetView()
    viewIdRef.current = null
    setLoading(false)
    setCurrent(NEW_CONVERSATION)
    inputRef.current?.focus()
  }, [resetView])

  const openConversation = async (id: string) => {
    if (id === viewIdRef.current) {
      setSidebarOpen(false)
      return
    }
    resetView()
    viewIdRef.current = id
    const run = runRef.current
    setLoading(true)
    try {
      const conversation = await getConversation(id)
      if (run !== runRef.current) return
      setCurrent({
        id: conversation.id,
        title: conversation.title,
        archived: conversation.archived,
        messages: conversation.messages,
      })
    } catch (e) {
      if (run !== runRef.current) return
      // Don't leave the previous conversation on screen under this URL, where a reply would be sent to it.
      setCurrent(NEW_CONVERSATION)
      setError(`Could not open conversation: ${messageOf(e)}`)
    } finally {
      if (run === runRef.current) setLoading(false)
    }
  }

  const followUrl = useEffectEvent((id: string | null) => {
    if (id === viewIdRef.current) return
    if (id) openConversation(id)
    else newConversation()
  })

  useEffect(() => followUrl(routeId), [routeId])

  const sidebarVisible = narrow ? sidebarOpen : !sidebarCollapsed

  const toggleSidebar = () => {
    if (narrow) {
      setSidebarOpen((open) => !open)
      return
    }
    const collapsed = !sidebarCollapsed
    setSidebarCollapsed(collapsed)
    document.cookie = sidebarCookie(collapsed)
  }

  const changeView = (next: SidebarView) => {
    setView(next)
    if (next === 'archived' && archivedList === null) {
      listConversations(true)
        .then(setArchivedList)
        .catch((e) => {
          setArchivedList([])
          setError(`Could not load archive: ${messageOf(e)}`)
        })
    }
  }

  const archive = async (id: string) => {
    try {
      const summary = await setArchivedApi(id, true)
      setConversations((list) => list.filter((c) => c.id !== id))
      setArchivedList((list) => (list ? upsertConversation(list, summary) : list))
      if (current.id === id) {
        newConversation()
        router.push('/')
      }
    } catch (e) {
      setError(`Could not archive: ${messageOf(e)}`)
    }
  }

  const restore = async (id: string) => {
    try {
      const summary = await setArchivedApi(id, false)
      setArchivedList((list) => (list ? list.filter((c) => c.id !== id) : list))
      setConversations((list) => upsertConversation(list, summary))
      if (current.id === id) setCurrent((c) => ({ ...c, archived: false }))
    } catch (e) {
      setError(`Could not restore: ${messageOf(e)}`)
    }
  }

  /** Streams a reply for `message`, applying events to the message list the caller already updated. */
  const streamReply = async ({
    message,
    conversationId,
    editIndex,
    rollback,
  }: {
    message: string
    conversationId: string | null
    editIndex?: number
    /** Restores the message list if the request is rejected before anything is saved. */
    rollback: () => void
  }) => {
    const run = ++runRef.current
    const isNew = conversationId === null
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setNotice(null)
    setStreaming(true)

    let started = false
    try {
      const events = streamChat(
        {
          conversationId,
          message,
          think,
          model,
          backend,
          timezone: browserTimeZone(),
          ...(editIndex !== undefined && { editIndex }),
        },
        controller.signal,
      )
      for await (const event of events) {
        if (run !== runRef.current) break
        switch (event.type) {
          case 'start':
            started = true
            viewIdRef.current = event.conversation.id
            setCurrent((c) => ({ ...c, id: event.conversation.id, title: event.conversation.title }))
            // Give a new conversation its own URL without remounting anything or adding a history entry.
            if (isNew) window.history.replaceState(null, '', conversationPath(event.conversation.id))
            setConversations((list) => upsertConversation(list, event.conversation))
            break
          case 'usage':
            setLastUsage({ prompt_tokens: event.prompt_tokens, completion_tokens: event.completion_tokens })
            break
          case 'notice':
            setNotice(event.message)
            break
          case 'error':
            setError(event.message)
            break
          case 'done':
            setConversations((list) => upsertConversation(list, event.conversation))
            break
          default:
            setCurrent((c) => ({ ...c, messages: applyStreamEvent(c.messages, event) }))
        }
      }
    } catch (e) {
      if (run !== runRef.current) return
      if (controller.signal.aborted) {
        // Stopped by the user: the server saves the partial reply; refresh the sidebar order.
        listConversations()
          .then(setConversations)
          .catch(() => {})
      } else if (!started) {
        // Rejected before anything was saved: put the message list back and give the text back.
        rollback()
        setError(messageOf(e))
      } else {
        setError(messageOf(e))
      }
    } finally {
      if (run === runRef.current) {
        setStreaming(false)
        abortRef.current = null
      }
    }
  }

  const send = async () => {
    const text = draft.trim()
    if (!text || streaming || current.archived || loading) return
    const userMessage: ChatMessage = { role: 'user', content: text, created_at: new Date().toISOString() }
    setCurrent((c) => ({ ...c, messages: [...c.messages, userMessage] }))
    setDraft('')
    await streamReply({
      message: text,
      conversationId: current.id,
      rollback: () => {
        setCurrent((c) => ({ ...c, messages: c.messages.filter((m) => m !== userMessage) }))
        setDraft((d) => d || text)
      },
    })
  }

  /** Replaces a user message and regenerates the reply after it. */
  const editMessage = async (index: number, newText: string) => {
    const text = newText.trim()
    if (!text || streaming || current.archived || loading || current.id === null) return
    const original = current.messages
    const edited: ChatMessage = { ...current.messages[index], content: text }
    setCurrent((c) => ({ ...c, messages: [...c.messages.slice(0, index), edited] }))
    await streamReply({
      message: text,
      conversationId: current.id,
      editIndex: index,
      rollback: () => setCurrent((c) => ({ ...c, messages: original })),
    })
  }

  const timezone = browserTimeZone() ?? 'UTC'
  const scheduleRule = scheduleDraft && ruleFromDraft(scheduleDraft, timezone)

  const startScheduling = () => {
    setScheduleDraft((d) => d ?? defaultScheduleDraft())
    setSidebarOpen(false)
    inputRef.current?.focus()
  }

  /** Schedules the composer's text. Nothing runs until its first scheduled time, or until "Run now". */
  const createScheduleFromComposer = async () => {
    const text = draft.trim()
    if (!text || !scheduleRule) return
    try {
      const schedule = await scheduling.create({ prompt: text, rule: scheduleRule, model, backend, think })
      setDraft('')
      setScheduleDraft(null)
      setView('scheduled')
      setError(null)
      const next = schedule.nextRunAt ? ` First run: ${formatRunTime(schedule.nextRunAt)}.` : ''
      setNotice(`Scheduled “${schedule.title}”: ${describeRule(schedule.rule)}.${next}`)
    } catch (e) {
      setError(`Could not schedule: ${messageOf(e)}`)
    }
  }

  const reportScheduleError = (action: string) => (e: unknown) => setError(`Could not ${action}: ${messageOf(e)}`)

  const empty = (
    <div className="empty">
      <h1 className="empty-title">Nice to meet you, stranger.</h1>
      <p className="empty-sub">Ask anything. I can search the web, read pages, and check today’s date.</p>
    </div>
  )

  return (
    <div className="app">
      <Sidebar
        view={view}
        onViewChange={changeView}
        conversations={conversations}
        archived={archivedList}
        schedules={schedules}
        currentId={current.id}
        busyId={streaming ? current.id : null}
        open={sidebarOpen}
        collapsed={!narrow && sidebarCollapsed}
        onSelect={openConversation}
        onNew={newConversation}
        onArchive={archive}
        onRestore={restore}
        onNewSchedule={startScheduling}
        onRunSchedule={(id) => scheduling.run(id).catch(reportScheduleError('run the schedule'))}
        onSetScheduleEnabled={(id, enabled) =>
          scheduling.setEnabled(id, enabled).catch(reportScheduleError('update the schedule'))
        }
        onDeleteSchedule={(id) => scheduling.remove(id).catch(reportScheduleError('delete the schedule'))}
      />
      {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

      <main className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-button"
            aria-label={sidebarVisible ? 'Hide conversations' : 'Show conversations'}
            title={sidebarVisible ? 'Hide conversations' : 'Show conversations'}
            onClick={toggleSidebar}
          >
            <SidebarIcon />
          </button>
          <h1 className="topbar-title">{current.title}</h1>
          {current.id &&
            (current.archived ? (
              <button type="button" className="ghost-button" onClick={() => restore(current.id!)}>
                <RestoreIcon /> Restore
              </button>
            ) : (
              <button
                type="button"
                className="ghost-button"
                onClick={() => archive(current.id!)}
                disabled={streaming}
                title={streaming ? 'Wait for the reply to finish' : 'Move to the archive folder'}
              >
                <ArchiveIcon /> Archive
              </button>
            ))}
        </header>

        {loading ? (
          <div className="messages">
            <p className="loading">Loading conversation…</p>
          </div>
        ) : (
          <MessageList
            conversationKey={current.id ?? 'new'}
            messages={current.messages}
            streaming={streaming}
            empty={empty}
            onEditMessage={editMessage}
          />
        )}

        <div className="composer-wrap">
          {(error || notice) && (
            <div className="banners">
              {error && (
                <div className="banner is-error" role="alert">
                  <span>{error}</span>
                  <button type="button" className="banner-close" aria-label="Dismiss error" onClick={() => setError(null)}>
                    ×
                  </button>
                </div>
              )}
              {notice && (
                <div className="banner" role="status">
                  <span>{notice}</span>
                  <button type="button" className="banner-close" aria-label="Dismiss notice" onClick={() => setNotice(null)}>
                    ×
                  </button>
                </div>
              )}
            </div>
          )}
          {current.archived && (
            <div className="banner" role="status">
              <span>This conversation is archived.</span>
              <button type="button" className="link-button" onClick={() => restore(current.id!)}>
                Restore to continue
              </button>
            </div>
          )}
          {openSchedule && !current.archived && (
            <p className="schedule-note" role="status">
              <RepeatIcon width={13} height={13} />
              {refreshing
                ? 'Refreshing. The new report will replace this conversation.'
                : openSchedule.lastError
                  ? 'The last run failed, so this is the previous report.'
                  : `${describeRule(openSchedule.rule)}. Each run replaces this conversation, including replies.`}
            </p>
          )}
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={scheduleDraft ? createScheduleFromComposer : send}
            onStop={stopStreaming}
            streaming={streaming}
            disabled={loading || (!scheduleDraft && (current.archived || refreshing))}
            inputRef={inputRef}
            placeholder={
              scheduleDraft
                ? 'What should run on a schedule?'
                : current.messages.length
                  ? 'Reply…'
                  : 'Ask anything…'
            }
            schedulePicker={
              scheduleDraft && <SchedulePicker draft={scheduleDraft} timezone={timezone} onChange={setScheduleDraft} />
            }
            scheduleReady={scheduleRule !== null}
            toolbar={
              <>
                <button
                  type="button"
                  className="pill-button"
                  aria-pressed={scheduleDraft !== null}
                  title="Run this prompt on a schedule"
                  disabled={streaming}
                  onClick={() => (scheduleDraft ? setScheduleDraft(null) : startScheduling())}
                >
                  <RepeatIcon width={13} height={13} /> Repeat
                </button>
                <select
                  className="pill-select"
                  aria-label="Ollama server"
                  title={host ? `Models from ${host}` : undefined}
                  value={backend}
                  onChange={(e) => {
                    const next = e.target.value as Backend
                    writePref(PREF_BACKEND, next)
                    switchBackend(next)
                  }}
                >
                  {BACKENDS.map((b) => (
                    <option key={b} value={b}>
                      {BACKEND_LABELS[b]}
                    </option>
                  ))}
                </select>
                <select
                  className="pill-select"
                  aria-label="Model"
                  value={model}
                  disabled={!models?.length}
                  onChange={(e) => {
                    setModel(e.target.value)
                    writePref(modelPref(backend), e.target.value)
                  }}
                >
                  {!models?.length && <option value="">{models ? 'No models' : 'Loading models…'}</option>}
                  {models?.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  className="pill-select"
                  aria-label="Thinking"
                  value={think}
                  onChange={(e) => {
                    setThink(e.target.value as ThinkOption)
                    writePref(PREF_THINK, e.target.value)
                  }}
                >
                  {THINK_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {THINK_LABELS[option]}
                    </option>
                  ))}
                </select>
                <ContextMeter used={historyTokens + draftTokens} total={contextWindow} lastUsage={lastUsage} />
              </>
            }
          />
        </div>
      </main>
    </div>
  )
}
