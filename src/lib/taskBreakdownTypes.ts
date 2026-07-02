/**
 * Unified Task Breakdown System
 * 
 * Consolidates the previous dual system of:
 * - progress_checklist (simple checkboxes)
 * - subtasks (complex IOT pattern)
 * 
 * Into a single, progressive disclosure model.
 */

import type { ExtractionChecks, SoftwarePhase } from './subtaskTypes'

export type TaskBreakdownItemType = 'simple' | 'technical'

export type TaskBreakdownStatus = 'pending' | 'active' | 'done' | 'blocked'

export type TaskBreakdownSource =
  | 'user'
  | 'ai_probe'
  | 'ai_suggestion'
  | 'migrated_checklist'
  | 'migrated_subtask'
  | 'prime_day'
  | 'stuck'
  | 'ai_sme'

/**
 * Technical details for complex work items
 * Uses the IOT (Input → Output → Transformation) pattern
 */
export interface TechnicalDetails {
  input: string
  output: string
  transformation: string
  outcome: string
  validated_with_real_input?: boolean
  validated_at?: string
}

/**
 * Unified task breakdown item
 * Supports both simple checklist items and complex technical work
 */
export interface TaskBreakdownItem {
  id: string
  title: string
  type: TaskBreakdownItemType
  status: TaskBreakdownStatus
  created_at: string
  source: TaskBreakdownSource
  
  // Optional: Only for technical items
  technical?: TechnicalDetails
  
  // Optional: AI estimate
  ai_estimate_minutes?: number
  
  // Optional: Software phase (for technical items)
  phase?: SoftwarePhase
  
  // Optional: Nested sub-items (max 1 level deep)
  children?: TaskBreakdownItem[]
  
  // Optional: Parent reference (for children)
  parent_id?: string
  
  // Optional: Display order
  order?: number

  // Optional: SME promotion metadata
  sme_validation_id?: string
  extraction_of_subtask_id?: string
  extraction_checks?: ExtractionChecks
}

/**
 * Migration helper: Convert old progress_checklist item to TaskBreakdownItem
 */
export function migrateChecklistItem(
  item: { id: string; label: string; done: boolean },
  order: number
): TaskBreakdownItem {
  return {
    id: item.id,
    title: item.label,
    type: 'simple',
    status: item.done ? 'done' : 'pending',
    created_at: new Date().toISOString(),
    source: 'migrated_checklist',
    order
  }
}

/**
 * Migration helper: Convert old subtask to TaskBreakdownItem
 */
export function migrateSubtask(
  subtask: {
    id: string
    title: string
    input: string
    output: string
    transformation: string
    outcome: string
    status: 'pending' | 'active' | 'done' | 'blocked'
    created_at: string
    validated_at?: string
    validated_with_real_input?: boolean
    ai_estimate_minutes?: number
    source: string
    phase?: SoftwarePhase
    sme_validation_id?: string
    extraction_of_subtask_id?: string
    extraction_checks?: ExtractionChecks
  },
  order: number
): TaskBreakdownItem {
  return {
    id: subtask.id,
    title: subtask.title,
    type: 'technical',
    status: subtask.status,
    created_at: subtask.created_at,
    source: subtask.source === 'ai_sme' ? 'ai_sme' : 'migrated_subtask',
    technical: {
      input: subtask.input,
      output: subtask.output,
      transformation: subtask.transformation,
      outcome: subtask.outcome,
      validated_with_real_input: subtask.validated_with_real_input,
      validated_at: subtask.validated_at
    },
    ai_estimate_minutes: subtask.ai_estimate_minutes,
    phase: subtask.phase,
    sme_validation_id: subtask.sme_validation_id,
    extraction_of_subtask_id: subtask.extraction_of_subtask_id,
    extraction_checks: subtask.extraction_checks,
    order
  }
}

/**
 * Helper: Check if technical details are complete
 */
export function isTechnicalComplete(technical?: TechnicalDetails): boolean {
  if (!technical) return false
  return !!(
    technical.input?.trim() &&
    technical.output?.trim() &&
    technical.transformation?.trim()
  )
}

/**
 * Helper: Build outcome string from IOT
 */
export function buildOutcome(input: string, output: string, transformation: string): string {
  const i = input.trim()
  const o = output.trim()
  const t = transformation.trim()
  if (!i || !o || !t) return ''
  return `I can get ${o} from ${i} via ${t}`
}

/**
 * Helper: Format IOT for display
 */
export function formatIot(technical: TechnicalDetails): string {
  return `${technical.input} → ${technical.output} (${technical.transformation})`
}

/**
 * Helper: Calculate progress percentage
 */
export function calculateProgress(items: TaskBreakdownItem[]): number {
  if (items.length === 0) return 0
  const doneCount = items.filter(item => item.status === 'done').length
  return Math.round((doneCount / items.length) * 100)
}

/**
 * Helper: Get all items including children (flattened)
 */
export function flattenItems(items: TaskBreakdownItem[]): TaskBreakdownItem[] {
  const result: TaskBreakdownItem[] = []
  for (const item of items) {
    result.push(item)
    if (item.children) {
      result.push(...item.children)
    }
  }
  return result
}

/**
 * Helper: Check if item can have children
 */
export function canHaveChildren(item: TaskBreakdownItem): boolean {
  // Only top-level items can have children (max 1 level deep)
  return !item.parent_id
}

// Made with Bob
