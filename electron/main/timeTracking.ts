import { v4 as uuidv4 } from 'uuid'

export type PauseReason = 'user' | 'snooze' | 'break' | 'task_switch' | 'complete' | 'system'

export interface WorkSession {
  id: string
  started_at: string
  ended_at?: string | null
  pause_reason?: PauseReason
}

export interface TaskTimeStatus {
  taskId: string
  isRunning: boolean
  isPaused: boolean
  recordedSeconds: number
  liveSeconds: number
  breakSeconds: number
  pauseSeconds: number
  currentSessionStartedAt: string | null
  sessionCount: number
}

const BREAK_PAUSE_REASONS: PauseReason[] = ['break', 'user', 'snooze']
const PAUSE_REASONS: PauseReason[] = ['task_switch', 'system']

function parseMs(iso: string): number {
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function sessionDurationSeconds(session: WorkSession, nowMs = Date.now()): number {
  const start = parseMs(session.started_at)
  if (!start) return 0
  const end = session.ended_at ? parseMs(session.ended_at) : nowMs
  return Math.max(0, Math.floor((end - start) / 1000))
}

export function getWorkSessions(task: { work_sessions?: WorkSession[] }): WorkSession[] {
  return Array.isArray(task.work_sessions) ? task.work_sessions : []
}

export function getOpenSession(task: { work_sessions?: WorkSession[] }): WorkSession | null {
  return getWorkSessions(task).find((s) => !s.ended_at) ?? null
}

/** Sum of all sessions (open session counted to now). */
export function computeLiveSeconds(task: { work_sessions?: WorkSession[] }, nowMs = Date.now()): number {
  return getWorkSessions(task).reduce((sum, s) => sum + sessionDurationSeconds(s, nowMs), 0)
}

export function computeRecordedSeconds(task: { work_sessions?: WorkSession[] }): number {
  return getWorkSessions(task)
    .filter((s) => !!s.ended_at)
    .reduce((sum, s) => sum + sessionDurationSeconds(s), 0)
}

/** Gaps between work sessions when the previous pause was a break (incl. ongoing break). */
export function computeBreakSeconds(
  task: { work_sessions?: WorkSession[] },
  nowMs = Date.now()
): number {
  const sessions = [...getWorkSessions(task)].sort(
    (a, b) => parseMs(a.started_at) - parseMs(b.started_at)
  )
  let total = 0

  for (let i = 1; i < sessions.length; i++) {
    const prev = sessions[i - 1]
    const curr = sessions[i]
    if (!prev.ended_at) continue
    const reason = prev.pause_reason ?? 'user'
    if (!BREAK_PAUSE_REASONS.includes(reason)) continue
    const gapMs = parseMs(curr.started_at) - parseMs(prev.ended_at)
    if (gapMs > 0) total += Math.floor(gapMs / 1000)
  }

  const open = getOpenSession(task)
  if (!open && sessions.length > 0) {
    const last = sessions[sessions.length - 1]
    if (last.ended_at) {
      const reason = last.pause_reason ?? 'user'
      if (BREAK_PAUSE_REASONS.includes(reason)) {
        total += Math.max(0, Math.floor((nowMs - parseMs(last.ended_at)) / 1000))
      }
    }
  }

  return total
}

/** Gaps between work sessions when paused (task_switch, system) - excluding breaks. */
export function computePauseSeconds(
  task: { work_sessions?: WorkSession[] },
  nowMs = Date.now()
): number {
  const sessions = [...getWorkSessions(task)].sort(
    (a, b) => parseMs(a.started_at) - parseMs(b.started_at)
  )
  let total = 0

  for (let i = 1; i < sessions.length; i++) {
    const prev = sessions[i - 1]
    const curr = sessions[i]
    if (!prev.ended_at) continue
    const reason = prev.pause_reason ?? 'user'
    if (!PAUSE_REASONS.includes(reason)) continue
    const gapMs = parseMs(curr.started_at) - parseMs(prev.ended_at)
    if (gapMs > 0) total += Math.floor(gapMs / 1000)
  }

  const open = getOpenSession(task)
  if (!open && sessions.length > 0) {
    const last = sessions[sessions.length - 1]
    if (last.ended_at) {
      const reason = last.pause_reason ?? 'user'
      if (PAUSE_REASONS.includes(reason)) {
        total += Math.max(0, Math.floor((nowMs - parseMs(last.ended_at)) / 1000))
      }
    }
  }

  return total
}

export function getTaskTimeStatus(
  task: { id: string; work_sessions?: WorkSession[] },
  nowMs = Date.now()
): TaskTimeStatus {
  const open = getOpenSession(task)
  const recordedSeconds = computeRecordedSeconds(task)
  const liveSeconds = computeLiveSeconds(task, nowMs)
  const breakSeconds = computeBreakSeconds(task, nowMs)
  const pauseSeconds = computePauseSeconds(task, nowMs)

  return {
    taskId: task.id,
    isRunning: !!open,
    isPaused: !open && getWorkSessions(task).length > 0 && liveSeconds === recordedSeconds,
    recordedSeconds,
    liveSeconds,
    breakSeconds,
    pauseSeconds,
    currentSessionStartedAt: open?.started_at ?? null,
    sessionCount: getWorkSessions(task).length
  }
}

function closeOpenSession(
  sessions: WorkSession[],
  endedAt: string,
  reason: PauseReason
): WorkSession[] {
  return sessions.map((s) =>
    s.ended_at ? s : { ...s, ended_at: endedAt, pause_reason: reason }
  )
}

export function startWorkSession(
  task: Record<string, unknown>,
  now = new Date()
): Record<string, unknown> {
  const iso = now.toISOString()
  let sessions = getWorkSessions(task as { work_sessions?: WorkSession[] })

  if (getOpenSession(task as { work_sessions?: WorkSession[] })) {
    return task
  }

  sessions = [
    ...sessions,
    {
      id: uuidv4(),
      started_at: iso,
      ended_at: null
    }
  ]

  const liveSeconds = computeLiveSeconds({ work_sessions: sessions }, now.getTime())

  return {
    ...task,
    status: 'in_progress',
    start_time: task.start_time || iso,
    end_time: undefined,
    work_sessions: sessions,
    recorded_seconds: computeRecordedSeconds({ work_sessions: sessions }),
    actual_minutes: Math.round(liveSeconds / 60)
  }
}

export function pauseWorkSession(
  task: Record<string, unknown>,
  reason: PauseReason = 'user',
  now = new Date()
): Record<string, unknown> {
  const iso = now.toISOString()
  let sessions = getWorkSessions(task as { work_sessions?: WorkSession[] })

  if (!getOpenSession(task as { work_sessions?: WorkSession[] })) {
    return task
  }

  sessions = closeOpenSession(sessions, iso, reason)
  const recordedSeconds = computeRecordedSeconds({ work_sessions: sessions })

  return {
    ...task,
    work_sessions: sessions,
    recorded_seconds: recordedSeconds,
    actual_minutes: Math.round(recordedSeconds / 60)
  }
}

export function resumeWorkSession(
  task: Record<string, unknown>,
  now = new Date()
): Record<string, unknown> {
  if ((task.status as string) === 'completed') {
    return task
  }
  return startWorkSession(task, now)
}

export function completeWorkSession(
  task: Record<string, unknown>,
  now = new Date()
): Record<string, unknown> {
  const iso = now.toISOString()
  let sessions = getWorkSessions(task as { work_sessions?: WorkSession[] })
  sessions = closeOpenSession(sessions, iso, 'complete')

  const recordedSeconds = computeRecordedSeconds({ work_sessions: sessions })

  return {
    ...task,
    status: 'completed',
    end_time: iso,
    work_sessions: sessions,
    recorded_seconds: recordedSeconds,
    actual_minutes: Math.round(recordedSeconds / 60)
  }
}

/** Pause any open session on another task when switching focus. */
export function pauseOpenSessionIfAny(
  task: Record<string, unknown>,
  reason: PauseReason,
  now = new Date()
): Record<string, unknown> {
  if (!getOpenSession(task as { work_sessions?: WorkSession[] })) {
    return task
  }
  return pauseWorkSession(task, reason, now)
}

/**
 * Credit work done while the app was closed after a break-pause on quit.
 */
export function allocateOfflineWorkTime(
  task: Record<string, unknown>,
  offlineStartIso: string,
  workMinutes: number,
  now = new Date()
): Record<string, unknown> {
  const workMins = Math.max(0, Math.round(workMinutes))
  let sessions = [...getWorkSessions(task as { work_sessions?: WorkSession[] })]

  if (workMins > 0) {
    const startMs = parseMs(offlineStartIso)
    const endMs = startMs + workMins * 60 * 1000
    if (endMs <= now.getTime()) {
      sessions.push({
        id: uuidv4(),
        started_at: offlineStartIso,
        ended_at: new Date(endMs).toISOString(),
        pause_reason: 'system'
      })
      sessions.sort((a, b) => parseMs(a.started_at) - parseMs(b.started_at))
    }
  }

  const liveSeconds = computeLiveSeconds({ work_sessions: sessions }, now.getTime())
  return {
    ...task,
    work_sessions: sessions,
    recorded_seconds: computeRecordedSeconds({ work_sessions: sessions }),
    actual_minutes: Math.round(liveSeconds / 60)
  }
}
