import { listModels } from '@/lib/models'
import { isBackend } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const backend = new URL(request.url).searchParams.get('backend') ?? 'cloud'
  if (!isBackend(backend)) return Response.json({ error: 'Invalid backend' }, { status: 400 })
  return Response.json(await listModels(backend))
}
