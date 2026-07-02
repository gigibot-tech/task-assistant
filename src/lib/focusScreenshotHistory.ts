import type { Task } from '../store/taskStore'

export interface FocusScreenshotEntry {
  timestamp: string
  imagePath: string
  aiPrediction?: string
  activityLabel?: string
  recommendation?: string
  deviationScore?: number
  similarity?: number
  onTask?: boolean
  source: 'analysis' | 'focus_check'
}

/** Merge analyzed screenshots and focus-check captures into one timeline. */
export function buildFocusScreenshotHistory(task: Task | undefined): FocusScreenshotEntry[] {
  if (!task) return []

  const byPath = new Map<string, FocusScreenshotEntry>()

  for (const shot of task.screenshots ?? []) {
    if (!shot.imagePath) continue
    byPath.set(shot.imagePath, {
      timestamp: shot.timestamp,
      imagePath: shot.imagePath,
      aiPrediction: shot.aiPrediction,
      activityLabel: shot.activityLabel,
      recommendation: shot.recommendation,
      deviationScore: shot.deviationScore,
      source: 'analysis'
    })
  }

  for (const capture of task.focus_capture_history ?? []) {
    if (!capture.imagePath) continue
    const existing = byPath.get(capture.imagePath)
    if (existing) continue
    byPath.set(capture.imagePath, {
      timestamp: capture.capturedAt,
      imagePath: capture.imagePath,
      aiPrediction: 'Background focus check',
      activityLabel: 'focus_poll',
      source: 'focus_check'
    })
  }

  return [...byPath.values()].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
}

/** Screenshots from automatic background monitoring only (excludes manual capture). */
export function buildAutomaticScreenshotHistory(task: Task | undefined): FocusScreenshotEntry[] {
  if (!task) return []

  const autoPaths = new Set(
    (task.focus_capture_history ?? []).map((c) => c.imagePath).filter(Boolean)
  )

  return buildFocusScreenshotHistory(task).filter(
    (entry) => autoPaths.has(entry.imagePath) || entry.source === 'focus_check'
  )
}
