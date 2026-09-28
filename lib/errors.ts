/** Turns SDK/network errors into a message that is useful in the chat UI. */
export function describeError(error: unknown): string {
  const err = error as { message?: string; status_code?: number; name?: string } | undefined
  const message = err?.message?.trim() || 'Unknown error'
  switch (err?.status_code) {
    case 401:
    case 403:
      return `Ollama rejected the request (${err.status_code}): ${message}. Check OLLAMA_API_KEY in .env.local.`
    case 404:
      return `Not found (404): ${message}. Check the model name.`
    case 429:
      return `Rate limited by Ollama (429): ${message}. Try again shortly.`
    default:
      return err?.status_code ? `Ollama error (${err.status_code}): ${message}` : message
  }
}
