import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeOllama, type FakeOllama } from '../helpers/fake-ollama'

const holder = vi.hoisted(() => ({ fake: undefined as FakeOllama | undefined, backends: [] as string[] }))
vi.mock('@/lib/ollama', () => ({
  getOllamaClient: (backend = 'cloud') => {
    holder.backends.push(backend)
    return holder.fake!.client
  },
}))

const { clearModelCaches, contextLengthFrom, getModelInfo, listModels } = await import('@/lib/models')

beforeEach(() => {
  holder.fake = createFakeOllama()
  holder.backends = []
  clearModelCaches()
  vi.stubEnv('OLLAMA_MODEL', 'kimi-k2.6:cloud')
  vi.stubEnv('OLLAMA_CONTEXT_WINDOW', '64000')
  vi.stubEnv('OLLAMA_HOST', '')
  vi.stubEnv('OLLAMA_LOCAL_HOST', '')
  vi.stubEnv('OLLAMA_LOCAL_MODEL', '')
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
      backend: 'cloud',
      host: 'https://ollama.com',
      defaultModel: 'kimi-k2.6',
      models: ['kimi-k2.6', 'deepseek-v3.1:671b', 'qwen3-coder:480b'],
    })
    expect(holder.backends).toEqual(['cloud'])
  })

  it('caches the list', async () => {
    await listModels()
    await listModels()
    expect(holder.fake!.client.list).toHaveBeenCalledTimes(1)
  })

  it('falls back to the default model and reports the error', async () => {
    holder.fake!.client.list.mockRejectedValueOnce(new Error('offline'))
    expect(await listModels()).toEqual({
      backend: 'cloud',
      host: 'https://ollama.com',
      defaultModel: 'kimi-k2.6',
      models: ['kimi-k2.6'],
      error: 'offline',
    })
  })
})

describe('listModels on the local backend', () => {
  const localList = {
    models: [
      { name: 'qwen3:8b', model: 'qwen3:8b' },
      { name: 'gpt-oss:120b-cloud', model: 'gpt-oss:120b-cloud' },
    ],
  }

  it('asks the local server, keeps its names as they are and defaults to the newest', async () => {
    holder.fake!.client.list.mockResolvedValueOnce(localList)
    expect(await listModels('local')).toEqual({
      backend: 'local',
      host: 'http://127.0.0.1:11434',
      defaultModel: 'qwen3:8b',
      models: ['gpt-oss:120b-cloud', 'qwen3:8b'],
    })
    expect(holder.backends).toEqual(['local'])
  })

  it('uses OLLAMA_LOCAL_HOST and OLLAMA_LOCAL_MODEL', async () => {
    vi.stubEnv('OLLAMA_LOCAL_HOST', 'http://studio.lan:11434/')
    vi.stubEnv('OLLAMA_LOCAL_MODEL', 'llama3.2')
    holder.fake!.client.list.mockResolvedValueOnce(localList)
    expect(await listModels('local')).toMatchObject({
      host: 'http://studio.lan:11434',
      defaultModel: 'llama3.2',
      models: ['llama3.2', 'gpt-oss:120b-cloud', 'qwen3:8b'],
    })
  })

  it('has no default when the server is unreachable', async () => {
    holder.fake!.client.list.mockRejectedValueOnce(new Error('fetch failed'))
    expect(await listModels('local')).toMatchObject({ defaultModel: '', models: [], error: 'fetch failed' })
  })

  it('caches each backend separately', async () => {
    expect((await listModels('cloud')).models).toContain('kimi-k2.6')
    holder.fake!.client.list.mockResolvedValueOnce(localList)
    expect((await listModels('local')).models).toEqual(['gpt-oss:120b-cloud', 'qwen3:8b'])
    expect(await listModels('local')).toMatchObject({ defaultModel: 'qwen3:8b', models: ['gpt-oss:120b-cloud', 'qwen3:8b'] })
    expect(holder.fake!.client.list).toHaveBeenCalledTimes(2)
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

  it('asks the local server, without sharing the cloud cache', async () => {
    await getModelInfo('gpt-oss:120b')
    expect(await getModelInfo('gpt-oss:120b-cloud', 'local')).toEqual({
      model: 'gpt-oss:120b-cloud',
      contextLength: 131072,
      source: 'model',
    })
    expect(holder.backends).toEqual(['cloud', 'local'])
  })

  it('falls back to the configured window when the local backend has no model', async () => {
    expect(await getModelInfo(null, 'local')).toEqual({ model: '', contextLength: 64000, source: 'config' })
    expect(holder.fake!.client.show).not.toHaveBeenCalled()
  })
})
