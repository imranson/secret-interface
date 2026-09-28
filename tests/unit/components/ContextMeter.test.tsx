// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContextMeter } from '@/components/ContextMeter'

describe('<ContextMeter>', () => {
  it('shows an approximate token count against the window', () => {
    render(<ContextMeter used={12_345} total={128_000} />)
    const meter = screen.getByRole('meter', { name: 'Context window usage (estimate)' })
    expect(meter).toHaveAttribute('aria-valuenow', '12345')
    expect(meter).toHaveAttribute('aria-valuemax', '128000')
    expect(meter).toHaveAttribute('aria-valuetext', 'About 12k of 128k tokens (10%)')
    expect(screen.getByText('~12k / 128k')).toBeInTheDocument()
  })

  it.each([
    [10_000, 'ok'],
    [80_000, 'warn'],
    [95_000, 'critical'],
    [300_000, 'critical'],
  ])('uses level for %i of 100k tokens', (used, level) => {
    const { container } = render(<ContextMeter used={used} total={100_000} />)
    expect(container.querySelector('.context-meter')).toHaveAttribute('data-level', level)
    expect(Number.parseFloat((container.querySelector('.meter-fill') as HTMLElement).style.width)).toBeLessThanOrEqual(100)
  })

  it('mentions the last reported usage in its tooltip', () => {
    const { container } = render(
      <ContextMeter used={100} total={1000} lastUsage={{ prompt_tokens: 90, completion_tokens: 12 }} />,
    )
    expect(container.querySelector('.context-meter')?.getAttribute('title')).toContain('90 prompt + 12 output tokens')
  })
})
