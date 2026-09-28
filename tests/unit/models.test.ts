import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeOllama, type FakeOllama } from '../helpers/fake-ollama'

const holder = vi.hoisted(() => ({ fake: undefined as FakeOllama | undefined }))
vi.mock('@/lib/ollama', () => ({ getOllamaClient: () => holder.fake!.client }))

const { clearModelCaches, contextLengthFrom, getModelInfo, listModels } = await import('@/lib/models')

beforeEach(() => {
  holder.fake = createFakeOllama()
  clearModelCaches()
  vi.stubEnv('OLLAMA_MODEL', 'kimi-k2.6:cloud')
  vi.stubEnv('OLLAMA_CONTEXT_WINDOW', '64000')
  vi.stubEnv('OLLAMA_HOST', '')
})

describe('contextLengthFrom', () => {
  it('finds <arch>.context_length', () => {
    expect(contextLengthFrom({ 'general.architecture': 'llama', 'llama.context_length': 8192 })).toBe(8192)
    expect(contextLengthFrom({ 'llama.embedding_length': 4096 })).toBeUndefined()
    expect(contextLengthFrom(undefined)).toBeUndefined()
  })
})

describe('listModels', () => {
  it('lists cloud models sorted, with the normalised default', async () => {
    holder.fake!.client.list.mockResolvedValueOnce({
      models: [
        { name: 'qwen3-coder:480b-cloud', model: 'qwen3-coder:480b-cloud' },
        { name: 'deepseek-v3.1:671b', model: 'deepseek-v3.1:671b' },
      ],
    })
    expect(await listModels()).toEqual({
      defaultModel: 'kimi-k2.6',
      models: ['kimi-k2.6', 'deepseek-v3.1:671b', 'qwen3-coder:480b'],
    })
  })

  it('caches the list', async () => {
    await listModels()
    await listModels()
    expect(holder.fake!.client.list).toHaveBeenCalledTimes(1)
  })

  it('falls back to the default model and reports the error', async () => {
    holder.fake!.client.list.mockRejectedValueOnce(new Error('offline'))
    expect(await listModels()).toEqual({ defaultModel: 'kimi-k2.6', models: ['kimi-k2.6'], error: 'offline' })
  })
})

describe('getModelInfo', () => {
  it("reads the model's context length and caches it", async () => {
    expect(await getModelInfo('gpt-oss:120b-cloud')).toEqual({ model: 'gpt-oss:120b', contextLength: 131072, source: 'model' })
    await getModelInfo('gpt-oss:120b')
    expect(holder.fake!.client.show).toHaveBeenCalledTimes(1)
    expect(holder.fake!.client.show).toHaveBeenCalledWith({ model: 'gpt-oss:120b' })
  })

  it('falls back to OLLAMA_CONTEXT_WINDOW', async () => {
    holder.fake!.client.show.mockRejectedValueOnce(new Error('not found'))
    expect(await getModelInfo(null)).toEqual({ model: 'kimi-k2.6', contextLength: 64000, source: 'config' })
  })
})
