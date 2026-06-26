import type { Task } from '../store/taskStore'
import type { TaskSubtask } from './subtaskTypes'

export interface EstimateResult {
  estimate: number
  rawEstimate?: number
  calibrationFactor?: number
  confidence?: number
}

export function effectiveEstimateMinutes(task: {
  user_estimate_minutes?: number
  ai_estimate_minutes?: number
  estimated_minutes?: number
}): number | null {
  return task.user_estimate_minutes ?? task.ai_estimate_minutes ?? task.estimated_minutes ?? null
}

export async function estimateTaskTime(task: Task): Promise<EstimateResult> {
  return window.electron.estimateTime(task)
}

export async function estimateSubtaskTime(
  taskId: string,
  subtaskId: string
): Promise<EstimateResult> {
  return window.electron.estimateSubtaskTime(taskId, subtaskId)
}

export function formatEstimateLabel(minutes: number, confidence?: number): string {
  const conf =
    typeof confidence === 'number' ? ` · ${Math.round(confidence * 100)}% confidence` : ''
  return `~${minutes} min${conf}`
}

export function subtaskHasEstimateContext(subtask: TaskSubtask): boolean {
  return !!(
    subtask.title?.trim() &&
    (subtask.input?.trim() || subtask.output?.trim() || subtask.transformation?.trim())
  )
}
