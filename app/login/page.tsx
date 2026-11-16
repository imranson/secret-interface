import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthForm } from '@/components/AuthForm'
import { SESSION_COOKIE, userForToken } from '@/lib/auth'
import { getConfig } from '@/lib/config'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Sign in · secret interface' }

export default async function LoginPage() {
  const cookieStore = await cookies()
  if (await userForToken(cookieStore.get(SESSION_COOKIE)?.value)) redirect('/')
  return <AuthForm needsCode={Boolean(getConfig().registrationCode)} />
}
