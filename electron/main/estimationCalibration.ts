export function median(values: number[]): number {
  if (values.length === 0) return 1
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

export function getCalibrationFactor(settings: {
  estimate_calibration_factor?: number
}): number {
  const factor = settings.estimate_calibration_factor
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) return 1
  return Math.min(3, Math.max(0.25, factor))
}

export function recordCalibrationSample(
  settings: Record<string, unknown>,
  estimateMinutes: number,
  actualMinutes: number
): Record<string, unknown> {
  if (estimateMinutes <= 0 || actualMinutes <= 0) return settings

  const ratio = actualMinutes / estimateMinutes
  const samples = Array.isArray(settings.estimate_calibration_samples)
    ? (settings.estimate_calibration_samples as number[])
    : []

  const nextSamples = [...samples, ratio].slice(-20)
  return {
    ...settings,
    estimate_calibration_samples: nextSamples,
    estimate_calibration_factor: median(nextSamples)
  }
}

export function applyCalibration(rawEstimate: number, settings: Record<string, unknown>): number {
  return Math.max(1, Math.round(rawEstimate * getCalibrationFactor(settings)))
}

export function checklistProgressPercent(
  checklist?: Array<{ done: boolean }> | null
): number | null {
  if (!checklist?.length) return null
  const done = checklist.filter((item) => item.done).length
  return Math.round((done / checklist.length) * 100)
}
