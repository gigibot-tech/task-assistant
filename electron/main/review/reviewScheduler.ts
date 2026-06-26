import { ollamaGenerate, parseJsonResponse } from '../ollamaClient'
import { getOllamaNumPredict } from '../ollamaSettings'
import type { ReviewFileEntry } from './reviewIndexer'

export interface ReviewScheduleResult {
  generatedAt: string
  totalFiles: number
  estimatedDays: number
  dailyAssignments: Record<string, string[]>
  analysis?: {
    complexity: 'low' | 'medium' | 'high'
    recommendedFilesPerDay: number
    priorityFiles: string[]
  }
}

function addDays(base: Date, days: number): string {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function roundRobinSchedule(
  filePaths: string[],
  days: number,
  startDate = new Date()
): ReviewScheduleResult {
  const dailyAssignments: Record<string, string[]> = {}
  for (let i = 0; i < days; i++) {
    dailyAssignments[addDays(startDate, i)] = []
  }

  const dates = Object.keys(dailyAssignments).sort()
  filePaths.forEach((filePath, index) => {
    const date = dates[index % dates.length]
    dailyAssignments[date].push(filePath)
  })

  const perDay = Math.ceil(filePaths.length / Math.max(1, days))

  return {
    generatedAt: new Date().toISOString(),
    totalFiles: filePaths.length,
    estimatedDays: days,
    dailyAssignments,
    analysis: {
      complexity: filePaths.length > 80 ? 'high' : filePaths.length > 30 ? 'medium' : 'low',
      recommendedFilesPerDay: perDay,
      priorityFiles: filePaths.slice(0, Math.min(5, filePaths.length))
    }
  }
}

function summarizeFilesForPrompt(files: ReviewFileEntry[], max = 120): string {
  return files
    .slice(0, max)
    .map((f) => `${f.path} (${f.extension}, ${f.size}b)`)
    .join('\n')
}

export async function generateReviewSchedule(
  model: string,
  files: ReviewFileEntry[],
  daysAvailable: number,
  settings?: Record<string, unknown>
): Promise<ReviewScheduleResult> {
  const days = Math.min(30, Math.max(1, Math.round(daysAvailable)))
  const paths = files.map((f) => f.path)
  if (paths.length === 0) {
    return roundRobinSchedule([], days)
  }

  const startDate = new Date()
  const dateKeys = Array.from({ length: days }, (_, i) => addDays(startDate, i))

  const prompt = `You are a code review planner. Distribute files across ${days} review days.
Group related files (same directory) on the same day when possible.
Put critical source files earlier.

Files (${paths.length} total, sample below):
${summarizeFilesForPrompt(files)}

Review dates: ${dateKeys.join(', ')}

Respond with JSON only:
{
  "complexity": "low|medium|high",
  "recommendedFilesPerDay": number,
  "priorityFiles": ["path1"],
  "dailyAssignments": {
    "${dateKeys[0]}": ["relative/path.ts"]
  }
}

Every file path must appear exactly once across all dates. Use only paths from the list.`

  try {
    const raw = await ollamaGenerate(model, prompt, undefined, {
      numPredict: getOllamaNumPredict(settings, 'text'),
      showErrorDialog: false
    })
    const parsed = parseJsonResponse<{
      complexity?: string
      recommendedFilesPerDay?: number
      priorityFiles?: string[]
      dailyAssignments?: Record<string, string[]>
    }>(raw)

    const dailyAssignments: Record<string, string[]> = {}
    for (const date of dateKeys) {
      dailyAssignments[date] = []
    }

    const validPaths = new Set(paths)
    const assigned = new Set<string>()

    if (parsed.dailyAssignments && typeof parsed.dailyAssignments === 'object') {
      for (const [date, list] of Object.entries(parsed.dailyAssignments)) {
        if (!dailyAssignments[date]) continue
        for (const p of list ?? []) {
          if (!validPaths.has(p) || assigned.has(p)) continue
          dailyAssignments[date].push(p)
          assigned.add(p)
        }
      }
    }

    for (const p of paths) {
      if (assigned.has(p)) continue
      const smallest = dateKeys.reduce((a, b) =>
        (dailyAssignments[a]?.length ?? 0) <= (dailyAssignments[b]?.length ?? 0) ? a : b
      )
      dailyAssignments[smallest].push(p)
      assigned.add(p)
    }

    const complexity =
      parsed.complexity === 'low' || parsed.complexity === 'high'
        ? parsed.complexity
        : 'medium'

    return {
      generatedAt: new Date().toISOString(),
      totalFiles: paths.length,
      estimatedDays: days,
      dailyAssignments,
      analysis: {
        complexity,
        recommendedFilesPerDay:
          typeof parsed.recommendedFilesPerDay === 'number'
            ? parsed.recommendedFilesPerDay
            : Math.ceil(paths.length / days),
        priorityFiles: (parsed.priorityFiles ?? []).filter((p) => validPaths.has(p)).slice(0, 10)
      }
    }
  } catch (err) {
    console.warn('[review] LLM schedule failed, using round-robin:', err)
    return roundRobinSchedule(paths, days, startDate)
  }
}

export function applyScheduleToStatuses(
  reviewStatuses: Record<string, Record<string, unknown>>,
  schedule: ReviewScheduleResult
): Record<string, Record<string, unknown>> {
  const next = { ...reviewStatuses }

  for (const [date, filePaths] of Object.entries(schedule.dailyAssignments)) {
    for (const filePath of filePaths) {
      const existing = next[filePath] ?? { filePath, reviewed: false }
      next[filePath] = {
        ...existing,
        filePath,
        scheduledDate: date
      }
    }
  }

  return next
}
