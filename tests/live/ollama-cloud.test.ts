/**
 * Live smoke tests against the real Ollama web API. They use OLLAMA_API_KEY from .env.local and
 * are skipped unless run with `npm run test:live`.
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runAgent, type AgentEvent } from '@/lib/agent'
import { getConfig } from '@/lib/config'
import { createOllamaClient } from '@/lib/ollama'
import { executeTool } from '@/lib/tools'
import type { ChatMessage } from '@/lib/types'

// Next's loader skips .env.local when NODE_ENV=test, so load it directly.
if (existsSync('.env.local')) process.loadEnvFile('.env.local')
const config = getConfig()
const enabled = Boolean(process.env.LIVE && config.apiKey)

describe.skipIf(!enabled)('Ollama cloud (live)', { timeout: 120_000 }, () => {
  const client = createOllamaClient(config)

  it('lists models for the API key, including the default', async () => {
    const { models } = await client.list()
    const names = models.map((m) => m.name)
    expect(names.length).toBeGreaterThan(0)
    console.info(`default=${config.defaultModel}; available: ${names.join(', ')}`)
  })

  it('streams a chat reply from the default model', async () => {
    const stream = await client.chat({
      model: config.defaultModel,
      messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
      stream: true,
    })
    let content = ''
    for await (const part of stream) content += part.message?.content ?? ''
    expect(content.toLowerCase()).toContain('pong')
  })

  it('runs web search and web fetch through the tool executor', async () => {
    const search = await executeTool({ function: { name: 'web_search', arguments: { query: 'Ollama', max_results: 2 } } }, { client })
    expect(search.error).toBeUndefined()
    expect(search.content).toMatch(/\[1\]/)

    const page = await executeTool({ function: { name: 'web_fetch', arguments: { url: 'https://ollama.com' } } }, { client })
    expect(page.error).toBeUndefined()
    expect(page.content).toContain('Title:')
  })

  it('completes an agent loop that calls the datetime tool', async () => {
    const output: ChatMessage[] = []
    const events: AgentEvent[] = []
    for await (const event of runAgent({
      client,
      model: config.defaultModel,
      history: [{ role: 'user', content: 'Use the get_current_datetime tool, then tell me what year it is.' }],
      systemPrompt: config.systemPrompt,
      output,
      timeZone: 'Europe/London',
    })) {
      events.push(event)
    }
    expect(events.some((e) => e.type === 'tool_call' && e.call.function.name === 'get_current_datetime')).toBe(true)
    expect(output.at(-1)?.content).toContain(String(new Date().getFullYear()))
  })
})
