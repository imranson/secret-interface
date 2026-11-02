// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar, type SidebarProps } from '@/components/Sidebar'
import type { ConversationSummary, ScheduleStatus, ScheduleView } from '@/lib/types'

vi.mock('next/link', async () => ({ default: (await import('../../helpers/next-navigation')).Link }))

const conv = (id: string, title: string, archived = false): ConversationSummary => ({
  id,
  title,
  archived,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  message_count: 2,
})

const schedule = (status: ScheduleStatus, overrides: Partial<ScheduleView> = {}): ScheduleView => ({
  id: status,
  title: `${status} report`,
  prompt: 'Top news, briefly',
  rule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
  enabled: status !== 'paused',
  conversationId: null,
  nextRunAt: '2099-01-01T09:00:00.000Z',
  lastRunAt: null,
  lastError: null,
  unread: status === 'unread',
  status,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
  ...overrides,
})

function setup(overrides: Partial<SidebarProps> = {}) {
  const props: SidebarProps = {
    view: 'recent',
    onViewChange: vi.fn(),
    conversations: [conv('a', 'Alpha'), conv('b', 'Beta')],
    archived: null,
    schedules: [],
    currentId: 'b',
    busyId: null,
    open: false,
    collapsed: false,
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onArchive: vi.fn(),
    onRestore: vi.fn(),
    onNewSchedule: vi.fn(),
    onRunSchedule: vi.fn(),
    onSetScheduleEnabled: vi.fn(),
    onDeleteSchedule: vi.fn(),
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
    expect(within(nav).getByRole('link', { name: 'Beta' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Alpha' })).not.toHaveAttribute('aria-current')
  })

  it('links each conversation to its own URL', () => {
    setup()
    expect(screen.getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/c/a')
    expect(screen.getByRole('link', { name: /New conversation/ })).toHaveAttribute('href', '/')
  })

  it('opens, creates and archives conversations', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('link', { name: 'Alpha' }))
    expect(props.onSelect).toHaveBeenCalledWith('a')
    expect(window.location.pathname).toBe('/c/a')
    await userEvent.click(screen.getByRole('link', { name: /New conversation/ }))
    expect(props.onNew).toHaveBeenCalled()
    expect(window.location.pathname).toBe('/')
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

  it('is interactive while expanded', () => {
    setup()
    const aside = screen.getByRole('complementary', { name: 'Conversation history' })
    expect(aside).not.toHaveAttribute('inert')
    expect(aside).not.toHaveAttribute('data-collapsed')
  })

  it('takes itself out of the tab order and accessibility tree while collapsed', () => {
    setup({ collapsed: true })
    const aside = screen.getByRole('complementary', { name: 'Conversation history' })
    expect(aside).toHaveAttribute('inert')
    expect(aside).toHaveAttribute('data-collapsed')
  })

  describe('schedules', () => {
    const counts = () => screen.getByRole('list', { name: 'Schedules' }).parentElement!.querySelector('dl')!

    it('badges the tab with how many reports are unread', () => {
      setup({ schedules: [schedule('unread'), schedule('completed')] })
      expect(screen.getByRole('button', { name: 'Scheduled, 1 unread' })).toHaveTextContent('Scheduled1')
    })

    it('shows no badge when everything has been read', () => {
      setup({ schedules: [schedule('completed')] })
      expect(screen.getByRole('button', { name: 'Scheduled' })).toHaveTextContent(/^Scheduled$/)
    })

    it('counts scheduled, unread and completed, and labels each schedule', () => {
      setup({
        view: 'scheduled',
        schedules: [
          schedule('scheduled'),
          schedule('unread'),
          schedule('completed', { id: 'c1' }),
          schedule('completed', { id: 'c2' }),
          schedule('running'),
          schedule('failed', { lastError: 'offline' }),
          schedule('paused'),
        ],
      })
      expect(counts()).toHaveTextContent('1scheduled')
      expect(counts()).toHaveTextContent('1unread')
      expect(counts()).toHaveTextContent('2completed')
      const items = within(screen.getByRole('list', { name: 'Schedules' })).getAllByRole('listitem')
      const row = (title: string) => items.find((item) => within(item).queryByText(title))!
      expect(row('running report')).toHaveTextContent('Running · Every day at 09:00')
      expect(row('failed report')).toHaveTextContent('offline')
      expect(row('paused report')).not.toHaveTextContent('Next:')
    })

    it('explains how to start when there are none', async () => {
      const props = setup({ view: 'scheduled' })
      expect(screen.getByText(/Nothing scheduled yet/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'New schedule' }))
      expect(props.onNewSchedule).toHaveBeenCalled()
    })

    it('links a schedule to its conversation once it has one', async () => {
      const props = setup({
        view: 'scheduled',
        schedules: [schedule('unread', { conversationId: 'a' }), schedule('scheduled')],
      })
      expect(screen.queryByRole('link', { name: 'scheduled report' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('link', { name: 'unread report' }))
      expect(props.onSelect).toHaveBeenCalledWith('a')
    })

    it('runs, pauses, resumes and deletes', async () => {
      const props = setup({ view: 'scheduled', schedules: [schedule('scheduled'), schedule('paused')] })
      await userEvent.click(screen.getByRole('button', { name: 'Run “scheduled report” now' }))
      expect(props.onRunSchedule).toHaveBeenCalledWith('scheduled')
      await userEvent.click(screen.getByRole('button', { name: 'Pause “scheduled report”' }))
      expect(props.onSetScheduleEnabled).toHaveBeenCalledWith('scheduled', false)
      await userEvent.click(screen.getByRole('button', { name: 'Resume “paused report”' }))
      expect(props.onSetScheduleEnabled).toHaveBeenCalledWith('paused', true)
      await userEvent.click(screen.getByRole('button', { name: 'Delete schedule “scheduled report”' }))
      expect(props.onDeleteSchedule).toHaveBeenCalledWith('scheduled')
    })

    it('cannot start a run that is already going', () => {
      setup({ view: 'scheduled', schedules: [schedule('running')] })
      expect(screen.getByRole('button', { name: 'Run “running report” now' })).toBeDisabled()
    })

    it('marks an unread report in the Recent list', () => {
      setup({ schedules: [schedule('unread', { conversationId: 'a' })] })
      const link = screen.getByRole('link', { name: 'Unread: Alpha' })
      expect(link.closest('li')!.querySelector('[data-status="unread"]')).not.toBeNull()
      expect(screen.getByRole('link', { name: 'Beta' }).closest('li')!.querySelector('.status-mark')).toBeNull()
    })
  })
})
