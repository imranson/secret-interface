import { listModels } from '@/lib/models'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(await listModels())
}
