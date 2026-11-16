import { requestUser, unauthorized } from '@/lib/auth'
import { getStore } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = await requestUser(request)
  if (!user) return unauthorized()
  const flag = new URL(request.url).searchParams.get('archived')
  const archived = flag === '1' || flag === 'true'
  return Response.json({ conversations: await getStore(user.id).list(archived) })
}
