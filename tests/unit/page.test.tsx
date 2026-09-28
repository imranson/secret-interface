import { beforeEach, describe, expect, it, vi } from 'vitest'
import Page from '@/app/page'
import { isSidebarCollapsed, SIDEBAR_COOKIE, sidebarCookie } from '@/lib/sidebar'

const jar = vi.hoisted(() => new Map<string, string>())
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  }),
}))

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

describe('Page', () => {
  it('renders the sidebar expanded by default', async () => {
    expect((await Page()).props.sidebarCollapsed).toBe(false)
  })

  it('restores a collapsed sidebar from the cookie so the first paint is right', async () => {
    jar.set(SIDEBAR_COOKIE, 'collapsed')
    expect((await Page()).props.sidebarCollapsed).toBe(true)
  })
})
