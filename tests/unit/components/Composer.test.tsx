// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Composer, type ComposerProps } from '@/components/Composer'

function Harness(props: Partial<ComposerProps>) {
  const [value, setValue] = useState('')
  return (
    <Composer value={value} onChange={setValue} onSubmit={vi.fn()} onStop={vi.fn()} streaming={false} {...props} />
  )
}

describe('<Composer>', () => {
  it('sends on Enter and inserts a newline on Shift+Enter', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    const box = screen.getByRole('textbox', { name: 'Message' })
    await userEvent.type(box, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(box).toHaveValue('line one\nline two')
    expect(onSubmit).not.toHaveBeenCalled()
    await userEvent.type(box, '{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('disables sending empty messages', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox'), '   {Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows a stop button while streaming', async () => {
    const onStop = vi.fn()
    const onSubmit = vi.fn()
    render(<Composer value="more" onChange={vi.fn()} onSubmit={onSubmit} onStop={onStop} streaming />)
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Stop generating' }))
    expect(onStop).toHaveBeenCalled()
    await userEvent.type(screen.getByRole('textbox'), '{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('renders toolbar controls and respects disabled', () => {
    render(<Harness disabled toolbar={<span>tools here</span>} />)
    expect(screen.getByText('tools here')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeDisabled()
  })
})
