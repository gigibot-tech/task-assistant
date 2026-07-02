import type { DriveAspect } from './taskDrive'

/** YYYY-MM-DD */
export type DailyPromptDates = Record<string, string>

export function dateKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function aspectPromptKey(aspect: DriveAspect): string {
  return `aspect:${aspect}`
}

export function primePromptKey(prime: number): string {
  return `prime:${prime}`
}

/** Combined daily drive reflection (all aspects in one modal). */
export function driveDailyPromptKey(): string {
  return 'drive:daily'
}

export function probePromptKey(trigger: 'deviation' | 'stale' | 'manual'): string {
  return `probe:${trigger}`
}

export function wasPromptedToday(
  dates: DailyPromptDates | undefined,
  key: string,
  now = Date.now()
): boolean {
  return dates?.[key] === dateKey(now)
}

export function markPromptedToday(
  dates: DailyPromptDates | undefined,
  key: string,
  now = Date.now()
): DailyPromptDates {
  return { ...(dates ?? {}), [key]: dateKey(now) }
}
