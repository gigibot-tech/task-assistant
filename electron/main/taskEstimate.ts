import { formatPlannedTask } from './activityAnalysis'
import { applyCalibration } from './estimationCalibration'
import { ollamaGenerate, parseJsonResponse } from './ollamaClient'
import { taskSubtaskContextFromTask } from './subtaskProbe/subtaskFocusContext'

export interface EstimateResult {
  estimate: number
  rawEstimate: number
  calibrationFactor: number
  confidence: number
}

function formatSubtasksForEstimate(
  subtasks?: Array<{
    title: string
    input?: string
    output?: string
    transformation?: string
    ai_estimate_minutes?: number
  }>
): string {
  if (!subtasks?.length) return 'none'
  return subtasks
    .map((st) => {
      const iot =
        st.input?.trim() && st.output?.trim() && st.transformation?.trim()
          ? `${st.input} → ${st.output} (${st.transformation})`
          : ''
      const est = st.ai_estimate_minutes ? ` ~${st.ai_estimate_minutes}m` : ''
      return `- ${st.title}${iot ? `: ${iot}` : ''}${est}`
    })
    .join('\n')
}

function parseEstimateResponse(raw: string): { total_minutes?: number; confidence?: number } {
  return parseJsonResponse<{ total_minutes?: number; confidence?: number }>(raw)
}

export async function estimateTaskMinutes(
  model: string,
  task: Record<string, unknown>,
  settings: Record<string, unknown>
): Promise<EstimateResult> {
  const ctx = taskSubtaskContextFromTask(task as Parameters<typeof taskSubtaskContextFromTask>[0])
  const subtasks = task.subtasks as Array<{
    title: string
    input?: string
    output?: string
    transformation?: string
    ai_estimate_minutes?: number
  }> | undefined

  const prompt = `Estimate time in minutes for this task (realistic for one person):
${formatPlannedTask(ctx)}
Subtasks:
${formatSubtasksForEstimate(subtasks)}

Respond with JSON only: {"total_minutes": number, "confidence": 0.0}`

  const raw = await ollamaGenerate(model, prompt, undefined, {
    numPredict: 256,
    showErrorDialog: false
  })
  const parsed = parseEstimateResponse(raw)
  const rawMinutes = parsed.total_minutes
  if (typeof rawMinutes !== 'number' || !Number.isFinite(rawMinutes) || rawMinutes <= 0) {
    throw new Error('AI could not produce a time estimate')
  }

  const calibrated = applyCalibration(rawMinutes, settings)
  return {
    estimate: calibrated,
    rawEstimate: rawMinutes,
    calibrationFactor: (settings.estimate_calibration_factor as number) ?? 1,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
  }
}

export async function estimateSubtaskMinutes(
  model: string,
  task: Record<string, unknown>,
  subtask: {
    title: string
    input?: string
    output?: string
    transformation?: string
    outcome?: string
  },
  settings: Record<string, unknown>
): Promise<EstimateResult> {
  const ctx = taskSubtaskContextFromTask(task as Parameters<typeof taskSubtaskContextFromTask>[0])
  const iot =
    subtask.input?.trim() && subtask.output?.trim() && subtask.transformation?.trim()
      ? `${subtask.input} → ${subtask.output} (${subtask.transformation})`
      : subtask.outcome?.trim() || 'not fully defined'

  const prompt = `Estimate minutes to complete this ONE subtask slice (spike/probe scope, not full project):
Parent task: ${formatPlannedTask(ctx)}
Subtask: ${subtask.title}
I/O/T: ${iot}

Respond with JSON only: {"total_minutes": number, "confidence": 0.0}`

  const raw = await ollamaGenerate(model, prompt, undefined, {
    numPredict: 200,
    showErrorDialog: false
  })
  const parsed = parseEstimateResponse(raw)
  const rawMinutes = parsed.total_minutes
  if (typeof rawMinutes !== 'number' || !Number.isFinite(rawMinutes) || rawMinutes <= 0) {
    throw new Error('AI could not produce a subtask time estimate')
  }

  const calibrated = applyCalibration(rawMinutes, settings)
  return {
    estimate: calibrated,
    rawEstimate: rawMinutes,
    calibrationFactor: (settings.estimate_calibration_factor as number) ?? 1,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
  }
}
