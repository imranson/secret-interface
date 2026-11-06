import { Ollama } from 'ollama'
import { getConfig, hostFor, type AppConfig } from './config'
import type { Backend } from './types'

/** The subset of the Ollama SDK the app relies on (lets tests inject a fake). */
export type OllamaClient = Pick<Ollama, 'chat' | 'webSearch' | 'webFetch' | 'list' | 'show'>

export function createOllamaClient(config: AppConfig = getConfig(), backend: Backend = 'cloud'): OllamaClient {
  // The key only goes to the cloud host. A local server doesn't need it, and the SDK signs its web_search /
  // web_fetch calls (always sent to https://ollama.com) with OLLAMA_API_KEY itself, so local chats keep the web tools.
  const sendKey = backend === 'cloud' && config.apiKey
  return new Ollama({
    host: hostFor(config, backend),
    headers: sendKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
  })
}

const cached = new Map<Backend, { key: string; client: OllamaClient }>()

export function getOllamaClient(backend: Backend = 'cloud'): OllamaClient {
  const config = getConfig()
  const key = `${hostFor(config, backend)}\n${config.apiKey ?? ''}`
  let entry = cached.get(backend)
  if (entry?.key !== key) {
    entry = { key, client: createOllamaClient(config, backend) }
    cached.set(backend, entry)
  }
  return entry.client
}
