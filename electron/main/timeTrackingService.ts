import {
  completeWorkSession,
  computeLiveSeconds,
  computeRecordedSeconds,
  getOpenSession,
  getTaskTimeStatus,
  getWorkSessions,
  pauseOpenSessionIfAny,
  pauseWorkSession,
  resumeWorkSession,
  startWorkSession,
  type PauseReason,
  type TaskTimeStatus
} from './timeTracking'

type TaskRecord = Record<string, unknown> & { id: string }

export function materializeTaskTimeFields(task: TaskRecord, nowMs = Date.now()): TaskRecord {
  const liveSeconds = computeLiveSeconds(task, nowMs)
  return {
    ...task,
    recorded_seconds: computeRecordedSeconds(task),
    actual_minutes: Math.round(liveSeconds / 60)
  }
}

/** At most one open session app-wide; refresh denormalized totals. */
export function reconcileTasksTimeState(tasks: TaskRecord[]): TaskRecord[] {
  let openOwnerId: string | null = null

  return tasks.map((task) => {
    let next = materializeTaskTimeFields(task)
    const open = getOpenSession(next)

    if (!open) return next

    if (openOwnerId && openOwnerId !== task.id) {
      next = pauseWorkSession(next, 'system') as TaskRecord
      return materializeTaskTimeFields(next)
    }

    openOwnerId = task.id
    return next
  })
}

export function findTaskIndex(tasks: TaskRecord[], taskId: string): number {
  return tasks.findIndex((t) => t.id === taskId)
}

export function applyTaskUpdate(
  tasks: TaskRecord[],
  taskId: string,
  updater: (task: TaskRecord) => TaskRecord
): { tasks: TaskRecord[]; task: TaskRecord | null } {
  const index = findTaskIndex(tasks, taskId)
  if (index === -1) return { tasks, task: null }

  const updated = materializeTaskTimeFields({
    ...updater(tasks[index]),
    updated_at: new Date().toISOString()
  })

  const next = [...tasks]
  next[index] = updated
  return { tasks: next, task: updated }
}

export function pauseOtherRunningTasks(
  tasks: TaskRecord[],
  exceptTaskId: string,
  reason: PauseReason
): TaskRecord[] {
  return tasks.map((task) => {
    if (task.id === exceptTaskId) return task
    if (!getOpenSession(task)) return task
    return materializeTaskTimeFields(pauseOpenSessionIfAny(task, reason) as TaskRecord)
  })
}

export function startTaskWork(tasks: TaskRecord[], taskId: string): { tasks: TaskRecord[]; task: TaskRecord } {
  let next = pauseOtherRunningTasks(tasks, taskId, 'task_switch')

  const result = applyTaskUpdate(next, taskId, (task) => startWorkSession(task) as TaskRecord)
  if (!result.task) throw new Error('Task not found')

  return { tasks: result.tasks, task: result.task }
}

export function pauseTaskWork(
  tasks: TaskRecord[],
  taskId: string,
  reason: PauseReason = 'user'
): { tasks: TaskRecord[]; task: TaskRecord } {
  const result = applyTaskUpdate(tasks, taskId, (task) => pauseWorkSession(task, reason) as TaskRecord)
  if (!result.task) throw new Error('Task not found')
  return { tasks: result.tasks, task: result.task }
}

export function resumeTaskWork(tasks: TaskRecord[], taskId: string): { tasks: TaskRecord[]; task: TaskRecord } {
  let next = pauseOtherRunningTasks(tasks, taskId, 'task_switch')
  const result = applyTaskUpdate(next, taskId, (task) => resumeWorkSession(task) as TaskRecord)
  if (!result.task) throw new Error('Task not found')
  return { tasks: result.tasks, task: result.task }
}

export function completeTaskWork(tasks: TaskRecord[], taskId: string): { tasks: TaskRecord[]; task: TaskRecord } {
  const result = applyTaskUpdate(tasks, taskId, (task) => completeWorkSession(task) as TaskRecord)
  if (!result.task) throw new Error('Task not found')
  return { tasks: result.tasks, task: result.task }
}

export function checkpointAllTasks(tasks: TaskRecord[]): TaskRecord[] {
  return tasks.map((task) => {
    if (!getOpenSession(task)) return materializeTaskTimeFields(task)
    return materializeTaskTimeFields({
      ...task,
      time_last_checkpoint_at: new Date().toISOString()
    })
  })
}

export function getTaskTimeStatusFromList(tasks: TaskRecord[], taskId: string): TaskTimeStatus | null {
  const task = tasks.find((t) => t.id === taskId)
  if (!task) return null
  return getTaskTimeStatus(task)
}

export function findRunningTaskId(tasks: TaskRecord[]): string | null {
  const running = tasks.find((t) => getOpenSession(t))
  return running?.id ?? null
}

export function migrateLegacyTaskTime(task: TaskRecord): TaskRecord {
  const sessions = getWorkSessions(task)
  if (sessions.length > 0) return materializeTaskTimeFields(task)

  const start = task.start_time as string | undefined
  const end = task.end_time as string | undefined
  if (!start) return materializeTaskTimeFields({ ...task, work_sessions: [], recorded_seconds: 0 })

  const migrated = [
    {
      id: `legacy-${task.id}`,
      started_at: start,
      ended_at: end ?? null,
      pause_reason: end ? ('complete' as PauseReason) : undefined
    }
  ]

  return materializeTaskTimeFields({
    ...task,
    work_sessions: migrated
  })
}

export function migrateAllTaskTimes(tasks: TaskRecord[]): TaskRecord[] {
  return reconcileTasksTimeState(tasks.map(migrateLegacyTaskTime))
}
