/**
 * Adapter layer: task_breakdown is the single source of truth.
 * Maps breakdown items to legacy subtask shapes for electron focus/probe code.
 */

import type { Task } from '../store/taskStore'
import type { TaskBreakdownItem, TaskBreakdownSource } from './taskBreakdownTypes'
import { buildOutcome, isTechnicalComplete } from './taskBreakdownTypes'
import { migrateTaskToBreakdown, needsMigration } from './taskBreakdownMigration'
import type {
  ExtractionChecks,
  SoftwarePhase,
  SubtaskSource,
  TaskSubtask
} from './subtaskTypes'

/** Shape expected by electron focus/probe prompts */
export interface SubtaskRecord {
  id: string
  title: string
  input?: string
  output?: string
  transformation?: string
  outcome?: string
  status?: string
  phase?: string
  validated_with_real_input?: boolean
  sme_validation_id?: string
  extraction_of_subtask_id?: string
}

export function resolveTaskBreakdown(task: Task): TaskBreakdownItem[] {
  return migrateTaskToBreakdown(task).task_breakdown ?? []
}

export function buildMigrationPatch(task: Task): Partial<Task> | null {
  if (!needsMigration(task)) return null
  const migrated = migrateTaskToBreakdown(task)
  return { task_breakdown: migrated.task_breakdown }
}

export function breakdownItemToSubtaskRecord(item: TaskBreakdownItem): SubtaskRecord | null {
  if (item.type !== 'technical' || !item.technical) return null
  return {
    id: item.id,
    title: item.title,
    input: item.technical.input,
    output: item.technical.output,
    transformation: item.technical.transformation,
    outcome: item.technical.outcome,
    status: item.status,
    phase: item.phase,
    validated_with_real_input: item.technical.validated_with_real_input,
    sme_validation_id: item.sme_validation_id,
    extraction_of_subtask_id: item.extraction_of_subtask_id
  }
}

export function breakdownToSubtaskRecords(items: TaskBreakdownItem[]): SubtaskRecord[] {
  return items
    .map(breakdownItemToSubtaskRecord)
    .filter((r): r is SubtaskRecord => r != null)
}

export function breakdownItemToTaskSubtask(item: TaskBreakdownItem): TaskSubtask | null {
  const record = breakdownItemToSubtaskRecord(item)
  if (!record || !item.technical) return null
  return {
    id: record.id,
    title: record.title,
    input: record.input ?? '',
    output: record.output ?? '',
    transformation: record.transformation ?? '',
    outcome: record.outcome ?? '',
    status: (record.status as TaskSubtask['status']) ?? 'pending',
    created_at: item.created_at,
    validated_at: item.technical.validated_at,
    validated_with_real_input: item.technical.validated_with_real_input,
    ai_estimate_minutes: item.ai_estimate_minutes,
    source: (item.source === 'migrated_subtask' ? 'user' : item.source) as SubtaskSource,
    phase: item.phase,
    sme_validation_id: item.sme_validation_id,
    extraction_of_subtask_id: item.extraction_of_subtask_id,
    extraction_checks: item.extraction_checks
  }
}

export function breakdownToTaskSubtasks(items: TaskBreakdownItem[]): TaskSubtask[] {
  return items
    .map(breakdownItemToTaskSubtask)
    .filter((s): s is TaskSubtask => s != null)
}

export function getActiveBreakdownItem(task: Task): TaskBreakdownItem | null {
  const items = resolveTaskBreakdown(task)
  const activeId = task.active_subtask_id
  if (!activeId) return null
  return items.find((i) => i.id === activeId) ?? null
}

export function isBreakdownItemReady(item: TaskBreakdownItem): boolean {
  if (item.type === 'simple') return true
  return isTechnicalComplete(item.technical)
}

export function deactivateAllBreakdownItems(items: TaskBreakdownItem[]): TaskBreakdownItem[] {
  return items.map((i) => ({
    ...i,
    status: i.status === 'active' ? ('pending' as const) : i.status
  }))
}

export function setActiveBreakdownItem(
  items: TaskBreakdownItem[],
  itemId: string
): TaskBreakdownItem[] {
  return items.map((i) => ({
    ...i,
    status: (i.id === itemId
      ? 'active'
      : i.status === 'active'
        ? 'pending'
        : i.status) as TaskBreakdownItem['status']
  }))
}

export function createTechnicalBreakdownItem(opts: {
  id: string
  title: string
  input: string
  output: string
  transformation: string
  outcome?: string
  status?: TaskBreakdownItem['status']
  source: TaskBreakdownSource
  phase?: SoftwarePhase
  order?: number
  sme_validation_id?: string
  extraction_of_subtask_id?: string
  extraction_checks?: ExtractionChecks
  ai_estimate_minutes?: number
}): TaskBreakdownItem {
  const input = opts.input.trim()
  const output = opts.output.trim()
  const transformation = opts.transformation.trim()
  return {
    id: opts.id,
    title: opts.title.trim(),
    type: 'technical',
    status: opts.status ?? 'pending',
    created_at: new Date().toISOString(),
    source: opts.source,
    order: opts.order,
    phase: opts.phase,
    sme_validation_id: opts.sme_validation_id,
    extraction_of_subtask_id: opts.extraction_of_subtask_id,
    extraction_checks: opts.extraction_checks,
    ai_estimate_minutes: opts.ai_estimate_minutes,
    technical: {
      input,
      output,
      transformation,
      outcome: opts.outcome?.trim() || buildOutcome(input, output, transformation)
    }
  }
}

export function subtaskToBreakdownItem(subtask: TaskSubtask, order?: number): TaskBreakdownItem {
  return createTechnicalBreakdownItem({
    id: subtask.id,
    title: subtask.title,
    input: subtask.input,
    output: subtask.output,
    transformation: subtask.transformation,
    outcome: subtask.outcome,
    status: subtask.status,
    source: subtask.source === 'ai_sme' ? 'ai_sme' : (subtask.source as TaskBreakdownSource),
    phase: subtask.phase,
    order,
    sme_validation_id: subtask.sme_validation_id,
    extraction_of_subtask_id: subtask.extraction_of_subtask_id,
    extraction_checks: subtask.extraction_checks,
    ai_estimate_minutes: subtask.ai_estimate_minutes
  })
}

export function upsertBreakdownFromProbe(
  existing: TaskBreakdownItem[],
  newItem: TaskBreakdownItem,
  activeId: string
): TaskBreakdownItem[] {
  const deactivated = deactivateAllBreakdownItems(existing)
  const withoutDup = deactivated.filter((i) => i.id !== newItem.id)
  return [...withoutDup, { ...newItem, id: activeId, status: 'active', order: existing.length }]
}

export function taskSubtaskContextFromBreakdown(task: {
  title: string
  description?: string
  task_breakdown?: TaskBreakdownItem[]
  subtasks?: TaskSubtask[]
  active_subtask_id?: string | null
  work_phase?: string
}) {
  const asTask = task as Task
  const items = task.task_breakdown?.length
    ? task.task_breakdown
    : resolveTaskBreakdown(asTask)
  const records = breakdownToSubtaskRecords(items)
  const activeSubtask =
    records.find((s) => s.id === task.active_subtask_id) ?? null

  return {
    title: task.title,
    description: task.description,
    subtasks: records,
    activeSubtask,
    work_phase: task.work_phase
  }
}
