import { tickSchedules } from '@/lib/scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Runs any due schedules now (also a safety net if the background interval is unavailable). */
export async function POST() {
  const started = await tickSchedules({ await: true })
  return Response.json({ started })
}
