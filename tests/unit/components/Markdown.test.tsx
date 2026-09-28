// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Markdown } from '@/components/Markdown'

describe('<Markdown>', () => {
  it('renders GitHub-flavoured Markdown inside the serif prose container', () => {
    const text = [
      '# Title',
      '',
      'Some **bold** and ~~struck~~ text with https://example.com autolinked.',
      '',
      '| Name | Qty |',
      '| ---- | --: |',
      '| Tea  | 2   |',
      '',
      '- [x] done',
      '- [ ] todo',
      '',
      'Footnote here[^1].',
      '',
      '[^1]: The note.',
    ].join('\n')
    const { container } = render(<Markdown text={text} />)

    const prose = container.querySelector('.prose')
    expect(prose).not.toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument()
    expect(container.querySelector('strong')).toHaveTextContent('bold')
    expect(container.querySelector('del')).toHaveTextContent('struck')
    expect(screen.getByRole('link', { name: 'https://example.com' })).toHaveAttribute('href', 'https://example.com')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Qty' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Tea' })).toBeInTheDocument()
    expect(container.querySelector('.table-wrap > table')).not.toBeNull()
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, false])
    expect(container.querySelector('section.footnotes, [data-footnotes]')).not.toBeNull()
  })

  it('opens links in a new tab safely', () => {
    render(<Markdown text="[Ollama](https://ollama.com)" />)
    const link = screen.getByRole('link', { name: 'Ollama' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('does not render raw HTML', () => {
    const { container } = render(<Markdown text={'<script>alert(1)</script><b>hi</b>'} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
  })

  it('renders fenced code with a copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { container } = render(<Markdown text={'```ts\nconst x = 1\n```'} />)
    expect(container.querySelector('pre code')).toHaveTextContent('const x = 1')
    await userEvent.click(screen.getByRole('button', { name: 'Copy code' }))
    expect(writeText).toHaveBeenCalledWith('const x = 1\n')
  })
})
