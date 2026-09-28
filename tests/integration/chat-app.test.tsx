// @vitest-environment jsdom
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatApp, type ChatAppProps } from '@/components/ChatApp'
import { clearModelCaches } from '@/lib/models'
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/prompts'
import { getStore } from '@/lib/store'
import { appFetch } from '../helpers/app-fetch'
import { chunk, createFakeOllama, HttpError, type FakeOllama } from '../helpers/fake-ollama'
import { makeTempDataDir } from '../helpers/temp-data'

const holder = vi.hoisted(() => ({ fake: undefined as FakeOllama | undefined }))
vi.mock('@/lib/ollama', () => ({ getOllamaClient: () => holder.fake!.client }))

let dataDir: string
let cleanup: () => Promise<void>

beforeEach(async () => {
  ;({ dir: dataDir, cleanup } = await makeTempDataDir())
  vi.stubEnv('DATA_DIR', dataDir)
  vi.stubEnv('OLLAMA_API_KEY', 'test-key')
  vi.stubEnv('OLLAMA_HOST', '')
  vi.stubEnv('OLLAMA_MODEL', 'kimi-k2.6')
  vi.stubEnv('OLLAMA_CONTEXT_WINDOW', '128000')
  vi.stubEnv('SYSTEM_PROMPT', '')
  vi.stubGlobal('fetch', appFetch)
  holder.fake = createFakeOllama()
  clearModelCaches()
  window.localStorage.clear()
  document.cookie = 'secret-interface.sidebar=; path=/; max-age=0'
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await cleanup()
})

function renderApp(props: Partial<ChatAppProps> = {}) {
  const user = userEvent.setup()
  render(
    <ChatApp defaultModel="kimi-k2.6" defaultContextWindow={128000} systemPrompt={DEFAULT_SYSTEM_PROMPT} {...props} />,
  )
  return user
}

async function send(user: ReturnType<typeof userEvent.setup>, text: string) {
  const box = screen.getByRole('textbox', { name: 'Message' })
  await user.click(box)
  await user.type(box, `${text}{Enter}`)
}

const sidebar = () => screen.getByRole('complementary', { name: 'Conversation history' })
const idle = () => waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument())

async function seedConversation(title: string, archived = false) {
  const store = getStore(dataDir)
  const conversation = store.create({ title })
  conversation.messages.push({ role: 'user', content: title }, { role: 'assistant', content: `An answer about *${title}*.` })
  await store.save(conversation)
  if (archived) await store.setArchived(conversation.id, true)
  return conversation
}

describe('ChatApp (UI → API routes → store → Ollama)', () => {
  it('chats with streaming Markdown rendered in the serif prose style and saves the conversation', async () => {
    holder.fake!.push({
      chunks: [
        chunk.content('Here is a **table**:\n\n'),
        chunk.content('| Fruit | Colour |\n| --- | --- |\n'),
        chunk.content('| Apple | Red |\n'),
        chunk.done(30, 12),
      ],
    })
    const user = renderApp()
    expect(await screen.findByRole('heading', { name: 'Nice to meet you, stranger.' })).toBeInTheDocument()

    await send(user, 'Show me a table')
    expect(screen.getByText('Show me a table', { selector: '.user-bubble' })).toBeInTheDocument()

    const cell = await screen.findByRole('cell', { name: 'Apple' })
    const reply = cell.closest('article')!
    expect(reply).toHaveAccessibleName('Assistant message')
    expect(cell.closest('.prose')).not.toBeNull()
    expect(within(reply).getByText('table', { selector: 'strong' })).toBeInTheDocument()
    await idle()

    // Sidebar history and the topbar pick up the new conversation.
    expect(within(sidebar()).getByRole('button', { name: 'Show me a table' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { level: 1, name: 'Show me a table' })).toBeInTheDocument()

    const [summary] = await getStore(dataDir).list()
    const saved = JSON.parse(await readFile(path.join(dataDir, 'conversations', `${summary.id}.json`), 'utf8'))
    expect(saved.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant'])
    expect(holder.fake!.requests[0]).toMatchObject({ model: 'kimi-k2.6', stream: true })
    expect(holder.fake!.requests[0]).not.toHaveProperty('think')
  })

  it('exposes the thinking option and shows the streamed reasoning', async () => {
    holder.fake!.push({
      chunks: [chunk.thinking('Weighing '), chunk.thinking('the options.'), chunk.content('Go with B.'), chunk.done()],
    })
    const user = renderApp()
    const thinking = screen.getByRole('combobox', { name: 'Thinking' })
    expect(within(thinking).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Thinking: auto',
      'Thinking: off',
      'Thinking: on',
      'Thinking: low',
      'Thinking: medium',
      'Thinking: high',
    ])
    await user.selectOptions(thinking, 'high')
    await send(user, 'A or B?')

    expect(await screen.findByText('Go with B.')).toBeInTheDocument()
    await idle()
    expect(holder.fake!.requests[0].think).toBe('high')

    const toggle = screen.getByRole('button', { name: /Thought process/ })
    await user.click(toggle)
    expect(screen.getByText('Weighing the options.')).toBeInTheDocument()
    expect(window.localStorage.getItem('secret-interface.think')).toBe('high')
  })

  it('streams tool calls (web search, web fetch, datetime) with their results', async () => {
    holder.fake!.push(
      { chunks: [chunk.toolCall('get_current_datetime', {}), chunk.toolCall('web_search', { query: 'ollama news' }), chunk.done()] },
      { chunks: [chunk.toolCall('web_fetch', { url: 'https://ollama.com/blog' }), chunk.done()] },
      { chunks: [chunk.content('Latest news summarised.'), chunk.done()] },
    )
    const user = renderApp()
    await send(user, "What's new with Ollama today?")

    expect(await screen.findByText('Latest news summarised.')).toBeInTheDocument()
    await idle()
    const reply = screen.getByRole('article', { name: 'Assistant message' })
    const cards = within(reply).getAllByRole('button', { expanded: false })
    expect(cards.map((c) => c.textContent)).toEqual([
      'Checked the date and time',
      'Searched the web for “ollama news”',
      'Read ollama.com',
    ])
    await user.click(within(reply).getByRole('button', { name: /Searched the web/ }))
    expect(within(reply).getByText(/About ollama news: Ollama runs models/)).toBeInTheDocument()
    expect(holder.fake!.client.webSearch).toHaveBeenCalledWith({ query: 'ollama news', max_results: 5 })
    expect(holder.fake!.client.webFetch).toHaveBeenCalledWith({ url: 'https://ollama.com/blog' })
  })

  it('shows the context estimate growing as the conversation does', async () => {
    holder.fake!.push({ chunks: [chunk.content('x'.repeat(4000)), chunk.done()] })
    const user = renderApp()
    const meter = screen.getByRole('meter', { name: 'Context window usage (estimate)' })
    await waitFor(() => expect(meter).toHaveAttribute('aria-valuemax', '131072'))
    const before = Number(meter.getAttribute('aria-valuenow'))
    expect(before).toBeGreaterThan(100)

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'y'.repeat(40))
    expect(Number(meter.getAttribute('aria-valuenow'))).toBe(before + 4 + 10)

    await user.keyboard('{Enter}')
    await screen.findByText('x'.repeat(4000))
    await idle()
    expect(Number(meter.getAttribute('aria-valuenow'))).toBeGreaterThan(before + 1000)
  })

  it('starts new conversations and reopens old ones from history', async () => {
    await seedConversation('Earlier chat')
    holder.fake!.push({ chunks: [chunk.content('Fresh reply.'), chunk.done()] })
    const user = renderApp()

    await user.click(await within(sidebar()).findByRole('button', { name: 'Earlier chat' }))
    expect(await screen.findByText('about', { exact: false, selector: '.prose p' })).toHaveTextContent(
      'An answer about Earlier chat.',
    )

    await user.click(screen.getByRole('button', { name: /New conversation/ }))
    expect(screen.getByRole('heading', { name: 'Nice to meet you, stranger.' })).toBeInTheDocument()
    expect(screen.queryByText('An answer about', { exact: false })).not.toBeInTheDocument()

    await send(user, 'Brand new topic')
    await screen.findByText('Fresh reply.')
    await idle()
    const titles = within(sidebar())
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(titles).toContain('Brand new topic')
    expect(titles).toContain('Earlier chat')
    expect(await getStore(dataDir).list()).toHaveLength(2)
    // The new conversation did not include the old one's messages.
    expect(holder.fake!.requests[0].messages!.map((m) => m.content)).toEqual([DEFAULT_SYSTEM_PROMPT, 'Brand new topic'])
  })

  it('archives conversations into the archive folder and restores them', async () => {
    const conversation = await seedConversation('Old plans')
    const user = renderApp()

    await user.click(await within(sidebar()).findByRole('button', { name: 'Archive “Old plans”' }))
    await waitFor(() =>
      expect(within(sidebar()).queryByRole('button', { name: 'Old plans' })).not.toBeInTheDocument(),
    )
    expect(existsSync(path.join(dataDir, 'conversations', 'archived', `${conversation.id}.json`))).toBe(true)
    expect(existsSync(path.join(dataDir, 'conversations', `${conversation.id}.json`))).toBe(false)

    await user.click(within(sidebar()).getByRole('button', { name: /^Archived/ }))
    await user.click(await within(sidebar()).findByRole('button', { name: 'Old plans' }))

    // Archived conversations open read-only with a restore prompt.
    expect(await screen.findByText('This conversation is archived.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Restore to continue' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled())
    expect(existsSync(path.join(dataDir, 'conversations', `${conversation.id}.json`))).toBe(true)
    await user.click(within(sidebar()).getByRole('button', { name: 'Recent' }))
    expect(within(sidebar()).getByRole('button', { name: 'Old plans' })).toBeInTheDocument()
  })

  it('archives the open conversation from the top bar', async () => {
    const conversation = await seedConversation('Current one')
    const user = renderApp()
    await user.click(await within(sidebar()).findByRole('button', { name: 'Current one' }))
    await screen.findByText('Current one', { selector: '.user-bubble' })

    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: /Archive/ }))
    await screen.findByRole('heading', { name: 'Nice to meet you, stranger.' })
    expect(existsSync(path.join(dataDir, 'conversations', 'archived', `${conversation.id}.json`))).toBe(true)
  })

  it('stops a streaming reply and keeps the partial answer', async () => {
    holder.fake!.push({ chunks: [chunk.content('Part one of the answer')], hang: true })
    const user = renderApp()
    await send(user, 'Tell me everything')
    await screen.findByText('Part one of the answer')

    await user.click(screen.getByRole('button', { name: 'Stop generating' }))
    await idle()
    expect(screen.getByText('Part one of the answer')).toBeInTheDocument()

    await waitFor(async () => {
      const [summary] = await getStore(dataDir).list()
      const saved = await getStore(dataDir).get(summary.id)
      expect(saved?.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Part one of the answer' })
    })
  })

  it('reports errors, restores the draft and shows notices', async () => {
    vi.stubEnv('OLLAMA_API_KEY', '')
    const user = renderApp()
    await send(user, 'Hello?')
    expect(await screen.findByRole('alert')).toHaveTextContent('OLLAMA_API_KEY is not set')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Hello?')
    expect(screen.queryByText('Hello?', { selector: '.user-bubble' })).not.toBeInTheDocument()

    vi.stubEnv('OLLAMA_API_KEY', 'test-key')
    holder.fake!.push(
      { error: new HttpError('"kimi-k2.6" does not support thinking', 400) },
      { chunks: [chunk.content('Answer without thinking.'), chunk.done()] },
    )
    await user.selectOptions(screen.getByRole('combobox', { name: 'Thinking' }), 'on')
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText('Answer without thinking.')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('does not support thinking')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lets the user switch models', async () => {
    holder.fake!.push({ chunks: [chunk.content('From gpt-oss.'), chunk.done()] })
    const user = renderApp()
    const select = screen.getByRole('combobox', { name: 'Model' })
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2))
    await user.selectOptions(select, 'gpt-oss:120b')
    await send(user, 'Which model?')
    await screen.findByText('From gpt-oss.')
    expect(holder.fake!.requests[0].model).toBe('gpt-oss:120b')
    expect(window.localStorage.getItem('secret-interface.model')).toBe('gpt-oss:120b')
  })

  it('collapses and expands the sidebar, remembering the choice in a cookie', async () => {
    await seedConversation('Kept safe')
    const user = renderApp()
    await within(sidebar()).findByRole('button', { name: 'Kept safe' })

    await user.click(screen.getByRole('button', { name: 'Hide conversations' }))
    expect(sidebar()).toHaveAttribute('inert')
    expect(document.cookie).toContain('secret-interface.sidebar=collapsed')

    await user.click(screen.getByRole('button', { name: 'Show conversations' }))
    expect(sidebar()).not.toHaveAttribute('inert')
    expect(within(sidebar()).getByRole('button', { name: 'Kept safe' })).toBeInTheDocument()
    expect(document.cookie).toContain('secret-interface.sidebar=expanded')
  })

  it('starts collapsed when the page restores that preference', () => {
    renderApp({ sidebarCollapsed: true })
    expect(sidebar()).toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: 'Show conversations' })).toBeInTheDocument()
  })

  it('uses a drawer on small screens and leaves the wide-screen preference alone', async () => {
    vi.stubGlobal('matchMedia', (media: string) => ({
      media,
      matches: media === '(max-width: 820px)',
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    await seedConversation('On the go')
    const user = renderApp({ sidebarCollapsed: true })

    // Collapsing only applies to wide screens; the drawer starts closed.
    expect(sidebar()).not.toHaveAttribute('inert')
    expect(sidebar()).not.toHaveAttribute('data-open')

    await user.click(screen.getByRole('button', { name: 'Show conversations' }))
    expect(sidebar()).toHaveAttribute('data-open')
    await user.click(await within(sidebar()).findByRole('button', { name: 'On the go' }))
    await waitFor(() => expect(sidebar()).not.toHaveAttribute('data-open'))
    expect(document.cookie).not.toContain('secret-interface.sidebar')
  })
})
