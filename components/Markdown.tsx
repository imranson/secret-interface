'use client'

import { memo, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CheckIcon, CopyIcon } from './Icons'

function CodeBlock(props: ComponentPropsWithoutRef<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ref.current?.textContent ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (e.g. insecure context).
    }
  }
  return (
    <div className="code-block">
      <button type="button" className="copy-button" onClick={copy} aria-label="Copy code">
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      <pre ref={ref} {...props} />
    </div>
  )
}

const remarkPlugins = [remarkGfm]

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  table: ({ node: _node, ...props }) => (
    <div className="table-wrap">
      <table {...props} />
    </div>
  ),
  pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
}

/** Renders assistant Markdown (GitHub-flavoured) in the serif reading typeface. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
