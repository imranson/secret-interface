import { describe, expect, it } from 'vitest'
import { encodeNdjson, parseNdjson } from '@/lib/ndjson'

function streamOf(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  })
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterable) out.push(item)
  return out
}

describe('ndjson', () => {
  it('round-trips values', async () => {
    const values = [{ a: 1 }, { b: 'two' }, [3]]
    const parsed = await collect(parseNdjson(streamOf(values.map(encodeNdjson))))
    expect(parsed).toEqual(values)
  })

  it('handles lines and multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('{"text":"héllo ✨"}\n{"text":"wörld"}\n')
    const parts = [bytes.slice(0, 5), bytes.slice(5, 12), bytes.slice(12, 17), bytes.slice(17)]
    expect(await collect(parseNdjson(streamOf(parts)))).toEqual([{ text: 'héllo ✨' }, { text: 'wörld' }])
  })

  it('parses a final line without a trailing newline and skips blank lines', async () => {
    const bytes = new TextEncoder().encode('{"a":1}\n\n{"b":2}')
    expect(await collect(parseNdjson(streamOf([bytes])))).toEqual([{ a: 1 }, { b: 2 }])
  })
})
