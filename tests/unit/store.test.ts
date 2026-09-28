import { existsSync } from 'node:fs'
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ConversationConflictError,
  ConversationStore,
  getStore,
  isValidConversationId,
  newConversationId,
  normalizeConversation,
  summarize,
} from '@/lib/store'
import { makeTempDataDir } from '../helpers/temp-data'

let dir: string
let cleanup: () => Promise<void>
let store: ConversationStore

beforeEach(async () => {
  ;({ dir, cleanup } = await makeTempDataDir())
  store = new ConversationStore(dir)
})

afterEach(() => cleanup())

async function writeRaw(relative: string, value: unknown) {
  const file = path.join(dir, 'conversations', relative)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value))
  return file
}

describe('ids', () => {
  it('generates 32-character hex ids like existing files', () => {
    const id = newConversationId()
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(isValidConversationId(id)).toBe(true)
  })

  it('rejects path traversal and odd ids', () => {
    for (const bad of ['../etc/passwd', 'a/b', '', 'x'.repeat(200), 'a.json', null, 42]) {
      expect(isValidConversationId(bad)).toBe(false)
    }
    expect(() => store.fileFor('../x', false)).toThrow()
  })
})

describe('save / get', () => {
  it('round-trips a conversation to <dataDir>/conversations/<id>.json', async () => {
    const conversation = store.create({ model: 'm', title: 'Hello' })
    conversation.messages.push({ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hey', thinking: 'hmm' })
    await store.save(conversation)

    const file = path.join(dir, 'conversations', `${conversation.id}.json`)
    const onDisk = JSON.parse(await readFile(file, 'utf8'))
    expect(onDisk).not.toHaveProperty('archived')
    expect(onDisk.messages).toHaveLength(2)

    expect(await store.get(conversation.id)).toEqual(conversation)
  })

  it('returns null for unknown or invalid ids', async () => {
    expect(await store.get('0'.repeat(32))).toBeNull()
    expect(await store.get('../../secrets')).toBeNull()
  })

  it('preserves unknown fields from older files when re-saving', async () => {
    await writeRaw('legacy1.json', {
      id: 'legacy1',
      title: 'Old',
      created_at: '2026-01-01T00:00:00Z',
      custom_setting: { temperature: 0.2 },
      messages: [{ role: 'user', content: 'hi', attachments: ['a.png'] }],
    })
    const conversation = (await store.get('legacy1'))!
    conversation.messages.push({ role: 'assistant', content: 'hello' })
    await store.save(conversation)
    const onDisk = JSON.parse(await readFile(path.join(dir, 'conversations', 'legacy1.json'), 'utf8'))
    expect(onDisk.custom_setting).toEqual({ temperature: 0.2 })
    expect(onDisk.messages[0].attachments).toEqual(['a.png'])
    expect(onDisk.messages).toHaveLength(2)
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

describe('list', () => {
  it('returns [] when the folder does not exist', async () => {
    expect(await store.list()).toEqual([])
    expect(await store.list(true)).toEqual([])
  })

  it('lists summaries newest first and skips unreadable or foreign files', async () => {
    await writeRaw('old.json', { title: 'Old', updated_at: '2026-01-01T00:00:00Z', messages: [{ role: 'user', content: 'x' }] })
    await writeRaw('new.json', {
      title: 'New',
      updated_at: '2026-03-01T00:00:00Z',
      messages: [
        { role: 'user', content: 'x' },
        { role: 'assistant', content: 'y' },
        { role: 'tool', content: 'z' },
      ],
    })
    await writeRaw('broken.json', '{not json')
    await writeRaw('notes.txt', 'ignore me')
    await writeRaw('archived/arch.json', { title: 'Archived one', messages: [] })

    const list = await store.list()
    expect(list.map((c) => c.title)).toEqual(['New', 'Old'])
    expect(list[0]).toMatchObject({ id: 'new', archived: false, message_count: 2 })

    const archived = await store.list(true)
    expect(archived.map((c) => c.id)).toEqual(['arch'])
    expect(archived[0].archived).toBe(true)
  })

  it('reuses cached summaries until a file changes', async () => {
    const file = await writeRaw('c1.json', { title: 'First', messages: [] })
    expect((await store.list())[0].title).toBe('First')
    await writeFile(file, JSON.stringify({ title: 'Second title', messages: [] }))
    const later = new Date(Date.now() + 5000)
    await utimes(file, later, later)
    expect((await store.list())[0].title).toBe('Second title')
  })
})

describe('archiving', () => {
  it('moves the file into conversations/archived and back', async () => {
    const conversation = store.create()
    conversation.messages.push({ role: 'user', content: 'keep me' })
    await store.save(conversation)
    const active = path.join(dir, 'conversations', `${conversation.id}.json`)
    const archivedFile = path.join(dir, 'conversations', 'archived', `${conversation.id}.json`)

    const summary = await store.setArchived(conversation.id, true)
    expect(summary).toMatchObject({ id: conversation.id, archived: true })
    expect(existsSync(active)).toBe(false)
    expect(existsSync(archivedFile)).toBe(true)
    expect(await store.list()).toEqual([])
    expect((await store.list(true)).map((c) => c.id)).toEqual([conversation.id])
    expect((await store.get(conversation.id))?.archived).toBe(true)

    // Idempotent.
    expect(await store.setArchived(conversation.id, true)).toMatchObject({ archived: true })

    const restored = await store.setArchived(conversation.id, false)
    expect(restored).toMatchObject({ archived: false })
    expect(existsSync(active)).toBe(true)
    expect(existsSync(archivedFile)).toBe(false)
    expect((await store.get(conversation.id))?.messages).toEqual([{ role: 'user', content: 'keep me' }])
  })

  it('returns null for missing conversations', async () => {
    expect(await store.setArchived('missing', true)).toBeNull()
    expect(await store.setArchived('../bad', true)).toBeNull()
  })

  it('refuses to overwrite when a conversation exists in both folders', async () => {
    await writeRaw('dup.json', { messages: [] })
    await writeRaw('archived/dup.json', { messages: [] })
    await expect(store.setArchived('dup', true)).rejects.toBeInstanceOf(ConversationConflictError)
  })

  it('saves into the archive if the conversation was archived while a reply streamed', async () => {
    const conversation = store.create()
    await store.save(conversation)
    await store.setArchived(conversation.id, true)
    conversation.messages.push({ role: 'assistant', content: 'late reply' })
    await store.save(conversation)
    expect(existsSync(path.join(dir, 'conversations', `${conversation.id}.json`))).toBe(false)
    const saved = await store.get(conversation.id)
    expect(saved).toMatchObject({ archived: true, messages: [{ role: 'assistant', content: 'late reply' }] })
  })
})

describe('summarize / getStore', () => {
  it('counts user and assistant messages only', () => {
    const conversation = store.create()
    conversation.messages.push({ role: 'user', content: 'a' }, { role: 'tool', content: 'b' }, { role: 'assistant', content: 'c' })
    expect(summarize(conversation)).toMatchObject({ message_count: 2 })
    expect(summarize(conversation)).not.toHaveProperty('messages')
  })

  it('returns one store per data directory', () => {
    expect(getStore(dir)).toBe(getStore(dir))
    expect(getStore(dir)).not.toBe(getStore(path.join(dir, 'other')))
  })
})
