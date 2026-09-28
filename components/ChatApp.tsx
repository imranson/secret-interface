'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
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
import { sidebarCookie } from '@/lib/sidebar'
import { estimateContextTokens, estimateTokens, MESSAGE_OVERHEAD_TOKENS } from '@/lib/tokens'
import { TOOL_DEFINITIONS } from '@/lib/tool-definitions'
import { THINK_OPTIONS, type ChatMessage, type ConversationSummary, type ThinkOption } from '@/lib/types'
import { Composer } from './Composer'
import { ContextMeter } from './ContextMeter'
import { ArchiveIcon, RestoreIcon, SidebarIcon } from './Icons'
import { MessageList } from './MessageList'
import { Sidebar, type SidebarView } from './Sidebar'

const THINK_LABELS: Record<ThinkOption, string> = {
  auto: 'Thinking: auto',
  off: 'Thinking: off',
  on: 'Thinking: on',
  low: 'Thinking: low',
  medium: 'Thinking: medium',
  high: 'Thinking: high',
}

const PREF_THINK = 'secret-interface.think'
const PREF_MODEL = 'secret-interface.model'

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
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [archivedList, setArchivedList] = useState<ConversationSummary[] | null>(null)
  const [view, setView] = useState<SidebarView>('recent')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initiallyCollapsed)
  const narrow = useSyncExternalStore(subscribeToScreenSize, isNarrowScreen, isNarrowScreenOnServer)
  const [current, setCurrent] = useState<CurrentConversation>(NEW_CONVERSATION)
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [models, setModels] = useState<string[]>([defaultModel])
  const [model, setModel] = useState(defaultModel)
  const [think, setThink] = useState<ThinkOption>('auto')
  const [contextWindow, setContextWindow] = useState(defaultContextWindow)
  const [lastUsage, setLastUsage] = useState<{ prompt_tokens: number; completion_tokens: number } | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  // Bumped whenever the view changes conversation, so late events from an old stream are ignored.
  const runRef = useRef(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    listConversations()
      .then(setConversations)
      .catch((e) => setError(`Could not load conversations: ${messageOf(e)}`))
    listModels()
      .then(({ defaultModel: serverDefault, models: available }) => {
        setModels(available)
        const saved = readPref(PREF_MODEL)
        setModel(saved && available.includes(saved) ? saved : serverDefault)
      })
      .catch(() => {
        // Keep the server-rendered default model.
      })
    const savedThink = readPref(PREF_THINK)
    if (savedThink && (THINK_OPTIONS as readonly string[]).includes(savedThink)) setThink(savedThink as ThinkOption)
  }, [])

  useEffect(() => {
    let cancelled = false
    getModelInfo(model)
      .then((info) => {
        if (!cancelled) setContextWindow(info.contextLength)
      })
      .catch(() => {
        if (!cancelled) setContextWindow(defaultContextWindow)
      })
    return () => {
      cancelled = true
    }
  }, [model, defaultContextWindow])

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
    setLoading(false)
    setCurrent(NEW_CONVERSATION)
    inputRef.current?.focus()
  }, [resetView])

  const openConversation = async (id: string) => {
    if (id === current.id) {
      setSidebarOpen(false)
      return
    }
    resetView()
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
      if (run === runRef.current) setError(`Could not open conversation: ${messageOf(e)}`)
    } finally {
      if (run === runRef.current) setLoading(false)
    }
  }

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
      if (current.id === id) newConversation()
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

  const send = async () => {
    const text = draft.trim()
    if (!text || streaming || current.archived || loading) return

    const run = ++runRef.current
    const controller = new AbortController()
    abortRef.current = controller
    const userMessage: ChatMessage = { role: 'user', content: text, created_at: new Date().toISOString() }
    setCurrent((c) => ({ ...c, messages: [...c.messages, userMessage] }))
    setDraft('')
    setError(null)
    setNotice(null)
    setStreaming(true)

    let started = false
    try {
      const events = streamChat(
        { conversationId: current.id, message: text, think, model, timezone: browserTimeZone() },
        controller.signal,
      )
      for await (const event of events) {
        if (run !== runRef.current) break
        switch (event.type) {
          case 'start':
            started = true
            setCurrent((c) => ({ ...c, id: event.conversation.id, title: event.conversation.title }))
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
        // Rejected before anything was saved: undo the optimistic message and give the text back.
        setCurrent((c) => ({ ...c, messages: c.messages.filter((m) => m !== userMessage) }))
        setDraft((d) => d || text)
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

  const empty = (
    <div className="empty">
      <h1 className="empty-title">What shall we look into?</h1>
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
        currentId={current.id}
        busyId={streaming ? current.id : null}
        open={sidebarOpen}
        collapsed={!narrow && sidebarCollapsed}
        onSelect={openConversation}
        onNew={newConversation}
        onArchive={archive}
        onRestore={restore}
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
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            onStop={stopStreaming}
            streaming={streaming}
            disabled={current.archived || loading}
            inputRef={inputRef}
            placeholder={current.messages.length ? 'Reply…' : 'Ask anything…'}
            toolbar={
              <>
                <select
                  className="pill-select"
                  aria-label="Model"
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value)
                    writePref(PREF_MODEL, e.target.value)
                  }}
                >
                  {models.map((m) => (
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
