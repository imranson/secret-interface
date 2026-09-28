import { describe, expect, it } from 'vitest'
import { describeError } from '@/lib/errors'
import { HttpError } from '../helpers/fake-ollama'

describe('describeError', () => {
  it('adds guidance for common HTTP failures', () => {
    expect(describeError(new HttpError('unauthorized', 401))).toBe(
      'Ollama rejected the request (401): unauthorized. Check OLLAMA_API_KEY in .env.local.',
    )
    expect(describeError(new HttpError('model "x" not found', 404))).toContain('Check the model name')
    expect(describeError(new HttpError('slow down', 429))).toContain('Rate limited')
    expect(describeError(new HttpError('boom', 500))).toBe('Ollama error (500): boom')
  })

  it('passes plain errors through', () => {
    expect(describeError(new Error('fetch failed'))).toBe('fetch failed')
    expect(describeError(undefined)).toBe('Unknown error')
  })
})
