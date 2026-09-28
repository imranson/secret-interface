import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getConfig } from './config'
import { deriveTitle } from './title'
import type { ChatMessage, Conversation, ConversationSummary, Role } from './types'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const ROLES: ReadonlySet<string> = new Set<Role>(['system', 'user', 'assistant', 'tool'])
const KNOWN_KEYS = new Set(['id', 'title', 'created_at', 'updated_at', 'model', 'archived', 'messages'])

export const ARCHIVE_DIR_NAME = 'archived'

export class ConversationConflictError extends Error {}

export function isValidConversationId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id)
}

export function newConversationId(): string {
  return randomUUID().replace(/-/g, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toIso(value: unknown, fallback: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Accept both Unix seconds and milliseconds.
    return new Date(value < 1e12 ? value * 1000 : value).toISOString()
  }
  if (typeof value === 'string' && value) {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return fallback
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (content == null) return ''
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('')
  }
  return JSON.stringify(content)
}

function normalizeMessage(raw: unknown): ChatMessage | null {
  if (!isRecord(raw)) return null
  // Unknown fields are kept so re-saving an older file does not lose data.
  const message: ChatMessage = { ...raw, role: String(raw.role ?? 'user') as Role, content: textOf(raw.content) }
  if (typeof raw.thinking !== 'string' || !raw.thinking) delete message.thinking
  if (!Array.isArray(raw.tool_calls) || raw.tool_calls.length === 0) delete message.tool_calls
  return message
}

/**
 * Normalises a conversation file into the app's shape. Tolerates older/foreign layouts (camelCase or
 * Unix timestamps, a bare message array, content given as parts) so existing history keeps loading.
 */
export function normalizeConversation(
  raw: unknown,
  id: string,
  archived: boolean,
  fallbackTime: string,
): Conversation {
  const obj = isRecord(raw) ? raw : {}
  const rawMessages = Array.isArray(raw) ? raw : Array.isArray(obj.messages) ? obj.messages : []
  const messages = rawMessages.map(normalizeMessage).filter((m): m is ChatMessage => m !== null)
  const created = toIso(obj.created_at ?? obj.createdAt ?? obj.created, fallbackTime)
  const firstUser = messages.find((m) => m.role === 'user')
  return {
    id,
    title:
      typeof obj.title === 'string' && obj.title.trim()
        ? obj.title.trim()
        : firstUser
          ? deriveTitle(firstUser.content)
          : 'Untitled',
    created_at: created,
    updated_at: toIso(obj.updated_at ?? obj.updatedAt ?? obj.updated, created),
    model: typeof obj.model === 'string' ? obj.model : undefined,
    archived,
    messages,
  }
}

export function summarize(conversation: Conversation): ConversationSummary {
  const { messages, ...rest } = conversation
  return { ...rest, message_count: messages.filter((m) => m.role === 'user' || m.role === 'assistant').length }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * File-based conversation store:
 *   <dataDir>/conversations/<id>.json           active conversations
 *   <dataDir>/conversations/archived/<id>.json  archived conversations
 */
export class ConversationStore {
  readonly activeDir: string
  readonly archiveDir: string
  private readonly summaries = new Map<string, { mtimeMs: number; size: number; summary: ConversationSummary }>()

  constructor(readonly dataDir: string) {
    this.activeDir = path.join(dataDir, 'conversations')
    this.archiveDir = path.join(this.activeDir, ARCHIVE_DIR_NAME)
  }

  fileFor(id: string, archived: boolean): string {
    if (!isValidConversationId(id)) throw new Error(`Invalid conversation id: ${id}`)
    return path.join(archived ? this.archiveDir : this.activeDir, `${id}.json`)
  }

  create(init: { model?: string; title?: string } = {}): Conversation {
    const now = new Date().toISOString()
    return {
      id: newConversationId(),
      title: init.title ?? 'New conversation',
      created_at: now,
      updated_at: now,
      model: init.model,
      archived: false,
      messages: [],
    }
  }

  async list(archived = false): Promise<ConversationSummary[]> {
    const dir = archived ? this.archiveDir : this.activeDir
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const ids = entries
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => e.name.slice(0, -'.json'.length))
      .filter(isValidConversationId)

    const summaries = await mapLimit(ids, 16, async (id) => {
      const file = this.fileFor(id, archived)
      try {
        const stat = await fs.stat(file)
        const cached = this.summaries.get(file)
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.summary
        const conversation = normalizeConversation(
          JSON.parse(await fs.readFile(file, 'utf8')),
          id,
          archived,
          stat.mtime.toISOString(),
        )
        const summary = summarize(conversation)
        this.summaries.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, summary })
        return summary
      } catch (error) {
        console.warn(`Skipping unreadable conversation ${file}:`, (error as Error).message)
        return null
      }
    })
    return summaries
      .filter((s): s is ConversationSummary => s !== null)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }

  /** Loads a conversation from the active folder, falling back to the archive. */
  async get(id: string): Promise<Conversation | null> {
    if (!isValidConversationId(id)) return null
    for (const archived of [false, true]) {
      const file = this.fileFor(id, archived)
      let text: string
      try {
        text = await fs.readFile(file, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      const stat = await fs.stat(file)
      return normalizeConversation(JSON.parse(text), id, archived, stat.mtime.toISOString())
    }
    return null
  }

  async save(conversation: Conversation): Promise<void> {
    // If the conversation was archived while a reply was streaming, write the reply into the archive
    // rather than resurrecting a second copy in the active folder.
    if (
      !conversation.archived &&
      !(await exists(this.fileFor(conversation.id, false))) &&
      (await exists(this.fileFor(conversation.id, true)))
    ) {
      conversation.archived = true
    }
    const file = this.fileFor(conversation.id, conversation.archived)
    // Preserve top-level fields this app does not know about (e.g. from older versions).
    let extra: Record<string, unknown> = {}
    try {
      const existing: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
      if (isRecord(existing)) {
        extra = Object.fromEntries(Object.entries(existing).filter(([key]) => !KNOWN_KEYS.has(key)))
      }
    } catch {
      // New file, or unreadable: nothing to preserve.
    }
    const { archived: _archived, ...rest } = conversation
    const payload = { ...extra, ...rest }
    await fs.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
    await fs.rename(tmp, file)
    this.summaries.delete(file)
  }

  /** Moves a conversation file between the active and archive folders. */
  async setArchived(id: string, archived: boolean): Promise<ConversationSummary | null> {
    if (!isValidConversationId(id)) return null
    const from = this.fileFor(id, !archived)
    const to = this.fileFor(id, archived)
    const [fromExists, toExists] = await Promise.all([exists(from), exists(to)])
    if (fromExists && toExists) {
      throw new ConversationConflictError(`Conversation ${id} exists in both the active and archive folders`)
    }
    if (fromExists) {
      await fs.mkdir(path.dirname(to), { recursive: true })
      await fs.rename(from, to)
      this.summaries.delete(from)
    } else if (!toExists) {
      return null
    }
    const conversation = await this.get(id)
    return conversation ? summarize(conversation) : null
  }
}

const stores = new Map<string, ConversationStore>()

/** Returns a store for the configured DATA_DIR (one instance per directory, so caches persist). */
export function getStore(dataDir: string = getConfig().dataDir): ConversationStore {
  let store = stores.get(dataDir)
  if (!store) {
    store = new ConversationStore(dataDir)
    stores.set(dataDir, store)
  }
  return store
}
