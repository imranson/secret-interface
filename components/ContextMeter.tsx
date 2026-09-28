import { formatTokenCount } from '@/lib/tokens'

export interface ContextMeterProps {
  used: number
  total: number
  /** Token counts Ollama reported for the most recent model call, if any. */
  lastUsage?: { prompt_tokens: number; completion_tokens: number } | null
}

export function ContextMeter({ used, total, lastUsage }: ContextMeterProps) {
  const ratio = total > 0 ? used / total : 0
  const percent = Math.min(100, Math.round(ratio * 100))
  const level = ratio >= 0.9 ? 'critical' : ratio >= 0.75 ? 'warn' : 'ok'
  const title = [
    `Rough estimate (~4 characters per token): ${used.toLocaleString()} of ${total.toLocaleString()} tokens (${percent}%).`,
    lastUsage
      ? `Last model call reported ${lastUsage.prompt_tokens.toLocaleString()} prompt + ${lastUsage.completion_tokens.toLocaleString()} output tokens.`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div className="context-meter" data-level={level} title={title}>
      <div
        className="meter-track"
        role="meter"
        aria-label="Context window usage (estimate)"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.min(used, total)}
        aria-valuetext={`About ${formatTokenCount(used)} of ${formatTokenCount(total)} tokens (${percent}%)`}
      >
        <span className="meter-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="meter-text">
        ~{formatTokenCount(used)} / {formatTokenCount(total)}
      </span>
    </div>
  )
}
