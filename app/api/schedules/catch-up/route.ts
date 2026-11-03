import { catchUpSchedules } from '@/lib/scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Sent by the browser when the app opens: starts every schedule that isn't up to date. The runs continue after this response. */
export async function POST() {
  return Response.json({ started: await catchUpSchedules() })
}
