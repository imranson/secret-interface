/**
 * Remembers whether the sidebar is collapsed on wide screens. A cookie rather than localStorage so the
 * server can render the right layout straight away instead of snapping shut after hydration.
 */
export const SIDEBAR_COOKIE = 'secret-interface.sidebar'

export function sidebarCookie(collapsed: boolean): string {
  return `${SIDEBAR_COOKIE}=${collapsed ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`
}

export function isSidebarCollapsed(value: string | undefined): boolean {
  return value === 'collapsed'
}
