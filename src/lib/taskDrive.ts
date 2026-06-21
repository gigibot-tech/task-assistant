import { PRIME_MILESTONES } from './progressMilestones'

export type DriveAspect = 'curiosity' | 'ownership' | 'external_pressure' | 'freedom'

export type DriveWindowDays = 7 | 14 | 30 | 90

export interface DriveReflectionEntry {
  id: string
  prime_day: number
  task_day: number
  recorded_at: string
  notes: Record<DriveAspect, string>
}

export const DRIVE_ASPECTS: DriveAspect[] = [
  'curiosity',
  'ownership',
  'external_pressure',
  'freedom'
]

export const DRIVE_ASPECT_LABELS: Record<DriveAspect, string> = {
  curiosity: 'Curiosity',
  ownership: 'Ownership',
  external_pressure: 'Pressure',
  freedom: 'Freedom'
}

const MS_PER_DAY = 86_400_000

export function getTaskDayIndex(workStartedAt: string | undefined, now = Date.now()): number {
  if (!workStartedAt) return 1
  const start = new Date(workStartedAt).getTime()
  if (!Number.isFinite(start)) return 1
  const elapsed = now - start
  if (elapsed < 0) return 1
  return Math.floor(elapsed / MS_PER_DAY) + 1
}

export function getAcknowledgedDrivePrimes(acknowledged?: number[]): Set<number> {
  return new Set(acknowledged ?? [])
}

export function hasCheckinForPrime(
  checkins: DriveReflectionEntry[] | undefined,
  prime: number
): boolean {
  return (checkins ?? []).some((c) => c.prime_day === prime && c.prime_day > 0)
}

/** Lowest prime day at or below taskDay that still needs a check-in. */
export function getDuePrimeCheckIn(
  taskDay: number,
  acknowledged: number[] | undefined,
  checkins: DriveReflectionEntry[] | undefined
): number | null {
  const acked = getAcknowledgedDrivePrimes(acknowledged)

  for (const prime of PRIME_MILESTONES) {
    if (prime > taskDay) break
    if (acked.has(prime)) continue
    if (hasCheckinForPrime(checkins, prime)) continue
    return prime
  }
  return null
}

export function getNextPrimeCheckIn(
  taskDay: number,
  acknowledged: number[] | undefined,
  checkins: DriveReflectionEntry[] | undefined
): number | null {
  const acked = getAcknowledgedDrivePrimes(acknowledged)
  const saved = new Set((checkins ?? []).filter((c) => c.prime_day > 0).map((c) => c.prime_day))

  for (const prime of PRIME_MILESTONES) {
    if (prime <= taskDay) continue
    if (acked.has(prime) || saved.has(prime)) continue
    return prime
  }
  return null
}

export function getAspectLabels(): typeof DRIVE_ASPECT_LABELS {
  return DRIVE_ASPECT_LABELS
}

export function getAspectTooltip(aspect: DriveAspect, taskTitle: string): string {
  const title = taskTitle.trim() || 'this task'
  const header = `For "${title}" — ${DRIVE_ASPECT_LABELS[aspect]}`

  switch (aspect) {
    case 'curiosity':
      return `${header}

You need something to figure out, not just execute.
• What problem is actually real?
• What is unclear here?
• What is missing in the current solution?`
    case 'ownership':
      return `${header}

You don't wait for perfect clarity or full instructions.
You take this task, shape it, and push it forward.
That's your biggest strength on work like this.`
    case 'external_pressure':
      return `${header}

You need something real to depend on this — a client, deadline, team, or live system.
Without that, your energy on this task may drop.
You're not built for purely internal or hypothetical work.`
    case 'freedom':
      return `${header}

You don't just execute a spec.
You question scope, reshape approach, and improve structure.
This task needs room for you to adjust direction.`
    default:
      return header
  }
}

export function getAspectPromptQuestion(aspect: DriveAspect): string {
  switch (aspect) {
    case 'curiosity':
      return "What problem is real here? What's unclear or missing?"
    case 'ownership':
      return 'What can you take and shape without waiting for perfect clarity?'
    case 'external_pressure':
      return 'Who or what depends on this being done? What is the real deadline or stake?'
    case 'freedom':
      return 'What would you reshape about scope, approach, or structure?'
    default:
      return 'Your thoughts…'
  }
}

export function filterCheckinsByWindow(
  checkins: DriveReflectionEntry[] | undefined,
  windowDays: DriveWindowDays,
  now = Date.now()
): DriveReflectionEntry[] {
  const cutoff = now - windowDays * MS_PER_DAY
  return (checkins ?? [])
    .filter((c) => new Date(c.recorded_at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())
}

export function groupCheckinsByDate(
  checkins: DriveReflectionEntry[]
): Array<{ dateKey: string; label: string; entries: DriveReflectionEntry[] }> {
  const map = new Map<string, DriveReflectionEntry[]>()

  for (const entry of checkins) {
    const d = new Date(entry.recorded_at)
    const dateKey = d.toISOString().slice(0, 10)
    const group = map.get(dateKey) ?? []
    group.push(entry)
    map.set(dateKey, group)
  }

  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dateKey, entries]) => ({
      dateKey,
      label: new Date(dateKey + 'T12:00:00').toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }),
      entries: entries.sort(
        (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
      )
    }))
}

export function emptyDriveNotes(): Record<DriveAspect, string> {
  return {
    curiosity: '',
    ownership: '',
    external_pressure: '',
    freedom: ''
  }
}

export function entryHasNote(entry: DriveReflectionEntry, aspect: DriveAspect): boolean {
  return !!entry.notes[aspect]?.trim()
}

export function formatCheckinRowLabel(entry: DriveReflectionEntry): string {
  if (entry.prime_day <= 0) return 'Ad-hoc'
  return `Day ${entry.task_day} · Prime ${entry.prime_day}`
}

export { PRIME_MILESTONES as DRIVE_PRIME_DAYS }
