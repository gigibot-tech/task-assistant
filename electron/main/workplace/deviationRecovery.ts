import fs from 'fs'
import { ollamaGenerate, parseJsonResponse } from '../ollamaClient'
import { formatPlannedTask } from '../activityAnalysis'
import type { DeviationResult } from '../activityAnalysis'
import { logVisionPayloadStats, planVisionPayload } from '../visionPayload'

export interface WorkplaceGuidance {
  generated_at: string
  summary: string
  suggested_files: Array<{ path: string; reason: string }>
  suggested_actions: string[]
  tools_hint?: string
}

export interface RecoveryTaskContext {
  title: string
  description?: string
  progress_percent?: number
  progress_milestone_updates?: Array<{ prime: number; note: string; acknowledged_at: string }>
}

function formatMilestoneNotes(
  updates?: Array<{ prime: number; note: string; acknowledged_at: string }>
): string {
  if (!updates?.length) return ''
  const recent = [...updates]
    .sort((a, b) => b.prime - a.prime)
    .slice(0, 3)
    .map((u) => `${u.prime}%: ${u.note || 'confirmed'}`)
    .join('; ')
  return `\nRecent progress check-ins: ${recent}`
}

function normalizeGuidance(parsed: Record<string, unknown>): Omit<WorkplaceGuidance, 'generated_at'> {
  const suggested_files: Array<{ path: string; reason: string }> = []
  const rawFiles = parsed.suggested_files ?? parsed.files

  if (Array.isArray(rawFiles)) {
    for (const item of rawFiles) {
      if (typeof item === 'string') {
        suggested_files.push({ path: item, reason: '' })
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>
        const p = String(obj.path ?? obj.file ?? '')
        if (p) {
          suggested_files.push({ path: p, reason: String(obj.reason ?? '') })
        }
      }
    }
  }

  const suggested_actions: string[] = []
  const rawActions = parsed.suggested_actions ?? parsed.actions
  if (Array.isArray(rawActions)) {
    for (const a of rawActions) {
      if (typeof a === 'string' && a.trim()) suggested_actions.push(a.trim())
    }
  }

  return {
    summary: String(parsed.summary ?? parsed.explanation ?? 'Review your workplace files and return to the task.'),
    suggested_files: suggested_files.slice(0, 5),
    suggested_actions: suggested_actions.slice(0, 6),
    tools_hint: parsed.tools_hint ? String(parsed.tools_hint) : undefined
  }
}

function loadImageBuffer(imagePath: string | undefined): Buffer | null {
  if (!imagePath || !fs.existsSync(imagePath)) return null
  try {
    return fs.readFileSync(imagePath)
  } catch {
    return null
  }
}

export async function runDeviationRecoveryVision(
  model: string,
  task: RecoveryTaskContext,
  deviation: Pick<
    DeviationResult,
    'currentActivity' | 'activityLabel' | 'similarity' | 'imagePath'
  >,
  workplaceTree: string,
  fileExcerpts: string,
  lastOnTaskImagePath?: string
): Promise<WorkplaceGuidance> {
  const planned = formatPlannedTask(task)
  const progress =
    task.progress_percent != null ? `\nProgress: ${task.progress_percent}%` : ''
  const milestones = formatMilestoneNotes(task.progress_milestone_updates)

  const currentBuf = loadImageBuffer(deviation.imagePath)
  const refBuf = loadImageBuffer(lastOnTaskImagePath)

  let visionImages: string[] | undefined
  let refNote =
    'No reference on-task screenshot — use workplace files and current screen only.'

  if (currentBuf) {
    const plan = planVisionPayload({
      current: currentBuf,
      reference: refBuf ?? undefined,
      requestedMax: 2
    })
    visionImages = plan.images
    logVisionPayloadStats(visionImages, 'deviationRecovery')

    if (plan.images.length === 2) {
      refNote =
        'Image 1 is the LAST time you were on-task. Image 2 is the CURRENT off-task screen.'
    } else if (plan.droppedReference) {
      refNote =
        'Reference on-task screenshot omitted (vision payload budget) — use workplace files and current screen.'
    }
  }

  const prompt = `You are a focus coach helping the user return to productive work on their planned task.

Planned task:
${planned}${progress}${milestones}

Current off-task activity: ${deviation.currentActivity}
Activity label: ${deviation.activityLabel ?? 'unknown'}
Focus similarity: ${Math.round(deviation.similarity * 100)}%

Workplace folder tree:
${workplaceTree.slice(0, 4000)}

File excerpts from workplace:
${fileExcerpts.slice(0, 8000) || '(no excerpts)'}

${refNote}

Compare what they were doing when on-task vs now. Suggest specific files in the workplace to open and concrete next steps to continue the task. Mention tools (e.g. Cursor IDE, terminal) when helpful.

Respond with JSON only:
{"summary":"one paragraph","suggested_files":[{"path":"relative/path.ts","reason":"why"}],"suggested_actions":["step 1","step 2"],"tools_hint":"optional tool tip"}`

  const raw = await ollamaGenerate(
    model,
    prompt,
    visionImages,
    { numPredict: 768, showErrorDialog: true }
  )

  const parsed = parseJsonResponse<Record<string, unknown>>(raw)
  const normalized = normalizeGuidance(parsed)

  return {
    generated_at: new Date().toISOString(),
    ...normalized
  }
}
