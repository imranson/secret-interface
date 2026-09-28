import { cookies } from 'next/headers'
import { ChatApp } from '@/components/ChatApp'
import { getConfig } from '@/lib/config'
import { isSidebarCollapsed, SIDEBAR_COOKIE } from '@/lib/sidebar'

// Reads configuration from the environment at request time.
export const dynamic = 'force-dynamic'

export default async function Page() {
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
