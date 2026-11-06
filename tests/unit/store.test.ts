import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ConversationStore,
  DATABASE_URL_MISSING,
  getStore,
  isValidConversationId,
  missingDatabaseResponse,
  newConversationId,
  normalizeConversation,
  summarize,
  type Queryable,
} from '@/lib/store'
import type { Conversation } from '@/lib/types'

// A PGlite of this file's own, used directly, so tests can look at the table.
let db: PGlite
let store: ConversationStore

beforeAll(async () => {
  db = new PGlite()
  await db.waitReady
})

afterAll(() => db.close())

beforeEach(async () => {
  await db.exec('DROP TABLE IF EXISTS conversations')
  store = new ConversationStore(db)
})

async function seed(title: string, updated_at: string, init: Partial<Conversation> = {}): Promise<Conversation> {
  const conversation = { ...store.create({ title, model: 'm' }), updated_at, ...init }
  conversation.messages.push({ role: 'user', content: title }, { role: 'assistant', content: `Re: ${title}` })
  await store.save(conversation)
  return conversation
}

describe('ids', () => {
  it('generates 32-character hex ids', () => {
    const id = newConversationId()
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(isValidConversationId(id)).toBe(true)
  })

  it('rejects odd ids', () => {
    for (const bad of ['../etc/passwd', 'a/b', '', 'x'.repeat(200), 'a.json', null, 42]) {
      expect(isValidConversationId(bad)).toBe(false)
    }
  })
})

describe('ConversationStore', () => {
  it('creates its table on first use and round-trips a conversation', async () => {
    const conversation = store.create({ model: 'kimi-k2.6', title: 'Hello' })
    conversation.messages.push(
      { role: 'user', content: 'Hi', created_at: '2026-11-01T10:00:00.000Z' },
      {
        role: 'assistant',
        content: '',
        thinking: 'hmm',
        tool_calls: [{ function: { name: 'calculate', arguments: { expression: '2+2' } } }],
        attachments: ['kept.png'],
      },
      { role: 'tool', content: '4', tool_name: 'calculate' },
      { role: 'assistant', content: 'Four.' },
    )
    await store.save(conversation)

    expect(await store.get(conversation.id)).toEqual(conversation)
    const [row] = (await db.query<{ message_count: number }>('SELECT message_count FROM conversations')).rows
    expect(row.message_count).toBe(3)
  })

  it('returns null for unknown or invalid ids', async () => {
    expect(await store.get('0'.repeat(32))).toBeNull()
    expect(await store.get("x' OR '1'='1")).toBeNull()
    await expect(store.save({ ...store.create(), id: '../bad' })).rejects.toThrow('Invalid conversation id')
  })

  it('lists summaries newest first, split by archived', async () => {
    await seed('Older', '2026-09-01T00:00:00.000Z')
    await seed('Newer', '2026-09-20T00:00:00.000Z')
    const archived = await seed('Shelved', '2026-10-01T00:00:00.000Z')
    await store.setArchived(archived.id, true)

    const list = await store.list()
    expect(list.map((c) => c.title)).toEqual(['Newer', 'Older'])
    expect(list[0]).toEqual({
      id: expect.any(String),
      title: 'Newer',
      created_at: expect.any(String),
      updated_at: '2026-09-20T00:00:00.000Z',
      model: 'm',
      archived: false,
      message_count: 2,
    })
    expect((await store.list(true)).map((c) => c.id)).toEqual([archived.id])
  })

  it('replaces the messages, title and model on save but keeps created_at', async () => {
    const conversation = await seed('First', '2026-09-01T00:00:00.000Z')
    const created = conversation.created_at
    conversation.messages = [{ role: 'user', content: 'Edited' }]
    conversation.title = 'Renamed'
    conversation.model = undefined
    conversation.updated_at = '2026-09-02T00:00:00.000Z'
    await store.save({ ...conversation, created_at: '2000-01-01T00:00:00.000Z' })

    expect(await store.get(conversation.id)).toEqual({ ...conversation, created_at: created })
    expect((await store.list())[0]).toMatchObject({ title: 'Renamed', message_count: 1 })
  })

  it('archives and restores, idempotently', async () => {
    const conversation = await seed('Keep me', '2026-09-01T00:00:00.000Z')
    expect(await store.setArchived(conversation.id, true)).toMatchObject({ id: conversation.id, archived: true })
    expect(await store.setArchived(conversation.id, true)).toMatchObject({ archived: true })
    expect(await store.list()).toEqual([])
    expect(await store.get(conversation.id)).toMatchObject({ archived: true, messages: conversation.messages })

    expect(await store.setArchived(conversation.id, false)).toMatchObject({ archived: false, message_count: 2 })
    expect((await store.list()).map((c) => c.id)).toEqual([conversation.id])
    expect(await store.setArchived('missing', true)).toBeNull()
    expect(await store.setArchived('../bad', true)).toBeNull()
  })

  it('keeps a conversation archived if a reply is saved after it was archived', async () => {
    const conversation = await seed('Streaming', '2026-09-01T00:00:00.000Z')
    await store.setArchived(conversation.id, true)
    conversation.messages.push({ role: 'assistant', content: 'late reply' })
    await store.save(conversation)

    expect(conversation.archived).toBe(true)
    expect(await store.list()).toEqual([])
    expect((await store.get(conversation.id))?.messages.at(-1)?.content).toBe('late reply')
  })

  it('strips characters Postgres cannot store', async () => {
    const conversation = store.create({ title: 'Nul\0 title' })
    conversation.messages.push({ role: 'tool', content: 'binary\0page \ud83d end' })
    await store.save(conversation)
    const saved = await store.get(conversation.id)
    expect(saved?.title).toBe('Nul title')
    expect(saved?.messages[0].content).toBe('binarypage � end')
  })

  it('imports a conversation once and never overwrites one already stored', async () => {
    const conversation = { ...store.create({ title: 'From disk' }), archived: true }
    conversation.messages.push({ role: 'user', content: 'old' })
    expect(await store.importConversation(conversation)).toBe(true)
    expect(await store.importConversation({ ...conversation, title: 'Changed', messages: [] })).toBe(false)
    expect(await store.get(conversation.id)).toEqual(conversation)
  })

  it('retries setting up the table after a failure', async () => {
    let fail = true
    const flaky: Queryable = {
      query: (text, params) => {
        if (fail) {
          fail = false
          return Promise.reject(new Error('connection refused'))
        }
        return db.query(text, params)
      },
    }
    const retrying = new ConversationStore(flaky)
    await expect(retrying.list()).rejects.toThrow('connection refused')
    expect(await retrying.list()).toEqual([])
  })
})

describe('normalizeConversation', () => {
  const fallback = '2026-02-02T00:00:00.000Z'

  it('accepts camelCase and Unix timestamps', () => {
    const c = normalizeConversation(
      { title: ' T ', createdAt: 1_700_000_000, updatedAt: 1_700_000_500_000, messages: [] },
      'id1',
      false,
      fallback,
    )
    expect(c.title).toBe('T')
    expect(c.created_at).toBe(new Date(1_700_000_000_000).toISOString())
    expect(c.updated_at).toBe(new Date(1_700_000_500_000).toISOString())
  })

  it('accepts a bare message array and derives the title from the first user message', () => {
    const c = normalizeConversation(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: '# What is **GFM**?' },
      ],
      'id2',
      true,
      fallback,
    )
    expect(c.title).toBe('What is GFM?')
    expect(c.archived).toBe(true)
    expect(c.created_at).toBe(fallback)
    expect(c.updated_at).toBe(fallback)
  })

  it('flattens content parts and drops junk entries', () => {
    const c = normalizeConversation(
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }, 'b'] }, null, 'x', { content: 5 }] },
      'id3',
      false,
      fallback,
    )
    expect(c.messages).toEqual([
      { role: 'user', content: 'ab' },
      { role: 'user', content: '5' },
    ])
    expect(c.title).toBe('ab')
  })

  it('falls back to "Untitled"', () => {
    expect(normalizeConversation({}, 'id4', false, fallback).title).toBe('Untitled')
  })
})

describe('summarize', () => {
  it('counts user and assistant messages only', () => {
    const conversation = store.create()
    conversation.messages.push({ role: 'user', content: 'a' }, { role: 'tool', content: 'b' }, { role: 'assistant', content: 'c' })
    expect(summarize(conversation)).toMatchObject({ message_count: 2 })
    expect(summarize(conversation)).not.toHaveProperty('messages')
  })
})

describe('getStore', () => {
  it('uses DATABASE_URL, one store per connection string', () => {
    const first = getStore()
    expect(first).toBeInstanceOf(ConversationStore)
    expect(getStore()).toBe(first)
    vi.stubEnv('DATABASE_URL', 'postgres://user:pass@127.0.0.1:1/other')
    expect(getStore()).not.toBe(first)
  })

  it('explains a missing DATABASE_URL', async () => {
    expect(missingDatabaseResponse()).toBeNull()
    vi.stubEnv('DATABASE_URL', '')
    expect(() => getStore()).toThrow(DATABASE_URL_MISSING)
    const response = missingDatabaseResponse()!
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: DATABASE_URL_MISSING })
  })
})
