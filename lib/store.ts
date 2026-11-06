import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { getConfig } from './config'
import { deriveTitle } from './title'
import type { ChatMessage, Conversation, ConversationSummary, Role } from './types'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export const DATABASE_URL_MISSING =
  'DATABASE_URL is not set. Point it at a PostgreSQL database (in .env.local, or your host’s environment settings) and restart the server.'

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
  // Unknown fields are kept so re-saving older data does not lose them.
  const message: ChatMessage = { ...raw, role: String(raw.role ?? 'user') as Role, content: textOf(raw.content) }
  if (typeof raw.thinking !== 'string' || !raw.thinking) delete message.thinking
  if (!Array.isArray(raw.tool_calls) || raw.tool_calls.length === 0) delete message.tool_calls
  return message
}

/**
 * Normalises stored conversation data into the app's shape. Tolerates older/foreign layouts (camelCase or Unix
 * timestamps, a bare message array, content given as parts), as found in the JSON files older versions wrote.
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

/** What the store needs from a database client: pg's Pool in the app, PGlite in tests. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>
}

// Messages are always read and written as a whole (edits and scheduled reports replace them), so they live in one
// jsonb column. message_count is kept beside them so listing never has to read the messages.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS conversations (
    id            text PRIMARY KEY,
    title         text NOT NULL,
    model         text,
    archived      boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL,
    updated_at    timestamptz NOT NULL,
    message_count integer NOT NULL DEFAULT 0,
    messages      jsonb NOT NULL DEFAULT '[]'::jsonb
  )`,
  'CREATE INDEX IF NOT EXISTS conversations_list_idx ON conversations (archived, updated_at DESC)',
]

const SUMMARY_COLUMNS = 'id, title, model, archived, created_at, updated_at, message_count'
const INSERT = `INSERT INTO conversations (id, title, model, archived, created_at, updated_at, message_count, messages)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`

interface SummaryRow {
  id: string
  title: string
  model: string | null
  archived: boolean
  created_at: Date | string
  updated_at: Date | string
  message_count: number
}

interface ConversationRow extends Omit<SummaryRow, 'message_count'> {
  messages: unknown
}

const iso = (value: Date | string) => new Date(value).toISOString()

function toSummary(row: SummaryRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    model: row.model ?? undefined,
    archived: row.archived,
    message_count: row.message_count,
  }
}

/** Postgres rejects NUL characters in text and lone surrogates in jsonb; either can turn up in a fetched page. */
const clean = (text: string) => text.toWellFormed().replaceAll('\0', '')

function insertParams(conversation: Conversation): unknown[] {
  if (!isValidConversationId(conversation.id)) throw new Error(`Invalid conversation id: ${conversation.id}`)
  return [
    conversation.id,
    clean(conversation.title),
    conversation.model ? clean(conversation.model) : null,
    conversation.archived,
    conversation.created_at,
    conversation.updated_at,
    summarize(conversation).message_count,
    JSON.stringify(conversation.messages, (_key, value) => (typeof value === 'string' ? clean(value) : value)),
  ]
}

/** Conversation store backed by a PostgreSQL `conversations` table, which it creates on first use. */
export class ConversationStore {
  private ready: Promise<void> | null = null

  constructor(private readonly db: Queryable) {}

  private async query<R>(text: string, params?: unknown[]): Promise<R[]> {
    // A failed setup is retried on the next query rather than remembered.
    this.ready ??= this.migrate().catch((error) => {
      this.ready = null
      throw error
    })
    await this.ready
    return (await this.db.query(text, params)).rows as R[]
  }

  private async migrate(): Promise<void> {
    for (const statement of SCHEMA) await this.db.query(statement)
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
    const rows = await this.query<SummaryRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM conversations WHERE archived = $1 ORDER BY updated_at DESC`,
      [archived],
    )
    return rows.map(toSummary)
  }

  /** Finds a conversation whether or not it is archived. */
  async get(id: string): Promise<Conversation | null> {
    if (!isValidConversationId(id)) return null
    const [row] = await this.query<ConversationRow>(
      'SELECT id, title, model, archived, created_at, updated_at, messages FROM conversations WHERE id = $1',
      [id],
    )
    if (!row) return null
    const created = iso(row.created_at)
    return normalizeConversation(
      { title: row.title, model: row.model, created_at: created, updated_at: iso(row.updated_at), messages: row.messages },
      row.id,
      row.archived,
      created,
    )
  }

  /**
   * Inserts or replaces the conversation. Only setArchived changes `archived`, so a reply that finishes after its
   * conversation was archived lands in the archived conversation instead of restoring it; `conversation.archived` is
   * updated to match.
   */
  async save(conversation: Conversation): Promise<void> {
    const [row] = await this.query<{ archived: boolean }>(
      `${INSERT}
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        model = EXCLUDED.model,
        updated_at = EXCLUDED.updated_at,
        message_count = EXCLUDED.message_count,
        messages = EXCLUDED.messages
      RETURNING archived`,
      insertParams(conversation),
    )
    conversation.archived = row.archived
  }

  async setArchived(id: string, archived: boolean): Promise<ConversationSummary | null> {
    if (!isValidConversationId(id)) return null
    const [row] = await this.query<SummaryRow>(
      `UPDATE conversations SET archived = $2 WHERE id = $1 RETURNING ${SUMMARY_COLUMNS}`,
      [id, archived],
    )
    return row ? toSummary(row) : null
  }

  /** Adds a conversation unless one with its id is already stored, which is left untouched. True if it was added. */
  async importConversation(conversation: Conversation): Promise<boolean> {
    const rows = await this.query(`${INSERT} ON CONFLICT (id) DO NOTHING RETURNING id`, insertParams(conversation))
    return rows.length > 0
  }
}

const STORES = Symbol.for('secret-interface.conversation-stores')

/**
 * The store for DATABASE_URL, with one pool per connection string for the whole process. Route handlers and the
 * scheduler are bundled separately and each get their own copy of this module, so the cache lives on globalThis.
 */
export function getStore(): ConversationStore {
  const url = getConfig().databaseUrl
  if (!url) throw new Error(DATABASE_URL_MISSING)
  const shared = globalThis as { [STORES]?: Map<string, ConversationStore> }
  const stores = (shared[STORES] ??= new Map())
  let store = stores.get(url)
  if (!store) {
    const pool = new Pool({ connectionString: url })
    // An idle connection dropping (e.g. the database restarting) must not crash the server.
    pool.on('error', (error) => console.error('Postgres pool error:', error.message))
    store = new ConversationStore(pool)
    stores.set(url, store)
  }
  return store
}

/** A JSON error for route handlers to return when DATABASE_URL is missing; null when it is set. */
export function missingDatabaseResponse(): Response | null {
  return getConfig().databaseUrl ? null : Response.json({ error: DATABASE_URL_MISSING }, { status: 500 })
}
