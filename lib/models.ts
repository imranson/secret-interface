import { getConfig, normalizeModelName } from './config'
import { describeError } from './errors'
import { getOllamaClient } from './ollama'

const MODELS_TTL_MS = 10 * 60 * 1000
let modelsCache: { at: number; models: string[] } | undefined
const contextCache = new Map<string, number>()

export function clearModelCaches() {
  modelsCache = undefined
  contextCache.clear()
}

export interface ModelList {
  defaultModel: string
  models: string[]
  error?: string
}

/** Lists models available to the API key, always including the configured default. */
export async function listModels(): Promise<ModelList> {
  const config = getConfig()
  let models: string[] = []
  let error: string | undefined
  if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) {
    models = modelsCache.models
  } else {
    try {
      const response = await getOllamaClient().list()
      models = [...new Set(response.models.map((m) => normalizeModelName(m.name || m.model, config.host)))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
      modelsCache = { at: Date.now(), models }
    } catch (e) {
      error = describeError(e)
    }
  }
  if (!models.includes(config.defaultModel)) models = [config.defaultModel, ...models]
  return { defaultModel: config.defaultModel, models, ...(error && { error }) }
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
export async function getModelInfo(requested?: string | null): Promise<ModelInfo> {
  const config = getConfig()
  const model = normalizeModelName(requested?.trim() || config.defaultModel, config.host)
  let contextLength = contextCache.get(model)
  if (contextLength === undefined) {
    try {
      const info = await getOllamaClient().show({ model })
      contextLength = contextLengthFrom(info.model_info)
      if (contextLength) contextCache.set(model, contextLength)
    } catch {
      // Fall back to the configured window below.
    }
  }
  return contextLength
    ? { model, contextLength, source: 'model' }
    : { model, contextLength: config.contextWindow, source: 'config' }
}
