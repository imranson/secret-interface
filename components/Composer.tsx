'use client'

import { useLayoutEffect, type ReactNode, type RefObject } from 'react'
import { SendIcon, StopIcon } from './Icons'

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  streaming: boolean
  disabled?: boolean
  placeholder?: string
  inputRef?: RefObject<HTMLTextAreaElement | null>
  /** Controls shown under the text box (model, thinking, context meter). */
  toolbar?: ReactNode
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  disabled,
  placeholder = 'Message…',
  inputRef,
  toolbar,
}: ComposerProps) {
  useLayoutEffect(() => {
    const el = inputRef?.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`
  }, [value, inputRef])

  const canSend = !streaming && !disabled && value.trim().length > 0

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSend) onSubmit()
      }}
    >
      <textarea
        ref={inputRef}
        aria-label="Message"
        placeholder={placeholder}
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (canSend) onSubmit()
          }
        }}
      />
      <div className="composer-bar">
        <div className="composer-tools">{toolbar}</div>
        {streaming ? (
          <button type="button" className="send-button is-stop" onClick={onStop} aria-label="Stop generating">
            <StopIcon />
          </button>
        ) : (
          <button type="submit" className="send-button" disabled={!canSend} aria-label="Send message">
            <SendIcon />
          </button>
        )}
      </div>
    </form>
  )
}
