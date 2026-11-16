import { getUserStore, SESSION_DAYS, type User } from './users'

export const SESSION_COOKIE = 'secret-interface.session'
export const LOGIN_PATH = '/login'

/** Reads one cookie from a Cookie header. */
export function readCookie(header: string | null, name: string): string | null {
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=')
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim()
      try {
        return decodeURIComponent(value)
      } catch {
        return value
      }
    }
  }
  return null
}

/** The user a session token belongs to; null when there is no token or the session has ended. */
export async function userForToken(token: string | null | undefined): Promise<User | null> {
  return token ? getUserStore().userForSession(token) : null
}

/** The signed-in user making `request`, or null. */
export function requestUser(request: Request): Promise<User | null> {
  return userForToken(readCookie(request.headers.get('cookie'), SESSION_COOKIE))
}

export function unauthorized(): Response {
  return Response.json({ error: 'Sign in to continue.' }, { status: 401 })
}

/** Secure cookies need HTTPS. Railway and similar hosts end TLS in front of the app and say so in X-Forwarded-Proto. */
function isHttps(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim()
  return (forwarded ?? new URL(request.url).protocol.replace(':', '')) === 'https'
}

function cookie(request: Request, value: string, maxAge: number): string {
  const parts = [`${SESSION_COOKIE}=${value}`, 'Path=/', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax']
  if (isHttps(request)) parts.push('Secure')
  return parts.join('; ')
}

export function sessionCookie(request: Request, token: string): string {
  return cookie(request, token, SESSION_DAYS * 24 * 60 * 60)
}

export function clearedSessionCookie(request: Request): string {
  return cookie(request, '', 0)
}
