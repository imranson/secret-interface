import { POST as chatPOST } from '@/app/api/chat/route'
import { GET as conversationGET, PATCH as conversationPATCH } from '@/app/api/conversations/[id]/route'
import { GET as conversationsGET } from '@/app/api/conversations/route'
import { GET as modelInfoGET } from '@/app/api/model-info/route'
import { GET as modelsGET } from '@/app/api/models/route'

type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> | Response

function route(method: string, pathname: string): { handler: Handler; id?: string } | null {
  if (pathname === '/api/chat' && method === 'POST') return { handler: chatPOST }
  if (pathname === '/api/conversations' && method === 'GET') return { handler: conversationsGET }
  if (pathname === '/api/models' && method === 'GET') return { handler: modelsGET }
  if (pathname === '/api/model-info' && method === 'GET') return { handler: modelInfoGET }
  const match = pathname.match(/^\/api\/conversations\/([^/]+)$/)
  if (match) {
    const id = decodeURIComponent(match[1])
    if (method === 'GET') return { handler: conversationGET, id }
    if (method === 'PATCH') return { handler: conversationPATCH, id }
  }
  return null
}

/**
 * A `fetch` replacement that dispatches browser requests straight to the Next.js route handlers,
 * so UI tests exercise the real server code in-process. Aborting the request errors the response
 * stream and cancels it server-side, like a real disconnect.
 */
export async function appFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input), 'http://localhost')
  const method = (init.method ?? 'GET').toUpperCase()
  const { signal, ...rest } = init
  const match = route(method, url.pathname)
  if (!match) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })

  const response = await match.handler(new Request(url, rest as RequestInit), {
    params: Promise.resolve({ id: match.id ?? '' }),
  })
  if (!signal || !response.body) return response

  const reader = response.body.getReader()
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined
  const onAbort = () => {
    const error = new Error('The operation was aborted.')
    error.name = 'AbortError'
    controllerRef?.error(error)
    reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', onAbort, { once: true })
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) controller.close()
        else controller.enqueue(value)
      } catch (error) {
        if (!signal.aborted) controller.error(error)
      }
    },
    cancel() {
      return reader.cancel()
    },
  })
  return new Response(body, { status: response.status, headers: response.headers })
}
