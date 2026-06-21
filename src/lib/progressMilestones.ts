/** Prime progress checkpoints (1–100). Each task prompts for a quick update when crossed. */
export const PRIME_MILESTONES = [
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97
] as const

export type PrimeMilestone = (typeof PRIME_MILESTONES)[number]

export interface ProgressMilestoneUpdate {
  prime: number
  note: string
  acknowledged_at: string
}

export function clampProgressPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function isPrimeMilestone(value: number): value is PrimeMilestone {
  return (PRIME_MILESTONES as readonly number[]).includes(value)
}

/** Primes newly reached: progress moved from `before` to `after` (exclusive before, inclusive after). */
export function getNewlyCrossedPrimes(before: number, after: number): PrimeMilestone[] {
  const lo = clampProgressPercent(before)
  const hi = clampProgressPercent(after)
  if (hi <= lo) return []

  return PRIME_MILESTONES.filter((prime) => prime > lo && prime <= hi)
}

export function getAcknowledgedPrimes(
  updates: ProgressMilestoneUpdate[] | undefined
): Set<number> {
  return new Set((updates ?? []).map((u) => u.prime))
}

/** Lowest prime milestone at or below progress that has no update yet. */
export function getNextPendingMilestone(
  progressPercent: number,
  updates: ProgressMilestoneUpdate[] | undefined
): PrimeMilestone | null {
  const progress = clampProgressPercent(progressPercent)
  const acked = getAcknowledgedPrimes(updates)

  for (const prime of PRIME_MILESTONES) {
    if (prime <= progress && !acked.has(prime)) return prime
  }
  return null
}

/** Next milestone still ahead of current progress (for subtle “coming up” hint). */
export function getUpcomingMilestone(
  progressPercent: number,
  updates: ProgressMilestoneUpdate[] | undefined
): PrimeMilestone | null {
  const progress = clampProgressPercent(progressPercent)
  const acked = getAcknowledgedPrimes(updates)

  for (const prime of PRIME_MILESTONES) {
    if (prime > progress && !acked.has(prime)) return prime
  }
  return null
}

/** Queue of pending milestones to prompt, lowest first. */
export function getPendingMilestoneQueue(
  progressPercent: number,
  updates: ProgressMilestoneUpdate[] | undefined,
  newlyCrossed: PrimeMilestone[] = []
): PrimeMilestone[] {
  const acked = getAcknowledgedPrimes(updates)
  const progress = clampProgressPercent(progressPercent)

  const fromCrossing = newlyCrossed.filter((p) => !acked.has(p))
  const fromBacklog = PRIME_MILESTONES.filter((p) => p <= progress && !acked.has(p))

  const ordered = [...fromCrossing, ...fromBacklog]
  const seen = new Set<number>()
  const queue: PrimeMilestone[] = []

  for (const prime of ordered) {
    if (seen.has(prime)) continue
    seen.add(prime)
    queue.push(prime)
  }

  return queue
}

export function milestoneLabel(prime: number): string {
  return `${prime}%`
}
