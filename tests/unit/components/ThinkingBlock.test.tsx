// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ThinkingBlock } from '@/components/ThinkingBlock'

describe('<ThinkingBlock>', () => {
  it('is open while thinking and collapses when the model moves on', () => {
    const { rerender } = render(<ThinkingBlock text="Considering options" active />)
    expect(screen.getByRole('button', { name: /Thinking…/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Considering options')).toBeInTheDocument()

    rerender(<ThinkingBlock text="Considering options" active={false} />)
    expect(screen.getByRole('button', { name: /Thought process/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Considering options')).not.toBeInTheDocument()
  })

  it('can be toggled', async () => {
    render(<ThinkingBlock text="Earlier reasoning" active={false} />)
    await userEvent.click(screen.getByRole('button', { name: /Thought process/ }))
    expect(screen.getByText('Earlier reasoning')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Thought process/ }))
    expect(screen.queryByText('Earlier reasoning')).not.toBeInTheDocument()
  })
})
