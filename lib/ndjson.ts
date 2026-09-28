const encoder = new TextEncoder()

export function encodeNdjson(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value)}\n`)
}

/** Parses a newline-delimited JSON byte stream, tolerating chunks split mid-line or mid-character. */
export async function* parseNdjson<T>(stream: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as T
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) yield JSON.parse(buffer) as T
  } finally {
    reader.releaseLock()
  }
}
