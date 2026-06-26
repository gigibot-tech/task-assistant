import fs from 'fs'
import { shell } from 'electron'
import type { DeviationResult } from '../activityAnalysis'
import {
  mergeWorkplaceSettings,
  validateWorkplaceFolder,
  resolveSafePath,
  type WorkplaceSettings
} from './workplacePaths'
import { indexWorkplaceFolder, type WorkplaceIndex } from './workplaceIndexer'
import { readWorkplaceFiles } from './workplaceReader'
import { pickWorkplaceFiles } from './workplaceFilePicker'
import {
  runDeviationRecoveryVision,
  type WorkplaceGuidance,
  type RecoveryTaskContext
} from './deviationRecovery'
import { getActiveWorkplacePath, type TaskWithWorkspaces } from '../../../src/shared/workplace/workspaces'

export type { WorkplaceIndex, WorkplaceGuidance, RecoveryTaskContext }

export interface WorkplaceTaskRecord extends RecoveryTaskContext, TaskWithWorkspaces {
  id?: string
  last_on_task_capture?: {
    imagePath: string
    capturedAt: string
    similarity: number
    activity: string
  }
  workplace_guidance?: WorkplaceGuidance
}

function resolveWorkplaceRoot(task: WorkplaceTaskRecord): string | null {
  return validateWorkplaceFolder(getActiveWorkplacePath(task))
}

const GUIDANCE_COOLDOWN_MS = 10 * 60 * 1000

export function indexTaskWorkplace(
  task: WorkplaceTaskRecord,
  settings?: WorkplaceSettings
): WorkplaceIndex | null {
  const root = resolveWorkplaceRoot(task)
  if (!root) return null
  return indexWorkplaceFolder(root, settings)
}

export function isGuidanceCacheFresh(task: WorkplaceTaskRecord): boolean {
  const g = task.workplace_guidance
  if (!g?.generated_at) return false
  return Date.now() - new Date(g.generated_at).getTime() < GUIDANCE_COOLDOWN_MS
}

export async function runDeviationRecovery(
  model: string,
  task: WorkplaceTaskRecord,
  deviation: Pick<
    DeviationResult,
    'currentActivity' | 'activityLabel' | 'similarity' | 'imagePath' | 'suggestion'
  >,
  options?: {
    settings?: WorkplaceSettings
    forceRefresh?: boolean
  }
): Promise<WorkplaceGuidance | null> {
  const root = resolveWorkplaceRoot(task)
  if (!root) return null

  if (!options?.forceRefresh && isGuidanceCacheFresh(task)) {
    return task.workplace_guidance ?? null
  }

  const wpSettings = mergeWorkplaceSettings(options?.settings)

  let index: WorkplaceIndex | undefined = task.workplace_index as WorkplaceIndex | undefined
  if (!index?.tree_text || !index.relative_paths?.length) {
    index = indexWorkplaceFolder(root, wpSettings)
  }

  const picked = await pickWorkplaceFiles(model, task, index, root)
  const excerpts = readWorkplaceFiles(root, picked, wpSettings.workplaceMaxReadBytes)

  try {
    return await runDeviationRecoveryVision(
      model,
      task,
      deviation,
      index.tree_text,
      excerpts,
      task.last_on_task_capture?.imagePath
    )
  } catch (err) {
    console.error('[workplace] Deviation recovery failed:', err)
    return {
      generated_at: new Date().toISOString(),
      summary:
        deviation.suggestion ||
        'Return to your workplace folder and continue the planned task.',
      suggested_files: picked.slice(0, 3).map((p) => ({ path: p, reason: 'Relevant project file' })),
      suggested_actions: ['Open your workplace folder', 'Resume work on the planned task'],
      tools_hint: 'Open the project in your editor and focus on the task title.'
    }
  }
}

export function openWorkplacePath(
  task: WorkplaceTaskRecord,
  relativePath: string
): { success: boolean; error?: string } {
  const root = resolveWorkplaceRoot(task)
  if (!root) return { success: false, error: 'No workplace folder set' }

  const abs = resolveSafePath(root, relativePath)
  if (!abs) return { success: false, error: 'Invalid or blocked path' }

  if (!fs.existsSync(abs)) {
    return { success: false, error: 'File not found' }
  }

  const err = shell.openPath(abs)
  if (err) return { success: false, error: err }
  return { success: true }
}
