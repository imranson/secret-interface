// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar, type SidebarProps } from '@/components/Sidebar'
import type { ConversationSummary } from '@/lib/types'

const conv = (id: string, title: string, archived = false): ConversationSummary => ({
  id,
  title,
  archived,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  message_count: 2,
})

function setup(overrides: Partial<SidebarProps> = {}) {
  const props: SidebarProps = {
    view: 'recent',
    onViewChange: vi.fn(),
    conversations: [conv('a', 'Alpha'), conv('b', 'Beta')],
    archived: null,
    currentId: 'b',
    busyId: null,
    open: false,
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onArchive: vi.fn(),
    onRestore: vi.fn(),
    ...overrides,
  }
  render(<Sidebar {...props} />)
  return props
}

describe('<Sidebar>', () => {
  it('lists recent conversations grouped by date and marks the current one', () => {
    setup()
    const nav = screen.getByRole('navigation', { name: 'Recent conversations' })
    expect(within(nav).getByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('button', { name: 'Alpha' })).not.toHaveAttribute('aria-current')
  })

  it('opens, creates and archives conversations', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Alpha' }))
    expect(props.onSelect).toHaveBeenCalledWith('a')
    await userEvent.click(screen.getByRole('button', { name: /New conversation/ }))
    expect(props.onNew).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Archive “Alpha”' }))
    expect(props.onArchive).toHaveBeenCalledWith('a')
  })

  it('will not archive the conversation that is streaming', () => {
    setup({ busyId: 'b' })
    expect(screen.getByRole('button', { name: 'Archive “Beta”' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Archive “Alpha”' })).toBeEnabled()
  })

  it('switches to the archive and restores from it', async () => {
    const props = setup({ view: 'archived', archived: [conv('z', 'Zed', true)] })
    expect(screen.getByRole('button', { name: 'Archived (1)' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Restore “Zed”' }))
    expect(props.onRestore).toHaveBeenCalledWith('z')
    await userEvent.click(screen.getByRole('button', { name: 'Recent' }))
    expect(props.onViewChange).toHaveBeenCalledWith('recent')
  })

  it('shows loading and empty states', () => {
    setup({ view: 'archived', archived: null })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an empty archive message', () => {
    setup({ view: 'archived', archived: [] })
    expect(screen.getByText('Nothing archived.')).toBeInTheDocument()
  })
})
