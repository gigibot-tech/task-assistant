/**
 * File Review Tracking System - Type Definitions
 * Phase 1: Foundation
 */

/**
 * Review status for a single file
 */
export interface FileReviewStatus {
  /** Relative path from worktree root */
  filePath: string
  /** Whether the file has been reviewed */
  reviewed: boolean
  /** When the file was marked as reviewed (ISO 8601) */
  reviewedAt?: string
  /** Optional notes about the review */
  notes?: string[]
  /** Scheduled review date (YYYY-MM-DD) */
  scheduledDate?: string
  /** Whether this file/dir is hidden from the review tree */
  hidden?: boolean
  /** File metadata */
  metadata?: {
    size: number
    extension: string
    lastModified?: string
  }
}

/**
 * AI-generated review schedule for a task
 */
export interface ReviewSchedule {
  /** When the schedule was generated (ISO 8601) */
  generatedAt: string
  /** Total number of files to review */
  totalFiles: number
  /** Estimated days to complete */
  estimatedDays: number
  /** Daily file assignments: date (YYYY-MM-DD) -> file paths */
  dailyAssignments: Record<string, string[]>
  /** AI analysis summary */
  analysis?: {
    complexity: 'low' | 'medium' | 'high'
    recommendedFilesPerDay: number
    priorityFiles: string[]
  }
}

/**
 * A single review session
 */
export interface ReviewSession {
  /** Unique session ID */
  id: string
  /** When the session started (ISO 8601) */
  startedAt: string
  /** When the session ended (ISO 8601) */
  endedAt?: string
  /** Files reviewed in this session */
  filesReviewed: string[]
  /** Session notes */
  notes?: string
}

/**
 * Aggregated review statistics
 */
export interface ReviewStatistics {
  /** Total files in worktree */
  totalFiles: number
  /** Files marked as reviewed */
  reviewedFiles: number
  /** Files not yet reviewed */
  pendingFiles: number
  /** Review completion percentage (0-100) */
  completionPercent: number
  /** Files scheduled for today */
  scheduledToday: number
  /** Overdue files (scheduled before today but not reviewed) */
  overdueFiles: number
  /** Average files reviewed per day */
  averagePerDay: number
  /** Days since first review */
  daysSinceStart: number
  /** Estimated days remaining */
  estimatedDaysRemaining: number
}

/**
 * Calculate review statistics from file statuses
 */
export function calculateReviewStats(
  statuses: Map<string, FileReviewStatus>,
  schedule?: ReviewSchedule,
  totalFilesOverride?: number
): ReviewStatistics {
  const totalFiles = totalFilesOverride ?? statuses.size
  const reviewedFiles = Array.from(statuses.values()).filter(s => s.reviewed).length
  const pendingFiles = totalFiles - reviewedFiles
  const completionPercent = totalFiles > 0 ? Math.round((reviewedFiles / totalFiles) * 100) : 0

  const today = new Date().toISOString().split('T')[0]
  const scheduledToday = schedule?.dailyAssignments[today]?.length ?? 0

  // Calculate overdue files
  let overdueFiles = 0
  if (schedule) {
    const todayDate = new Date(today)
    for (const [date, files] of Object.entries(schedule.dailyAssignments)) {
      const schedDate = new Date(date)
      if (schedDate < todayDate) {
        // Count files from past dates that aren't reviewed
        overdueFiles += files.filter(path => {
          const status = statuses.get(path)
          return status && !status.reviewed
        }).length
      }
    }
  }

  // Calculate days since first review
  const reviewDates = Array.from(statuses.values())
    .filter(s => s.reviewedAt)
    .map(s => new Date(s.reviewedAt!).getTime())
  
  const daysSinceStart = reviewDates.length > 0
    ? Math.ceil((Date.now() - Math.min(...reviewDates)) / (1000 * 60 * 60 * 24))
    : 0

  const averagePerDay = daysSinceStart > 0 ? reviewedFiles / daysSinceStart : 0
  const estimatedDaysRemaining = averagePerDay > 0
    ? Math.ceil(pendingFiles / averagePerDay)
    : schedule?.estimatedDays ?? 0

  return {
    totalFiles,
    reviewedFiles,
    pendingFiles,
    completionPercent,
    scheduledToday,
    overdueFiles,
    averagePerDay: Math.round(averagePerDay * 10) / 10,
    daysSinceStart,
    estimatedDaysRemaining
  }
}

/**
 * Get files scheduled for a specific date
 */
export function getFilesForDate(
  schedule: ReviewSchedule | undefined,
  date: string
): string[] {
  if (!schedule) return []
  return schedule.dailyAssignments[date] ?? []
}

/**
 * Check if a file is overdue for review
 */
export function isOverdue(
  status: FileReviewStatus,
  today: string = new Date().toISOString().split('T')[0]
): boolean {
  if (status.reviewed) return false
  if (!status.scheduledDate) return false
  return status.scheduledDate < today
}

export type ReviewStatusColor = 'reviewed' | 'overdue' | 'due_soon' | 'due_later' | 'unscheduled'

export function getReviewStatusColor(
  status: FileReviewStatus,
  today: string = new Date().toISOString().split('T')[0]
): ReviewStatusColor {
  if (status.reviewed) return 'reviewed'
  if (!status.scheduledDate) return 'unscheduled'
  if (status.scheduledDate <= today) return 'overdue'

  const todayMs = new Date(today).getTime()
  const schedMs = new Date(status.scheduledDate).getTime()
  const diffDays = Math.round((schedMs - todayMs) / (1000 * 60 * 60 * 24))
  if (diffDays <= 2) return 'due_soon'
  return 'due_later'
}

export const REVIEW_STATUS_COLORS: Record<
  ReviewStatusColor,
  { bg: string; text: string; border: string; label: string }
> = {
  reviewed: {
    bg: 'bg-blue-900/20',
    text: 'text-blue-300/90',
    border: 'border-blue-700/40',
    label: 'Reviewed'
  },
  overdue: {
    bg: 'bg-red-900/20',
    text: 'text-red-300/90',
    border: 'border-red-700/40',
    label: 'Due today / overdue'
  },
  due_soon: {
    bg: 'bg-yellow-900/15',
    text: 'text-yellow-300/90',
    border: 'border-yellow-700/40',
    label: 'Due soon'
  },
  due_later: {
    bg: 'bg-green-900/15',
    text: 'text-green-300/80',
    border: 'border-green-700/30',
    label: 'Scheduled later'
  },
  unscheduled: {
    bg: '',
    text: 'text-gray-300',
    border: '',
    label: 'Unscheduled'
  }
}

/**
 * Get files by review status
 */
export function getFilesByStatus(
  statuses: Map<string, FileReviewStatus>,
  filter: 'all' | 'reviewed' | 'pending' | 'overdue',
  today: string = new Date().toISOString().split('T')[0]
): FileReviewStatus[] {
  const allStatuses = Array.from(statuses.values())
  
  switch (filter) {
    case 'reviewed':
      return allStatuses.filter(s => s.reviewed)
    case 'pending':
      return allStatuses.filter(s => !s.reviewed)
    case 'overdue':
      return allStatuses.filter(s => isOverdue(s, today))
    case 'all':
    default:
      return allStatuses
  }
}

// Made with Bob
