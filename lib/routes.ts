/** Each conversation lives at `/c/<id>`; `/` is a new, unsaved conversation. */
export function conversationPath(id: string): string {
  return `/c/${encodeURIComponent(id)}`
}

export function conversationIdFromPath(pathname: string | null): string | null {
  const match = /^\/c\/([^/]+)\/?$/.exec(pathname ?? '')
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}
