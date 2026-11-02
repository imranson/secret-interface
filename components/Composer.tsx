'use client'

import { useLayoutEffect, type ReactNode, type RefObject } from 'react'
import { RepeatIcon, SendIcon, StopIcon } from './Icons'

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
  /** Schedule settings. While shown, submitting schedules the text instead of sending it. */
  schedulePicker?: ReactNode
  /** False while the schedule settings are incomplete. */
  scheduleReady?: boolean
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
  schedulePicker,
  scheduleReady = true,
}: ComposerProps) {
  useLayoutEffect(() => {
    const el = inputRef?.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`
  }, [value, inputRef])

  const canSend = !streaming && !disabled && value.trim().length > 0 && (!schedulePicker || scheduleReady)

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
      {schedulePicker}
      <div className="composer-bar">
        <div className="composer-tools">{toolbar}</div>
        {streaming ? (
          <button type="button" className="send-button is-stop" onClick={onStop} aria-label="Stop generating">
            <StopIcon />
          </button>
        ) : (
          <button
            type="submit"
            className="send-button"
            disabled={!canSend}
            aria-label={schedulePicker ? 'Schedule' : 'Send message'}
          >
            {schedulePicker ? <RepeatIcon /> : <SendIcon />}
          </button>
        )}
      </div>
    </form>
  )
}
