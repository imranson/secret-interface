'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createSchedule, deleteSchedule, listSchedules, runSchedule, updateSchedule } from '@/lib/api-client'
import type { CreateScheduleBody, ScheduleView } from '@/lib/types'

/** Runs happen on the server with no stream attached, so the browser finds out about them by asking. */
const IDLE_POLL_MS = 15_000
const RUNNING_POLL_MS = 2_000

/**
 * The schedule list, kept current while the tab is visible. `onRunFinished` is called whenever a schedule finishes a
 * run, however it was started.
 */
export function useSchedules(onRunFinished: (schedule: ScheduleView) => void) {
  const [schedules, setSchedules] = useState<ScheduleView[]>([])
  const callback = useRef(onRunFinished)
  useEffect(() => {
    callback.current = onRunFinished
  })
  // The last finished run of each schedule. Unset until first seen, so loading the page doesn't report old runs.
  const lastRuns = useRef(new Map<string, string | null>())
  const wake = useRef<() => void>(() => {})

  const refresh = useCallback(async () => {
    const list = await listSchedules()
    const finished = list.filter((s) => {
      const seen = lastRuns.current.get(s.id)
      return seen !== undefined && seen !== s.lastRunAt
    })
    lastRuns.current = new Map(list.map((s) => [s.id, s.lastRunAt]))
    setSchedules(list)
    finished.forEach((s) => callback.current(s))
    return list
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const poll = async () => {
      clearTimeout(timer)
      const visible = document.visibilityState === 'visible'
      const list = visible ? await refresh().catch(() => null) : null
      if (stopped) return
      clearTimeout(timer)
      timer = setTimeout(poll, list?.some((s) => s.status === 'running') ? RUNNING_POLL_MS : IDLE_POLL_MS)
    }
    wake.current = poll
    poll()
    document.addEventListener('visibilitychange', poll)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [refresh])

  const replace = (updated: ScheduleView) => {
    setSchedules((list) => list.map((s) => (s.id === updated.id ? updated : s)))
  }

  const create = useCallback(async (body: CreateScheduleBody) => {
    const schedule = await createSchedule(body)
    await refresh()
    return schedule
  }, [refresh])

  const run = useCallback(async (id: string) => {
    replace(await runSchedule(id))
    wake.current()
  }, [])

  const setEnabled = useCallback(async (id: string, enabled: boolean) => {
    await updateSchedule(id, { enabled })
    await refresh()
  }, [refresh])

  const markRead = useCallback(async (id: string) => {
    replace(await updateSchedule(id, { unread: false }))
  }, [])

  const remove = useCallback(async (id: string) => {
    await deleteSchedule(id)
    setSchedules((list) => list.filter((s) => s.id !== id))
  }, [])

  return { schedules, create, run, setEnabled, markRead, remove }
}
