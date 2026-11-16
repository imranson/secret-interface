import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatLayout from '@/app/(chat)/layout'
import LoginPage from '@/app/login/page'
import { SESSION_COOKIE } from '@/lib/auth'
import { isSidebarCollapsed, SIDEBAR_COOKIE, sidebarCookie } from '@/lib/sidebar'
import { signIn } from '../helpers/auth'

const jar = vi.hoisted(() => new Map<string, string>())
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  }),
}))
// Like Next.js, redirect() throws to stop rendering.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))

/** Puts a signed-in session for `username` in the cookie jar. */
async function signInBrowser(username = 'ada') {
  const { cookie } = await signIn(username)
  jar.set(SESSION_COOKIE, cookie.slice(cookie.indexOf('=') + 1))
}

beforeEach(() => {
  jar.clear()
})

describe('sidebar cookie', () => {
  it('round-trips the collapsed state', () => {
    for (const collapsed of [true, false]) {
      const [pair] = sidebarCookie(collapsed).split(';')
      const [name, value] = pair.split('=')
      expect(name).toBe(SIDEBAR_COOKIE)
      expect(isSidebarCollapsed(value)).toBe(collapsed)
    }
  })

  it('lasts a year across the whole site', () => {
    expect(sidebarCookie(true)).toMatch(/; path=\/; max-age=31536000; samesite=lax$/)
  })

  it('treats a missing or unknown value as expanded', () => {
    expect(isSidebarCollapsed(undefined)).toBe(false)
    expect(isSidebarCollapsed('nonsense')).toBe(false)
  })
})

describe('ChatLayout', () => {
  it('sends a visitor who is not signed in to the sign-in page', async () => {
    await expect(ChatLayout()).rejects.toThrow('redirect:/login')
    jar.set(SESSION_COOKIE, 'not-a-session')
    await expect(ChatLayout()).rejects.toThrow('redirect:/login')
  })

  it('renders the chat for the signed-in user, sidebar expanded by default', async () => {
    await signInBrowser('ada')
    const layout = await ChatLayout()
    expect(layout.props).toMatchObject({ username: 'ada', sidebarCollapsed: false })
  })

  it('restores a collapsed sidebar from the cookie so the first paint is right', async () => {
    await signInBrowser()
    jar.set(SIDEBAR_COOKIE, 'collapsed')
    expect((await ChatLayout()).props.sidebarCollapsed).toBe(true)
  })
})

describe('LoginPage', () => {
  it('shows the form, asking for an invite code only when one is set', async () => {
    expect((await LoginPage()).props).toEqual({ needsCode: false })
    vi.stubEnv('REGISTRATION_CODE', 'friends')
    expect((await LoginPage()).props).toEqual({ needsCode: true })
  })

  it('sends a signed-in user to the chat', async () => {
    await signInBrowser()
    await expect(LoginPage()).rejects.toThrow('redirect:/')
  })
})
