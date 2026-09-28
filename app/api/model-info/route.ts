import { getModelInfo } from '@/lib/models'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return Response.json(await getModelInfo(new URL(request.url).searchParams.get('model')))
}
