export interface StaleProgressInput {
  progressPercent: number
  progressUpdatedAt: string | null
  recordedSeconds: number
  estimateMinutes: number | null
  lastOnTask: boolean | null
  lastSimilarity: number | null
  sessionOpen: boolean
  pomodoroCyclesCompleted: number
  /** Avg visual similarity of last N focus-check screenshots (0–1). */
  screenCaptureSimilarity?: number | null
  screenCaptureSampleCount?: number
}

export interface StaleProgressResult {
  score: number
  reasons: string[]
  level: 'ok' | 'nudge' | 'alert'
}

export type StaleSensitivity = 'low' | 'medium' | 'high'

const STALE_THRESHOLDS: Record<
  StaleSensitivity,
  { nudge: number; alert: number; progressStaleMin: number }
> = {
  low: { nudge: 60, alert: 85, progressStaleMin: 60 },
  medium: { nudge: 50, alert: 70, progressStaleMin: 45 },
  high: { nudge: 40, alert: 55, progressStaleMin: 30 }
}

export function computeStaleScore(
  input: StaleProgressInput,
  sensitivity: StaleSensitivity = 'medium'
): StaleProgressResult {
  const reasons: string[] = []
  let score = 0
  const thresholds = STALE_THRESHOLDS[sensitivity] ?? STALE_THRESHOLDS.medium

  const now = Date.now()
  const progressAgeMs = input.progressUpdatedAt
    ? now - new Date(input.progressUpdatedAt).getTime()
    : Number.POSITIVE_INFINITY

  const progressStaleMs = thresholds.progressStaleMin * 60 * 1000

  if (input.sessionOpen && progressAgeMs > progressStaleMs) {
    score += 40
    reasons.push(`No progress update in ${thresholds.progressStaleMin}+ minutes`)
  }

  if (
    input.estimateMinutes &&
    input.estimateMinutes > 0 &&
    input.recordedSeconds > input.estimateMinutes * 60 * 0.8 &&
    input.progressPercent < 50
  ) {
    score += 25
    reasons.push('Most of estimated time used but progress is still low')
  }

  if (input.lastOnTask === false || (input.lastSimilarity != null && input.lastSimilarity < 0.5)) {
    score += 25
    reasons.push('Recent focus checks show off-task activity')
  }

  if (input.pomodoroCyclesCompleted >= 2 && progressAgeMs > 30 * 60 * 1000) {
    score += 20
    reasons.push('Multiple work blocks without a progress update')
  }

  if (input.sessionOpen && progressAgeMs > 30 * 60 * 1000 && input.lastOnTask === false) {
    score += 15
    reasons.push('Timer running while focus has drifted')
  }

  if (
    input.screenCaptureSampleCount != null &&
    input.screenCaptureSampleCount >= 3 &&
    input.screenCaptureSimilarity != null &&
    input.screenCaptureSimilarity >= 0.9
  ) {
    score += 30
    reasons.push(
      `Screen barely changed across last ${input.screenCaptureSampleCount} checks (${Math.round(input.screenCaptureSimilarity * 100)}% similar)`
    )
  } else if (
    input.screenCaptureSampleCount != null &&
    input.screenCaptureSampleCount >= 2 &&
    input.screenCaptureSimilarity != null &&
    input.screenCaptureSimilarity >= 0.85
  ) {
    score += 15
    reasons.push(
      `Screen looks mostly the same as recent checks (${Math.round(input.screenCaptureSimilarity * 100)}% similar)`
    )
  }

  const level =
    score >= thresholds.alert ? 'alert' : score >= thresholds.nudge ? 'nudge' : 'ok'
  return { score, reasons, level }
}

export function effectiveEstimateMinutes(task: {
  user_estimate_minutes?: number
  ai_estimate_minutes?: number
  estimated_minutes?: number
}): number | null {
  return (
    task.user_estimate_minutes ??
    task.ai_estimate_minutes ??
    task.estimated_minutes ??
    null
  )
}

export function estimateRemainingMinutes(
  task: {
    user_estimate_minutes?: number
    ai_estimate_minutes?: number
    estimated_minutes?: number
    recorded_seconds?: number
    progress_percent?: number
  },
  recordedSeconds: number
): number | null {
  const estimate = effectiveEstimateMinutes(task)
  if (!estimate) return null

  const percent = task.progress_percent ?? 0
  const remainingByProgress = estimate * (1 - percent / 100)
  const recordedMinutes = recordedSeconds / 60
  return Math.max(0, Math.round(remainingByProgress - recordedMinutes))
}
