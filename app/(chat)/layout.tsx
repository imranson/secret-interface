import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ChatApp } from '@/components/ChatApp'
import { LOGIN_PATH, SESSION_COOKIE, userForToken } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { isSidebarCollapsed, SIDEBAR_COOKIE } from '@/lib/sidebar'

// Reads configuration from the environment at request time.
export const dynamic = 'force-dynamic'

// The chat UI lives in the layout rather than the pages so it stays mounted (sidebar, streaming reply) as the URL
// moves between `/` and `/c/<id>`. It reads the conversation id from the URL itself, so the pages render nothing.
export default async function ChatLayout() {
  const cookieStore = await cookies()
  const user = await userForToken(cookieStore.get(SESSION_COOKIE)?.value)
  if (!user) redirect(LOGIN_PATH)
  const config = getConfig()
  return (
    <ChatApp
      username={user.username}
      defaultModel={config.defaultModel}
      defaultContextWindow={config.contextWindow}
      systemPrompt={config.systemPrompt}
      sidebarCollapsed={isSidebarCollapsed(cookieStore.get(SIDEBAR_COOKIE)?.value)}
    />
  )
}
