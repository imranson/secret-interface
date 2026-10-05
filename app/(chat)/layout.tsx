import { cookies } from 'next/headers'
import { ChatApp } from '@/components/ChatApp'
import { getConfig } from '@/lib/config'
import { isSidebarCollapsed, SIDEBAR_COOKIE } from '@/lib/sidebar'

// Reads configuration from the environment at request time.
export const dynamic = 'force-dynamic'

// The chat UI lives in the layout rather than the pages so it stays mounted (sidebar, streaming reply) as the URL
// moves between `/` and `/c/<id>`. It reads the conversation id from the URL itself, so the pages render nothing.
export default async function ChatLayout() {
  const config = getConfig()
  const cookieStore = await cookies()
  return (
    <ChatApp
      defaultModel={config.defaultModel}
      defaultContextWindow={config.contextWindow}
      systemPrompt={config.systemPrompt}
      sidebarCollapsed={isSidebarCollapsed(cookieStore.get(SIDEBAR_COOKIE)?.value)}
    />
  )
}
