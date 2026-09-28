'use client'

import { useId, useState, type ReactNode } from 'react'
import type { AssistantPart } from '@/lib/display'
import { GET_CURRENT_DATETIME, WEB_FETCH, WEB_SEARCH } from '@/lib/tool-definitions'
import { AlertIcon, CheckIcon, ChevronIcon, ClockIcon, GlobeIcon, SearchIcon, ToolIcon } from './Icons'

type ToolPart = Extract<AssistantPart, { kind: 'tool' }>

const MAX_RESULT_PREVIEW = 6_000

function hostOf(url: unknown): string {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '')
  } catch {
    return String(url ?? 'a page')
  }
}

export function describeToolCall(name: string, args: Record<string, unknown>, pending: boolean): { icon: ReactNode; label: string } {
  switch (name) {
    case WEB_SEARCH:
      return {
        icon: <SearchIcon />,
        label: `${pending ? 'Searching the web for' : 'Searched the web for'} “${String(args.query ?? '')}”`,
      }
    case WEB_FETCH:
      return { icon: <GlobeIcon />, label: `${pending ? 'Reading' : 'Read'} ${hostOf(args.url)}` }
    case GET_CURRENT_DATETIME:
      return { icon: <ClockIcon />, label: pending ? 'Checking the date and time' : 'Checked the date and time' }
    default:
      return { icon: <ToolIcon />, label: `${pending ? 'Calling' : 'Called'} ${name}` }
  }
}

export function ToolCallCard({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const { icon, label } = describeToolCall(part.name, part.args, part.pending)
  const status = part.pending ? 'pending' : part.error ? 'error' : part.result === undefined ? 'unknown' : 'done'
  const result = part.result ?? ''

  return (
    <div className="tool-card" data-status={status}>
      <button
        type="button"
        className="tool-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="tool-icon">{icon}</span>
        <span className="tool-label">{label}</span>
        <span className="tool-status" aria-label={status === 'pending' ? 'Running' : status === 'error' ? 'Failed' : 'Done'}>
          {status === 'pending' ? <span className="spinner" /> : status === 'error' ? <AlertIcon /> : <CheckIcon />}
        </span>
        <ChevronIcon className="chevron" />
      </button>
      {open && (
        <div id={bodyId} className="tool-body">
          <div className="tool-section-label">Arguments</div>
          <pre>{JSON.stringify(part.args, null, 2)}</pre>
          <div className="tool-section-label">Result</div>
          <pre>
            {part.pending
              ? 'Waiting for result…'
              : result.length > MAX_RESULT_PREVIEW
                ? `${result.slice(0, MAX_RESULT_PREVIEW)}\n… (${result.length - MAX_RESULT_PREVIEW} more characters)`
                : result || '(empty)'}
          </pre>
        </div>
      )}
    </div>
  )
}
