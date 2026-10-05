import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'

/**
 * A stand-in for the App Router in jsdom, for `vi.mock('next/navigation')` and `vi.mock('next/link')`. Like Next.js,
 * it keeps `usePathname` in sync with the History API, including direct `pushState`/`replaceState` calls.
 */

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

for (const method of ['pushState', 'replaceState'] as const) {
  const original = window.history[method].bind(window.history)
  window.history[method] = (...args: Parameters<History['pushState']>) => {
    original(...args)
    notify()
  }
}
window.addEventListener('popstate', notify)

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const router = {
  push: (href: string) => window.history.pushState(null, '', href),
  replace: (href: string) => window.history.replaceState(null, '', href),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  refresh: () => {},
  prefetch: () => {},
}

export function useRouter() {
  return router
}

export function usePathname() {
  return useSyncExternalStore(subscribe, () => window.location.pathname)
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string
  prefetch?: boolean | 'auto' | null
  replace?: boolean
  onNavigate?: (event: { preventDefault: () => void }) => void
  children?: ReactNode
}

export function Link({ href, prefetch: _prefetch, replace, onNavigate, onClick, children, ...rest }: LinkProps) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    // Modified clicks open a new tab: leave them to the browser, as Next.js does.
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    let cancelled = false
    onNavigate?.({ preventDefault: () => (cancelled = true) })
    if (!cancelled) (replace ? router.replace : router.push)(href)
  }
  return (
    <a href={href} onClick={click} {...rest}>
      {children}
    </a>
  )
}
