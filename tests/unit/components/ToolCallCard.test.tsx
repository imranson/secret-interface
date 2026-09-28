// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { describeToolCall, ToolCallCard } from '@/components/ToolCallCard'

describe('describeToolCall', () => {
  it('describes each tool in plain language', () => {
    expect(describeToolCall('web_search', { query: 'tides' }, true).label).toBe('Searching the web for “tides”')
    expect(describeToolCall('web_search', { query: 'tides' }, false).label).toBe('Searched the web for “tides”')
    expect(describeToolCall('web_fetch', { url: 'https://www.bbc.co.uk/news' }, false).label).toBe('Read bbc.co.uk')
    expect(describeToolCall('web_fetch', { url: 'bad' }, true).label).toBe('Reading bad')
    expect(describeToolCall('get_current_datetime', {}, false).label).toBe('Checked the date and time')
    expect(describeToolCall('other', {}, true).label).toBe('Calling other')
  })
})

describe('<ToolCallCard>', () => {
  it('shows a running state', () => {
    const { container } = render(
      <ToolCallCard part={{ kind: 'tool', name: 'web_search', args: { query: 'x' }, pending: true }} />,
    )
    expect(container.querySelector('.tool-card')).toHaveAttribute('data-status', 'pending')
    expect(screen.getByLabelText('Running')).toBeInTheDocument()
  })

  it('expands to show arguments and the result', async () => {
    render(
      <ToolCallCard
        part={{ kind: 'tool', name: 'web_fetch', args: { url: 'https://example.com' }, result: 'Page text', pending: false }}
      />,
    )
    const toggle = screen.getByRole('button', { name: /Read example.com/ })
    expect(screen.queryByText('Page text')).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/"url": "https:\/\/example.com"/)).toBeInTheDocument()
    expect(screen.getByText('Page text')).toBeInTheDocument()
  })

  it('shows failures', () => {
    const { container } = render(
      <ToolCallCard part={{ kind: 'tool', name: 'web_fetch', args: {}, result: 'Error: nope', error: true, pending: false }} />,
    )
    expect(container.querySelector('.tool-card')).toHaveAttribute('data-status', 'error')
    expect(screen.getByLabelText('Failed')).toBeInTheDocument()
  })
})
