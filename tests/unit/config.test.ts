import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLOUD_HOST, FALLBACK_CONTEXT_WINDOW, FALLBACK_MODEL, getConfig, isCloudHost, normalizeModelName } from '@/lib/config'
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/prompts'

describe('normalizeModelName', () => {
  it('strips local-proxy cloud suffixes for the cloud API', () => {
    expect(normalizeModelName('kimi-k2.6:cloud')).toBe('kimi-k2.6')
    expect(normalizeModelName('gpt-oss:120b-cloud')).toBe('gpt-oss:120b')
    expect(normalizeModelName('  gpt-oss:20b  ')).toBe('gpt-oss:20b')
  })

  it('leaves names alone for non-cloud hosts', () => {
    expect(normalizeModelName('gpt-oss:120b-cloud', 'http://127.0.0.1:11434')).toBe('gpt-oss:120b-cloud')
  })
})

describe('isCloudHost', () => {
  it('recognises ollama.com only', () => {
    expect(isCloudHost('https://ollama.com')).toBe(true)
    expect(isCloudHost('https://ollama.com/')).toBe(true)
    expect(isCloudHost('http://localhost:11434')).toBe(false)
    expect(isCloudHost('not a url')).toBe(false)
  })
})

describe('getConfig', () => {
  it('defaults to the Ollama web API', () => {
    const config = getConfig({})
    expect(config.host).toBe(CLOUD_HOST)
    expect(config.apiKey).toBeUndefined()
    expect(config.defaultModel).toBe(FALLBACK_MODEL)
    expect(config.contextWindow).toBe(FALLBACK_CONTEXT_WINDOW)
    expect(config.dataDir).toBe(path.resolve('data'))
    expect(config.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT)
  })

  it('reads and cleans environment values', () => {
    const config = getConfig({
      OLLAMA_API_KEY: '  key  ',
      OLLAMA_HOST: 'https://ollama.com/',
      OLLAMA_MODEL: 'kimi-k2.6:cloud',
      OLLAMA_CONTEXT_WINDOW: '256000',
      DATA_DIR: '/tmp/somewhere',
      SYSTEM_PROMPT: 'Be brief.',
    })
    expect(config).toMatchObject({
      apiKey: 'key',
      host: 'https://ollama.com',
      defaultModel: 'kimi-k2.6',
      contextWindow: 256000,
      dataDir: '/tmp/somewhere',
      systemPrompt: 'Be brief.',
    })
  })

  it('ignores blank or invalid numbers', () => {
    const config = getConfig({ OLLAMA_API_KEY: '   ', OLLAMA_CONTEXT_WINDOW: 'lots' })
    expect(config.apiKey).toBeUndefined()
    expect(config.contextWindow).toBe(FALLBACK_CONTEXT_WINDOW)
  })
})
