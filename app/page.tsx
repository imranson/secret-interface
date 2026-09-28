import { ChatApp } from '@/components/ChatApp'
import { getConfig } from '@/lib/config'

// Reads configuration from the environment at request time.
export const dynamic = 'force-dynamic'

export default function Page() {
  const config = getConfig()
  return (
    <ChatApp
      defaultModel={config.defaultModel}
      defaultContextWindow={config.contextWindow}
      systemPrompt={config.systemPrompt}
    />
  )
}
