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
  currentSessionStartedAt: string | null
  sessionCount: number
}

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

export function getTaskTimeStatus(task: { id: string; work_sessions?: WorkSession[] }): TaskTimeStatus {
  const open = getOpenSession(task)
  const recordedSeconds = computeRecordedSeconds(task)
  const liveSeconds = computeLiveSeconds(task)

  return {
    taskId: task.id,
    isRunning: !!open,
    isPaused: !open && getWorkSessions(task).length > 0 && liveSeconds === recordedSeconds,
    recordedSeconds,
    liveSeconds,
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
