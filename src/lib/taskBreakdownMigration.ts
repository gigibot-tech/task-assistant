/**
 * Migration utilities for converting old task data to unified task breakdown system
 */

import type { Task } from '../store/taskStore'
import type { TaskBreakdownItem } from './taskBreakdownTypes'
import { migrateChecklistItem, migrateSubtask } from './taskBreakdownTypes'

/**
 * Migrate a task's old progress_checklist and subtasks to the new task_breakdown field
 * This function is idempotent - safe to call multiple times
 */
export function migrateTaskToBreakdown(task: Task): Task {
  // If already migrated, return as-is
  if (task.task_breakdown && task.task_breakdown.length > 0) {
    return task
  }

  const breakdown: TaskBreakdownItem[] = []
  let order = 0

  // Migrate progress_checklist items first (they come before subtasks in UI)
  if (task.progress_checklist && task.progress_checklist.length > 0) {
    for (const item of task.progress_checklist) {
      breakdown.push(migrateChecklistItem(item, order++))
    }
  }

  // Migrate subtasks
  if (task.subtasks && task.subtasks.length > 0) {
    for (const subtask of task.subtasks) {
      breakdown.push(migrateSubtask(subtask, order++))
    }
  }

  // Return task with new breakdown field
  return {
    ...task,
    task_breakdown: breakdown.length > 0 ? breakdown : undefined
  }
}

/**
 * Batch migrate multiple tasks
 */
export function migrateTasksToBreakdown(tasks: Task[]): Task[] {
  return tasks.map(migrateTaskToBreakdown)
}

/**
 * Check if a task needs migration
 */
export function needsMigration(task: Task): boolean {
  // Needs migration if it has old data but no new data
  const hasOldData =
    (task.progress_checklist && task.progress_checklist.length > 0) ||
    (task.subtasks && task.subtasks.length > 0)
  
  const hasNewData = task.task_breakdown && task.task_breakdown.length > 0
  
  return Boolean(hasOldData && !hasNewData)
}

/**
 * Get breakdown items for a task, migrating if necessary
 * This is the main function components should use
 */
export function getTaskBreakdown(task: Task): TaskBreakdownItem[] {
  // If task has new breakdown data, use it
  if (task.task_breakdown && task.task_breakdown.length > 0) {
    return task.task_breakdown
  }

  // Otherwise, migrate on-the-fly (doesn't persist, just for display)
  const migrated = migrateTaskToBreakdown(task)
  return migrated.task_breakdown || []
}

/**
 * Persist migration for a task
 * Call this to actually save the migrated data
 */
export async function persistMigration(
  taskId: string,
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>
): Promise<void> {
  // This will be called by components when they want to persist the migration
  // For now, we'll implement this in the component that uses it
  console.log('Persist migration for task:', taskId)
}

/**
 * Migration statistics
 */
export interface MigrationStats {
  total_tasks: number
  needs_migration: number
  already_migrated: number
  checklist_items_migrated: number
  subtasks_migrated: number
}

/**
 * Get migration statistics for a set of tasks
 */
export function getMigrationStats(tasks: Task[]): MigrationStats {
  let needsMigrationCount = 0
  let alreadyMigrated = 0
  let checklistItemsCount = 0
  let subtasksCount = 0

  for (const task of tasks) {
    if (task.task_breakdown && task.task_breakdown.length > 0) {
      alreadyMigrated++
    } else if (needsMigration(task)) {
      needsMigrationCount++
      checklistItemsCount += task.progress_checklist?.length || 0
      subtasksCount += task.subtasks?.length || 0
    }
  }

  return {
    total_tasks: tasks.length,
    needs_migration: needsMigrationCount,
    already_migrated: alreadyMigrated,
    checklist_items_migrated: checklistItemsCount,
    subtasks_migrated: subtasksCount
  }
}

// Made with Bob
