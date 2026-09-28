'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronIcon, SparkIcon } from './Icons'

/** Collapsible reasoning trace: open while the model is thinking, collapsed once it moves on. */
export function ThinkingBlock({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(active)
  const wasActive = useRef(active)
  const bodyRef = useRef<HTMLDivElement>(null)
  const bodyId = useId()

  useEffect(() => {
    if (active !== wasActive.current) setOpen(active)
    wasActive.current = active
  }, [active])

  useEffect(() => {
    if (active && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [text, active])

  return (
    <div className="thinking" data-active={active || undefined}>
      <button
        type="button"
        className="thinking-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <SparkIcon className="thinking-icon" />
        <span>{active ? 'Thinking…' : 'Thought process'}</span>
        <ChevronIcon className="chevron" />
      </button>
      {open && (
        <div id={bodyId} ref={bodyRef} className="thinking-body">
          {text}
        </div>
      )}
    </div>
  )
}
