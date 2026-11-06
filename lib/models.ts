import { configuredModel, getConfig, hostFor, normalizeModelName } from './config'
import { describeError } from './errors'
import { getOllamaClient } from './ollama'
import type { Backend, ModelList } from './types'

const MODELS_TTL_MS = 10 * 60 * 1000
// Both keyed by host, so the cloud and local backends never share entries.
const modelsCache = new Map<string, { at: number; models: string[]; newest?: string }>()
const contextCache = new Map<string, number>()

export function clearModelCaches() {
  modelsCache.clear()
  contextCache.clear()
}

/** Lists the backend's models, always including its configured default. */
export async function listModels(backend: Backend = 'cloud'): Promise<ModelList> {
  const config = getConfig()
  const host = hostFor(config, backend)
  let models: string[] = []
  // Ollama lists the most recently pulled model first; it's the default when none is configured.
  let newest: string | undefined
  let error: string | undefined
  const cached = modelsCache.get(host)
  if (cached && Date.now() - cached.at < MODELS_TTL_MS) {
    ;({ models, newest } = cached)
  } else {
    try {
      const response = await getOllamaClient(backend).list()
      const names = response.models.map((m) => normalizeModelName(m.name || m.model, host)).filter(Boolean)
      newest = names[0]
      models = [...new Set(names)].sort((a, b) => a.localeCompare(b))
      modelsCache.set(host, { at: Date.now(), models, newest })
    } catch (e) {
      error = describeError(e)
    }
  }
  const configured = configuredModel(config, backend)
  if (configured && !models.includes(configured)) models = [configured, ...models]
  return { backend, host, defaultModel: configured ?? newest ?? '', models, ...(error && { error }) }
}

/** The model to use when none was picked; empty if the backend has none. */
export async function defaultModelFor(backend: Backend = 'cloud'): Promise<string> {
  return configuredModel(getConfig(), backend) ?? (await listModels(backend)).defaultModel
}

/** Reads `<architecture>.context_length` from /api/show's model_info. */
export function contextLengthFrom(modelInfo: unknown): number | undefined {
  if (!modelInfo || typeof modelInfo !== 'object') return undefined
  for (const [key, value] of Object.entries(modelInfo)) {
    if (key.endsWith('.context_length') && typeof value === 'number' && value > 0) return value
  }
  return undefined
}

export interface ModelInfo {
  model: string
  contextLength: number
  source: 'model' | 'config'
}

/** The model's context window, falling back to OLLAMA_CONTEXT_WINDOW when /api/show can't tell. */
export async function getModelInfo(requested?: string | null, backend: Backend = 'cloud'): Promise<ModelInfo> {
  const config = getConfig()
  const host = hostFor(config, backend)
  const model = normalizeModelName(requested?.trim() || configuredModel(config, backend) || '', host)
  const key = `${host}\n${model}`
  let contextLength = contextCache.get(key)
  if (contextLength === undefined && model) {
    try {
      const info = await getOllamaClient(backend).show({ model })
      contextLength = contextLengthFrom(info.model_info)
      if (contextLength) contextCache.set(key, contextLength)
    } catch {
      // Fall back to the configured window below.
    }
  }
  return contextLength
    ? { model, contextLength, source: 'model' }
    : { model, contextLength: config.contextWindow, source: 'config' }
}
