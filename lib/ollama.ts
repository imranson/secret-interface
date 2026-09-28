import { Ollama } from 'ollama'
import { getConfig, type AppConfig } from './config'

/** The subset of the Ollama SDK the app relies on (lets tests inject a fake). */
export type OllamaClient = Pick<Ollama, 'chat' | 'webSearch' | 'webFetch' | 'list' | 'show'>

export function createOllamaClient(config: AppConfig = getConfig()): OllamaClient {
  return new Ollama({
    host: config.host,
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
  })
}

let cached: { key: string; client: OllamaClient } | undefined

export function getOllamaClient(): OllamaClient {
  const config = getConfig()
  const key = `${config.host}\n${config.apiKey ?? ''}`
  if (cached?.key !== key) cached = { key, client: createOllamaClient(config) }
  return cached.client
}
