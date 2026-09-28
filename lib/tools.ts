import type { WebFetchResponse, WebSearchRequest } from 'ollama'
import type { OllamaClient } from './ollama'
import { GET_CURRENT_DATETIME, TOOL_DEFINITIONS, WEB_FETCH, WEB_SEARCH } from './tool-definitions'
import type { ToolCallRecord } from './types'

export { TOOL_DEFINITIONS }

/** Caps what a single tool result can add to the context window. */
export const MAX_TOOL_OUTPUT_CHARS = 12_000
const MAX_SEARCH_EXCERPT_CHARS = 2_000
const MAX_FETCH_LINKS = 25

export interface ToolContext {
  client: Pick<OllamaClient, 'webSearch' | 'webFetch'>
  /** Default time zone for the datetime tool (normally the browser's). */
  timeZone?: string
  now?: () => Date
}

export interface ToolResult {
  content: string
  error?: boolean
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** Some models send arguments as a JSON string rather than an object. */
export function parseToolArguments(args: unknown): Record<string, unknown> {
  if (typeof args === 'string') {
    try {
      const parsed: unknown = JSON.parse(args)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`"${key}" is required`)
  return value.trim()
}

interface SearchHit {
  title?: string
  url?: string
  content?: string
}

async function webSearch(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const query = requireString(args, 'query')
  const requested = Number(args.max_results ?? 5)
  const maxResults = Number.isFinite(requested) ? Math.min(10, Math.max(1, Math.round(requested))) : 5
  // The REST API expects snake_case `max_results`; the SDK passes the request body through as-is.
  const request = { query, max_results: maxResults } as unknown as WebSearchRequest
  const response = await ctx.client.webSearch(request)
  const hits = (response.results ?? []) as SearchHit[]
  if (hits.length === 0) return `No results found for "${query}".`
  const body = hits
    .map((hit, i) =>
      [
        `[${i + 1}] ${hit.title?.trim() || 'Untitled'}`,
        hit.url ? `URL: ${hit.url}` : '',
        truncate((hit.content ?? '').trim(), MAX_SEARCH_EXCERPT_CHARS),
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n')
  return truncate(`Search results for "${query}":\n\n${body}`, MAX_TOOL_OUTPUT_CHARS)
}

async function webFetch(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const raw = requireString(args, 'url')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`"${raw}" is not a valid URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) URLs can be fetched')
  const page: Partial<WebFetchResponse> = await ctx.client.webFetch({ url: url.toString() })
  const links = (page.links ?? []).slice(0, MAX_FETCH_LINKS)
  const text = [
    `Title: ${page.title?.trim() || 'Untitled'}`,
    `URL: ${page.url || url.toString()}`,
    '',
    (page.content ?? '').trim() || '(no readable content)',
    links.length ? `\nLinks:\n${links.map((l) => `- ${l}`).join('\n')}` : '',
  ].join('\n')
  return truncate(text, MAX_TOOL_OUTPUT_CHARS)
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone })
    return true
  } catch {
    return false
  }
}

export function currentDateTime(timeZone: string, now: Date): Record<string, string | number> {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  const offset = parts.timeZoneName === 'GMT' ? '+00:00' : String(parts.timeZoneName).replace('GMT', '')
  return {
    timezone: timeZone,
    local_iso: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`,
    local: new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'full', timeStyle: 'long' }).format(now),
    day_of_week: new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long' }).format(now),
    utc_offset: offset,
    utc_iso: now.toISOString(),
    unix_seconds: Math.floor(now.getTime() / 1000),
  }
}

function datetime(args: Record<string, unknown>, ctx: ToolContext): string {
  const requested = typeof args.timezone === 'string' ? args.timezone.trim() : ''
  if (requested && !isValidTimeZone(requested)) throw new Error(`Unknown time zone "${requested}"`)
  const fallback =
    ctx.timeZone && isValidTimeZone(ctx.timeZone) ? ctx.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone
  return JSON.stringify(currentDateTime(requested || fallback, ctx.now?.() ?? new Date()), null, 2)
}

export async function executeTool(call: ToolCallRecord, ctx: ToolContext): Promise<ToolResult> {
  const name = call.function?.name
  const args = parseToolArguments(call.function?.arguments)
  try {
    switch (name) {
      case WEB_SEARCH:
        return { content: await webSearch(args, ctx) }
      case WEB_FETCH:
        return { content: await webFetch(args, ctx) }
      case GET_CURRENT_DATETIME:
        return { content: datetime(args, ctx) }
      default:
        return {
          content: `Error: unknown tool "${name}". Available tools: ${TOOL_DEFINITIONS.map((t) => t.function.name).join(', ')}.`,
          error: true,
        }
    }
  } catch (error) {
    return { content: `Error: ${(error as Error).message}`, error: true }
  }
}
