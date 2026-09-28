import { existsSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as getOne, PATCH } from '@/app/api/conversations/[id]/route'
import { GET as list } from '@/app/api/conversations/route'
import { getStore } from '@/lib/store'
import type { Conversation, ConversationSummary } from '@/lib/types'
import { makeTempDataDir } from '../helpers/temp-data'

let dataDir: string
let cleanup: () => Promise<void>

beforeEach(async () => {
  ;({ dir: dataDir, cleanup } = await makeTempDataDir())
  vi.stubEnv('DATA_DIR', dataDir)
})

afterEach(() => cleanup())

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function seed(title: string, updated_at: string): Promise<Conversation> {
  const store = getStore(dataDir)
  const conversation = { ...store.create({ title }), updated_at }
  conversation.messages.push({ role: 'user', content: title }, { role: 'assistant', content: `Re: ${title}` })
  await store.save(conversation)
  return conversation
}

async function listJson(archived = false): Promise<ConversationSummary[]> {
  const response = await list(new Request(`http://localhost/api/conversations${archived ? '?archived=1' : ''}`))
  return (await response.json()).conversations
}

describe('conversation history API', () => {
  it('lists conversations newest first', async () => {
    await seed('Older', '2026-09-01T00:00:00.000Z')
    await seed('Newer', '2026-09-20T00:00:00.000Z')
    const conversations = await listJson()
    expect(conversations.map((c) => c.title)).toEqual(['Newer', 'Older'])
    expect(conversations[0]).toMatchObject({ archived: false, message_count: 2 })
    expect(conversations[0]).not.toHaveProperty('messages')
  })

  it('returns a full conversation', async () => {
    const conversation = await seed('Readable', '2026-09-01T00:00:00.000Z')
    const response = await getOne(new Request('http://localhost'), ctx(conversation.id))
    expect(response.status).toBe(200)
    expect((await response.json()).conversation).toEqual(conversation)
  })

  it('404s and 400s appropriately', async () => {
    expect((await getOne(new Request('http://localhost'), ctx('a'.repeat(32)))).status).toBe(404)
    expect((await getOne(new Request('http://localhost'), ctx('..%2F..'))).status).toBe(400)
  })
})

describe('archive API', () => {
  const patch = (id: string, body: unknown) =>
    PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) }), ctx(id))

  it('moves a conversation to the archive folder and back', async () => {
    const keep = await seed('Keep', '2026-09-02T00:00:00.000Z')
    const old = await seed('Archive me', '2026-09-01T00:00:00.000Z')

    const archived = await patch(old.id, { archived: true })
    expect(archived.status).toBe(200)
    expect((await archived.json()).conversation).toMatchObject({ id: old.id, archived: true })
    expect(existsSync(path.join(dataDir, 'conversations', 'archived', `${old.id}.json`))).toBe(true)
    expect(existsSync(path.join(dataDir, 'conversations', `${old.id}.json`))).toBe(false)

    expect((await listJson()).map((c) => c.id)).toEqual([keep.id])
    expect((await listJson(true)).map((c) => c.id)).toEqual([old.id])

    // Archived conversations can still be opened (read-only in the UI).
    const opened = await getOne(new Request('http://localhost'), ctx(old.id))
    expect((await opened.json()).conversation).toMatchObject({ archived: true, title: 'Archive me' })

    const restored = await patch(old.id, { archived: false })
    expect((await restored.json()).conversation).toMatchObject({ archived: false })
    expect((await listJson()).map((c) => c.id)).toEqual([keep.id, old.id])
    expect(await listJson(true)).toEqual([])
  })

  it('validates input', async () => {
    const conversation = await seed('X', '2026-09-01T00:00:00.000Z')
    expect((await patch(conversation.id, { archived: 'yes' })).status).toBe(400)
    expect((await patch('b'.repeat(32), { archived: true })).status).toBe(404)
    expect((await patch('bad/id', { archived: true })).status).toBe(400)
    const invalidJson = await PATCH(new Request('http://localhost', { method: 'PATCH', body: '{' }), ctx(conversation.id))
    expect(invalidJson.status).toBe(400)
  })
})
