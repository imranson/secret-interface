import { describe, expect, it, vi } from 'vitest'
import { GET_CURRENT_DATETIME, TOOL_DEFINITIONS, WEB_FETCH, WEB_SEARCH } from '@/lib/tool-definitions'
import { currentDateTime, executeTool, MAX_TOOL_OUTPUT_CHARS, parseToolArguments, truncate } from '@/lib/tools'
import { createFakeOllama } from '../helpers/fake-ollama'

const call = (name: string, args: unknown) => ({ function: { name, arguments: args as Record<string, unknown> } })

describe('tool definitions', () => {
  it('exposes web search, web fetch and datetime tools', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.function.name)).toEqual([WEB_SEARCH, WEB_FETCH, GET_CURRENT_DATETIME])
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.type).toBe('function')
      expect(tool.function.description).toBeTruthy()
      expect(tool.function.parameters?.type).toBe('object')
    }
  })
})

describe('parseToolArguments', () => {
  it('accepts objects and JSON strings', () => {
    expect(parseToolArguments({ a: 1 })).toEqual({ a: 1 })
    expect(parseToolArguments('{"a":1}')).toEqual({ a: 1 })
  })

  it('returns an empty object for anything else', () => {
    expect(parseToolArguments('not json')).toEqual({})
    expect(parseToolArguments('[1,2]')).toEqual({})
    expect(parseToolArguments(null)).toEqual({})
    expect(parseToolArguments([1])).toEqual({})
  })
})

describe('truncate', () => {
  it('only shortens long text', () => {
    expect(truncate('abc', 5)).toBe('abc')
    expect(truncate('abcdef', 4)).toBe('abc…')
  })
})

describe('web_search', () => {
  it('calls the Ollama web search API with snake_case max_results and formats results', async () => {
    const { client } = createFakeOllama()
    client.webSearch.mockResolvedValueOnce({
      results: [
        { title: 'First', url: 'https://a.example', content: 'Alpha' },
        { title: '', url: 'https://b.example', content: 'Beta' },
      ],
    })
    const result = await executeTool(call(WEB_SEARCH, { query: ' ollama ', max_results: 3 }), { client })
    expect(client.webSearch).toHaveBeenCalledWith({ query: 'ollama', max_results: 3 })
    expect(result.error).toBeUndefined()
    expect(result.content).toContain('Search results for "ollama"')
    expect(result.content).toContain('[1] First\nURL: https://a.example\nAlpha')
    expect(result.content).toContain('[2] Untitled')
  })

  it('clamps max_results to 1-10 and defaults to 5', async () => {
    const { client } = createFakeOllama()
    await executeTool(call(WEB_SEARCH, { query: 'q', max_results: 50 }), { client })
    await executeTool(call(WEB_SEARCH, { query: 'q', max_results: 0 }), { client })
    await executeTool(call(WEB_SEARCH, { query: 'q' }), { client })
    await executeTool(call(WEB_SEARCH, { query: 'q', max_results: 'many' }), { client })
    expect(client.webSearch.mock.calls.map(([r]) => (r as unknown as { max_results: number }).max_results)).toEqual([10, 1, 5, 5])
  })

  it('reports empty results and missing queries', async () => {
    const { client } = createFakeOllama()
    client.webSearch.mockResolvedValueOnce({ results: [] })
    expect((await executeTool(call(WEB_SEARCH, { query: 'nothing' }), { client })).content).toBe(
      'No results found for "nothing".',
    )
    const missing = await executeTool(call(WEB_SEARCH, {}), { client })
    expect(missing).toEqual({ content: 'Error: "query" is required', error: true })
  })

  it('caps very large results', async () => {
    const { client } = createFakeOllama()
    client.webSearch.mockResolvedValueOnce({
      results: Array.from({ length: 10 }, (_, i) => ({ title: `R${i}`, url: 'https://x', content: 'z'.repeat(5000) })),
    })
    const result = await executeTool(call(WEB_SEARCH, { query: 'big' }), { client })
    expect(result.content.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_CHARS)
  })

  it('turns API failures into an error result instead of throwing', async () => {
    const { client } = createFakeOllama()
    client.webSearch.mockRejectedValueOnce(new Error('unauthorized'))
    expect(await executeTool(call(WEB_SEARCH, { query: 'q' }), { client })).toEqual({
      content: 'Error: unauthorized',
      error: true,
    })
  })
})

describe('web_fetch', () => {
  it('fetches the page and formats title, content and links', async () => {
    const { client } = createFakeOllama()
    const result = await executeTool(call(WEB_FETCH, { url: 'https://example.com' }), { client })
    expect(client.webFetch).toHaveBeenCalledWith({ url: 'https://example.com/' })
    expect(result.content).toContain('Title: Example Domain')
    expect(result.content).toContain('URL: https://example.com/')
    expect(result.content).toContain('illustrative examples')
    expect(result.content).toContain('- https://www.iana.org/domains/example')
  })

  it('rejects invalid and non-http URLs without calling the API', async () => {
    const { client } = createFakeOllama()
    expect(await executeTool(call(WEB_FETCH, { url: 'nope' }), { client })).toMatchObject({ error: true })
    expect(await executeTool(call(WEB_FETCH, { url: 'file:///etc/passwd' }), { client })).toEqual({
      content: 'Error: Only http(s) URLs can be fetched',
      error: true,
    })
    expect(client.webFetch).not.toHaveBeenCalled()
  })

  it('truncates long pages', async () => {
    const { client } = createFakeOllama()
    client.webFetch.mockResolvedValueOnce({ title: 'Long', url: 'https://x.dev', content: 'w'.repeat(50_000), links: [] })
    const result = await executeTool(call(WEB_FETCH, { url: 'https://x.dev' }), { client })
    expect(result.content.length).toBe(MAX_TOOL_OUTPUT_CHARS)
    expect(result.content.endsWith('…')).toBe(true)
  })
})

describe('get_current_datetime', () => {
  const now = new Date('2026-09-27T16:45:30Z')

  it('formats a moment in a given time zone', () => {
    expect(currentDateTime('Europe/London', now)).toMatchObject({
      timezone: 'Europe/London',
      local_iso: '2026-09-27T17:45:30+01:00',
      day_of_week: 'Sunday',
      utc_offset: '+01:00',
      utc_iso: '2026-09-27T16:45:30.000Z',
      unix_seconds: Math.floor(now.getTime() / 1000),
    })
    expect(currentDateTime('UTC', now).utc_offset).toBe('+00:00')
    expect(currentDateTime('Asia/Kolkata', now).local_iso).toBe('2026-09-27T22:15:30+05:30')
  })

  it("uses the user's time zone by default and the model's when given", async () => {
    const { client } = createFakeOllama()
    const ctx = { client, timeZone: 'America/New_York', now: () => now }
    const byDefault = JSON.parse((await executeTool(call(GET_CURRENT_DATETIME, {}), ctx)).content)
    expect(byDefault.timezone).toBe('America/New_York')
    expect(byDefault.local_iso).toBe('2026-09-27T12:45:30-04:00')

    const explicit = JSON.parse((await executeTool(call(GET_CURRENT_DATETIME, { timezone: 'Asia/Tokyo' }), ctx)).content)
    expect(explicit.local_iso).toBe('2026-09-28T01:45:30+09:00')
    expect(explicit.day_of_week).toBe('Monday')
  })

  it('rejects unknown time zones from the model, and ignores a bad default', async () => {
    const { client } = createFakeOllama()
    const bad = await executeTool(call(GET_CURRENT_DATETIME, { timezone: 'Mars/Olympus' }), { client })
    expect(bad).toEqual({ content: 'Error: Unknown time zone "Mars/Olympus"', error: true })

    const fallback = await executeTool(call(GET_CURRENT_DATETIME, {}), { client, timeZone: 'Nope/Nope', now: () => now })
    expect(fallback.error).toBeUndefined()
    expect(JSON.parse(fallback.content).timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })
})

describe('unknown tools', () => {
  it('returns an error listing the available tools', async () => {
    const { client } = createFakeOllama()
    const result = await executeTool(call('launch_rockets', {}), { client })
    expect(result.error).toBe(true)
    expect(result.content).toContain('unknown tool "launch_rockets"')
    expect(result.content).toContain('web_search, web_fetch, get_current_datetime')
  })

  it('accepts string-encoded arguments', async () => {
    const { client } = createFakeOllama()
    const spy = vi.spyOn(client, 'webSearch')
    await executeTool(call(WEB_SEARCH, '{"query":"stringly"}'), { client })
    expect(spy).toHaveBeenCalledWith({ query: 'stringly', max_results: 5 })
  })
})
