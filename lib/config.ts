import path from 'node:path'
import { DEFAULT_SYSTEM_PROMPT } from './prompts'

export const CLOUD_HOST = 'https://ollama.com'
export const FALLBACK_MODEL = 'gpt-oss:120b'
export const FALLBACK_CONTEXT_WINDOW = 128_000

export interface AppConfig {
  apiKey?: string
  host: string
  defaultModel: string
  contextWindow: number
  dataDir: string
  systemPrompt: string
  maxToolRounds: number
}

type Env = Record<string, string | undefined>

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function isCloudHost(host: string): boolean {
  try {
    return new URL(host).hostname === 'ollama.com'
  } catch {
    return false
  }
}

/**
 * Model names like `gpt-oss:120b-cloud` or `kimi-k2:cloud` are how a *local* Ollama server proxies
 * cloud models. The cloud API itself expects the bare name (`gpt-oss:120b`, `kimi-k2`).
 */
export function normalizeModelName(name: string, host: string = CLOUD_HOST): string {
  const model = name.trim()
  if (!isCloudHost(host)) return model
  if (model.endsWith(':cloud')) return model.slice(0, -':cloud'.length)
  if (model.endsWith('-cloud')) return model.slice(0, -'-cloud'.length)
  return model
}

export function getConfig(env: Env = process.env): AppConfig {
  const host = (clean(env.OLLAMA_HOST) ?? CLOUD_HOST).replace(/\/+$/, '')
  return {
    apiKey: clean(env.OLLAMA_API_KEY),
    host,
    defaultModel: normalizeModelName(clean(env.OLLAMA_MODEL) ?? FALLBACK_MODEL, host),
    contextWindow: positiveInt(env.OLLAMA_CONTEXT_WINDOW, FALLBACK_CONTEXT_WINDOW),
    // Resolved at runtime; not a build-time file dependency.
    dataDir: path.resolve(/*turbopackIgnore: true*/ process.cwd(), clean(env.DATA_DIR) ?? 'data'),
    systemPrompt: clean(env.SYSTEM_PROMPT) ?? DEFAULT_SYSTEM_PROMPT,
    maxToolRounds: positiveInt(env.MAX_TOOL_ROUNDS, 8),
  }
}
