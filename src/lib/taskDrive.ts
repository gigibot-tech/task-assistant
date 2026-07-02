import { PRIME_MILESTONES } from './progressMilestones'
import {
  aspectPromptKey,
  driveDailyPromptKey,
  primePromptKey,
  wasPromptedToday,
  type DailyPromptDates
} from './dailyPrompts'

export type DriveAspect = 'curiosity' | 'ownership' | 'external_pressure' | 'freedom'

export type DriveWindowDays = 7 | 14 | 30 | 90

export type DriveCheckInMode = 'prime' | 'daily' | 'adhoc'

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

export const DEFAULT_DRIVE_ENABLED_ASPECTS: DriveAspect[] = [...DRIVE_ASPECTS]

export const DRIVE_ASPECT_LABELS: Record<DriveAspect, string> = {
  curiosity: 'Curiosity',
  ownership: 'Ownership',
  external_pressure: 'Pressure',
  freedom: 'Freedom'
}

const MS_PER_DAY = 86_400_000

export function getEnabledDriveAspects(settings?: {
  driveEnabledAspects?: DriveAspect[]
}): DriveAspect[] {
  const list = settings?.driveEnabledAspects
  if (!list?.length) return DEFAULT_DRIVE_ENABLED_ASPECTS
  return DRIVE_ASPECTS.filter((aspect) => list.includes(aspect))
}

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

export function getAspectBullets(aspect: DriveAspect): string[] {
  switch (aspect) {
    case 'curiosity':
      return [
        'What problem is actually real?',
        'What is unclear here?',
        'What is missing in the current solution?'
      ]
    case 'ownership':
      return [
        "You don't wait for perfect clarity or full instructions.",
        'You take this task, shape it, and push it forward.'
      ]
    case 'external_pressure':
      return [
        'Who or what depends on this being done?',
        'What is the real deadline or stake?'
      ]
    case 'freedom':
      return [
        "You don't just execute a spec.",
        'Question scope, reshape approach, and improve structure.'
      ]
    default:
      return []
  }
}

export function getAspectTooltip(aspect: DriveAspect, taskTitle: string): string {
  const title = taskTitle.trim() || 'this task'
  const header = `For "${title}" — ${DRIVE_ASPECT_LABELS[aspect]}`
  const bullets = getAspectBullets(aspect)
  if (!bullets.length) return header
  return `${header}\n\n${bullets.map((b) => (b.startsWith('•') ? b : `• ${b}`)).join('\n')}`
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
  return consolidateDriveCheckins(checkins)
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

export function mergeDriveNotes(
  existing: Record<DriveAspect, string> | undefined,
  partial: Partial<Record<DriveAspect, string>>
): Record<DriveAspect, string> {
  const next = { ...emptyDriveNotes(), ...(existing ?? {}) }
  for (const aspect of DRIVE_ASPECTS) {
    const value = partial[aspect]?.trim()
    if (value) next[aspect] = value
  }
  return next
}

export function entryHasNote(entry: DriveReflectionEntry, aspect: DriveAspect): boolean {
  return !!entry.notes[aspect]?.trim()
}

function todayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function findTodayDriveEntry(
  checkins: DriveReflectionEntry[] | undefined,
  primeDay: number,
  now = Date.now()
): DriveReflectionEntry | undefined {
  const today = todayKey(now)
  return (checkins ?? []).find((entry) => {
    if (entry.prime_day !== primeDay) return false
    return new Date(entry.recorded_at).toISOString().slice(0, 10) === today
  })
}

/** Merge legacy same-day ad-hoc rows (one aspect each) into single daily entries. */
export function consolidateDriveCheckins(
  checkins: DriveReflectionEntry[] | undefined
): DriveReflectionEntry[] {
  const list = [...(checkins ?? [])]
  const primeEntries = list.filter((c) => c.prime_day > 0)
  const dailyByDate = new Map<string, DriveReflectionEntry>()

  for (const entry of list.filter((c) => c.prime_day <= 0)) {
    const date = new Date(entry.recorded_at).toISOString().slice(0, 10)
    const existing = dailyByDate.get(date)
    if (!existing) {
      dailyByDate.set(date, { ...entry, notes: { ...emptyDriveNotes(), ...entry.notes } })
      continue
    }
    dailyByDate.set(date, {
      ...existing,
      notes: mergeDriveNotes(existing.notes, entry.notes),
      recorded_at:
        new Date(entry.recorded_at).getTime() > new Date(existing.recorded_at).getTime()
          ? entry.recorded_at
          : existing.recorded_at
    })
  }

  return [...primeEntries, ...dailyByDate.values()].sort(
    (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
  )
}

export function upsertDriveCheckin(
  checkins: DriveReflectionEntry[] | undefined,
  params: {
    id: string
    taskDay: number
    primeDay: number
    notes: Record<DriveAspect, string>
  },
  now = Date.now()
): DriveReflectionEntry[] {
  const consolidated = consolidateDriveCheckins(checkins)
  const { id, taskDay, primeDay, notes } = params
  const recorded_at = new Date(now).toISOString()

  if (primeDay > 0) {
    const existing = consolidated.find((c) => c.prime_day === primeDay)
    const entry: DriveReflectionEntry = {
      id: existing?.id ?? id,
      prime_day: primeDay,
      task_day: taskDay,
      recorded_at,
      notes: mergeDriveNotes(existing?.notes, notes)
    }
    return [...consolidated.filter((c) => c.prime_day !== primeDay), entry].sort(
      (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
    )
  }

  const existing = findTodayDriveEntry(consolidated, 0, now)
  const entry: DriveReflectionEntry = {
    id: existing?.id ?? id,
    prime_day: 0,
    task_day: taskDay,
    recorded_at,
    notes: mergeDriveNotes(existing?.notes, notes)
  }
  const withoutTodayDaily = consolidated.filter((c) => {
    if (c.prime_day !== 0) return true
    return new Date(c.recorded_at).toISOString().slice(0, 10) !== todayKey(now)
  })
  return [...withoutTodayDaily, entry].sort(
    (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
  )
}

export function hasAspectNoteToday(
  checkins: DriveReflectionEntry[] | undefined,
  aspect: DriveAspect,
  enabledAspects: DriveAspect[] = DRIVE_ASPECTS,
  now = Date.now()
): boolean {
  if (!enabledAspects.includes(aspect)) return true
  const today = todayKey(now)
  return consolidateDriveCheckins(checkins).some((entry) => {
    if (new Date(entry.recorded_at).toISOString().slice(0, 10) !== today) return false
    return entryHasNote(entry, aspect)
  })
}

/** Enabled aspects not yet answered today. */
export function getDailyAspectQueue(
  checkins: DriveReflectionEntry[] | undefined,
  promptDates: DailyPromptDates | undefined,
  enabledAspects: DriveAspect[] = DRIVE_ASPECTS,
  now = Date.now()
): DriveAspect[] {
  if (wasPromptedToday(promptDates, driveDailyPromptKey(), now)) return []
  return enabledAspects.filter((aspect) => !hasAspectNoteToday(checkins, aspect, enabledAspects, now))
}

export function countAspectsAnsweredToday(
  checkins: DriveReflectionEntry[] | undefined,
  enabledAspects: DriveAspect[] = DRIVE_ASPECTS,
  now = Date.now()
): number {
  return enabledAspects.filter((aspect) =>
    hasAspectNoteToday(checkins, aspect, enabledAspects, now)
  ).length
}

export function isDailyReflectionDueToday(
  checkins: DriveReflectionEntry[] | undefined,
  promptDates: DailyPromptDates | undefined,
  enabledAspects: DriveAspect[] = DRIVE_ASPECTS,
  now = Date.now()
): boolean {
  return getDailyAspectQueue(checkins, promptDates, enabledAspects, now).length > 0
}

/** Prime reflection due and not yet auto-prompted today. */
export function isPrimeProbeDueToday(
  taskDay: number,
  acknowledged: number[] | undefined,
  checkins: DriveReflectionEntry[] | undefined,
  promptDates: DailyPromptDates | undefined,
  now = Date.now()
): number | null {
  const duePrime = getDuePrimeCheckIn(taskDay, acknowledged, checkins)
  if (duePrime == null) return null
  if (wasPromptedToday(promptDates, primePromptKey(duePrime), now)) return null
  return duePrime
}

export function formatCheckinRowLabel(entry: DriveReflectionEntry): string {
  if (entry.prime_day > 0) return `Day ${entry.task_day} · Prime ${entry.prime_day}`
  return 'Daily reflection'
}

export function todayDriveNotes(
  checkins: DriveReflectionEntry[] | undefined,
  now = Date.now()
): Record<DriveAspect, string> {
  const entry = findTodayDriveEntry(consolidateDriveCheckins(checkins), 0, now)
  return { ...emptyDriveNotes(), ...(entry?.notes ?? {}) }
}

export function formatPrimeSchedulePreview(): string {
  const sample = PRIME_MILESTONES.slice(0, 8).join(', ')
  return `${sample}…`
}

export { PRIME_MILESTONES as DRIVE_PRIME_DAYS }
