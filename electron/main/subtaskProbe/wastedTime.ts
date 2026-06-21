import type { ThinkingBand } from '../../../src/lib/subtaskTypes'
import { DEFAULT_BAND_MINUTES } from '../../../src/lib/subtaskTypes'

export interface WastedStats {
  by_day: Record<string, number>
  by_week: Record<string, number>
  by_thinking_band: Record<string, number>
  off_task_episode_count: number
}

export function defaultWastedStats(): WastedStats {
  return {
    by_day: {},
    by_week: {},
    by_thinking_band: {},
    off_task_episode_count: 0
  }
}

function todayDateKey(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function weekKey(now = new Date()): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function bandToSeconds(
  band: ThinkingBand,
  settings?: { wastedBandMinutes?: Partial<Record<ThinkingBand, number>> }
): number {
  const minutes = settings?.wastedBandMinutes?.[band] ?? DEFAULT_BAND_MINUTES[band]
  return minutes * 60
}

export function recordWastedTime(
  settings: Record<string, unknown>,
  band: ThinkingBand,
  taskWastedSeconds?: number
): { settings: Record<string, unknown>; taskWastedSeconds: number } {
  const stats = (settings.wasted_stats as WastedStats | undefined) ?? defaultWastedStats()
  const seconds = bandToSeconds(band, settings as { wastedBandMinutes?: Partial<Record<ThinkingBand, number>> })
  const now = new Date()
  const day = todayDateKey(now)
  const week = weekKey(now)

  const next: WastedStats = {
    by_day: { ...stats.by_day, [day]: (stats.by_day[day] ?? 0) + seconds },
    by_week: { ...stats.by_week, [week]: (stats.by_week[week] ?? 0) + seconds },
    by_thinking_band: {
      ...stats.by_thinking_band,
      [band]: (stats.by_thinking_band[band] ?? 0) + seconds
    },
    off_task_episode_count: stats.off_task_episode_count
  }

  return {
    settings: { ...settings, wasted_stats: next },
    taskWastedSeconds: (taskWastedSeconds ?? 0) + seconds
  }
}

export function recordOffTaskEpisode(settings: Record<string, unknown>, extraSeconds = 300): Record<string, unknown> {
  const stats = (settings.wasted_stats as WastedStats | undefined) ?? defaultWastedStats()
  const now = new Date()
  const day = todayDateKey(now)
  const week = weekKey(now)

  const next: WastedStats = {
    ...stats,
    by_day: { ...stats.by_day, [day]: (stats.by_day[day] ?? 0) + extraSeconds },
    by_week: { ...stats.by_week, [week]: (stats.by_week[week] ?? 0) + extraSeconds },
    off_task_episode_count: stats.off_task_episode_count + 1
  }

  return { ...settings, wasted_stats: next }
}
