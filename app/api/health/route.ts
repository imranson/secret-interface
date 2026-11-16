import { getDb } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** For the host's health check: the server is up and its database answers (creating the tables on first deploy). */
export async function GET() {
  try {
    await getDb().query('SELECT 1')
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Health check failed:', error)
    return Response.json({ ok: false }, { status: 503 })
  }
}
