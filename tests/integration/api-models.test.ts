import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearModelCaches } from '@/lib/models'
import { createFakeOllama, type FakeOllama } from '../helpers/fake-ollama'

const holder = vi.hoisted(() => ({ fake: undefined as FakeOllama | undefined }))
vi.mock('@/lib/ollama', () => ({ getOllamaClient: () => holder.fake!.client }))

const { GET: models } = await import('@/app/api/models/route')
const { GET: modelInfo } = await import('@/app/api/model-info/route')

beforeEach(() => {
  holder.fake = createFakeOllama()
  clearModelCaches()
  vi.stubEnv('OLLAMA_HOST', '')
  vi.stubEnv('OLLAMA_MODEL', 'gpt-oss:120b')
  vi.stubEnv('OLLAMA_CONTEXT_WINDOW', '32000')
})

describe('GET /api/models', () => {
  it('returns the models available to the API key', async () => {
    const body = await (await models()).json()
    expect(body).toEqual({ defaultModel: 'gpt-oss:120b', models: ['gpt-oss:120b', 'kimi-k2.6'] })
  })
})

describe('GET /api/model-info', () => {
  it("reports the model's context window", async () => {
    const response = await modelInfo(new Request('http://localhost/api/model-info?model=gpt-oss%3A120b'))
    expect(await response.json()).toEqual({ model: 'gpt-oss:120b', contextLength: 131072, source: 'model' })
  })

  it('falls back to the configured window', async () => {
    holder.fake!.client.show.mockResolvedValueOnce({ model_info: {} })
    const response = await modelInfo(new Request('http://localhost/api/model-info'))
    expect(await response.json()).toEqual({ model: 'gpt-oss:120b', contextLength: 32000, source: 'config' })
  })
})
