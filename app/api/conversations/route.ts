import { getStore, missingDatabaseResponse } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const missing = missingDatabaseResponse()
  if (missing) return missing
  const flag = new URL(request.url).searchParams.get('archived')
  const archived = flag === '1' || flag === 'true'
  return Response.json({ conversations: await getStore().list(archived) })
}
