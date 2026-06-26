import type { FileReviewStatus, ReviewSchedule } from '../../types/review'

export interface WorkplaceIndex {
  indexed_at: string
  file_count: number
  tree_text: string
  relative_paths?: string[]
}

export interface TaskWorkspace {
  id: string
  label?: string
  path: string
  workplace_index?: WorkplaceIndex
  review_statuses?: Record<string, FileReviewStatus>
  review_schedule?: ReviewSchedule
}

export interface TaskWithWorkspaces {
  id?: string
  workspaces?: TaskWorkspace[]
  active_workspace_id?: string | null
  workplace_folder?: string | null
  workplace_index?: WorkplaceIndex
  review_statuses?: Record<string, FileReviewStatus>
  review_schedule?: ReviewSchedule
}

function newWorkspaceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `ws-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function defaultWorkspaceLabel(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const base = trimmed.split('/').pop()
  return base || trimmed || 'Workspace'
}

function getActiveWorkspaceRaw(task: TaskWithWorkspaces): TaskWorkspace | null {
  const list = task.workspaces ?? []
  if (!list.length) return null
  const activeId = task.active_workspace_id
  return list.find((w) => w.id === activeId) ?? list[0]
}

export function syncLegacyFromActive(task: TaskWithWorkspaces): TaskWithWorkspaces {
  const active = getActiveWorkspaceRaw(task)
  if (!active) {
    return {
      ...task,
      workplace_folder: null,
      workplace_index: undefined,
      review_statuses: undefined,
      review_schedule: undefined
    }
  }
  return {
    ...task,
    workplace_folder: active.path,
    workplace_index: active.workplace_index,
    review_statuses: active.review_statuses,
    review_schedule: active.review_schedule
  }
}

export function migrateTaskWorkspaces(task: TaskWithWorkspaces): TaskWithWorkspaces {
  if (task.workspaces && task.workspaces.length > 0) {
    const activeId = task.active_workspace_id
    const hasActive = task.workspaces.some((w) => w.id === activeId)
    const normalized = hasActive
      ? task
      : { ...task, active_workspace_id: task.workspaces[0].id }
    return syncLegacyFromActive(normalized)
  }

  const path = task.workplace_folder?.trim()
  if (!path) {
    return syncLegacyFromActive({ ...task, workspaces: [], active_workspace_id: null })
  }

  const ws: TaskWorkspace = {
    id: newWorkspaceId(),
    label: defaultWorkspaceLabel(path),
    path,
    workplace_index: task.workplace_index,
    review_statuses: task.review_statuses,
    review_schedule: task.review_schedule
  }

  return syncLegacyFromActive({
    ...task,
    workspaces: [ws],
    active_workspace_id: ws.id
  })
}

export function normalizeTaskWorkspaces<T extends TaskWithWorkspaces>(task: T): T {
  return migrateTaskWorkspaces(task) as T
}

export function getActiveWorkspace(task: TaskWithWorkspaces): TaskWorkspace | null {
  return getActiveWorkspaceRaw(migrateTaskWorkspaces(task))
}

export function getActiveWorkplacePath(task: TaskWithWorkspaces): string | null {
  const active = getActiveWorkspace(task)
  const path = active?.path?.trim()
  return path || null
}

export function setActiveWorkspace(
  task: TaskWithWorkspaces,
  workspaceId: string
): TaskWithWorkspaces {
  const migrated = migrateTaskWorkspaces(task)
  const exists = migrated.workspaces?.some((w) => w.id === workspaceId)
  if (!exists) return migrated
  return syncLegacyFromActive({ ...migrated, active_workspace_id: workspaceId })
}

export function addWorkspace(
  task: TaskWithWorkspaces,
  path: string,
  options?: { id?: string; label?: string; makeActive?: boolean }
): TaskWithWorkspaces {
  const migrated = migrateTaskWorkspaces(task)
  const trimmed = path.trim()
  if (!trimmed) return migrated

  const id = options?.id ?? newWorkspaceId()
  const ws: TaskWorkspace = {
    id,
    label: options?.label ?? defaultWorkspaceLabel(trimmed),
    path: trimmed
  }

  const duplicate = migrated.workspaces?.some((w) => w.path === trimmed)
  if (duplicate) return migrated

  const workspaces = [...(migrated.workspaces ?? []), ws]
  const makeActive = options?.makeActive !== false

  return syncLegacyFromActive({
    ...migrated,
    workspaces,
    active_workspace_id: makeActive ? id : migrated.active_workspace_id ?? id
  })
}

export function removeWorkspace(
  task: TaskWithWorkspaces,
  workspaceId: string
): TaskWithWorkspaces {
  const migrated = migrateTaskWorkspaces(task)
  const workspaces = (migrated.workspaces ?? []).filter((w) => w.id !== workspaceId)
  let activeId = migrated.active_workspace_id ?? null
  if (activeId === workspaceId) {
    activeId = workspaces[0]?.id ?? null
  }
  return syncLegacyFromActive({ ...migrated, workspaces, active_workspace_id: activeId })
}

export function updateWorkspacePath(
  task: TaskWithWorkspaces,
  workspaceId: string,
  path: string
): TaskWithWorkspaces {
  const trimmed = path.trim()
  const migrated = migrateTaskWorkspaces(task)
  const workspaces = (migrated.workspaces ?? []).map((w) => {
    if (w.id !== workspaceId) return w
    return {
      ...w,
      path: trimmed,
      label: defaultWorkspaceLabel(trimmed),
      workplace_index: undefined
    }
  })
  return syncLegacyFromActive({ ...migrated, workspaces })
}

export function mergeTaskUpdate(
  task: TaskWithWorkspaces,
  updates: Partial<TaskWithWorkspaces>
): TaskWithWorkspaces {
  let merged: TaskWithWorkspaces = { ...migrateTaskWorkspaces(task), ...updates }

  if ('workspaces' in updates || 'active_workspace_id' in updates) {
    merged = migrateTaskWorkspaces(merged)
  }

  const touchesLegacyWorkspaceFields =
    'workplace_folder' in updates ||
    'workplace_index' in updates ||
    'review_statuses' in updates ||
    'review_schedule' in updates

  if (touchesLegacyWorkspaceFields) {
    const activeId = merged.active_workspace_id ?? merged.workspaces?.[0]?.id
    if (activeId && merged.workspaces?.length) {
      merged.workspaces = merged.workspaces.map((w) => {
        if (w.id !== activeId) return w
        const next = { ...w }
        if ('workplace_folder' in updates) {
          const nextPath = (updates.workplace_folder ?? w.path).trim()
          next.path = nextPath
          next.label = defaultWorkspaceLabel(nextPath)
          if (updates.workplace_folder !== w.path) {
            next.workplace_index = updates.workplace_index ?? undefined
          }
        }
        if ('workplace_index' in updates) {
          next.workplace_index = updates.workplace_index
        }
        if ('review_statuses' in updates) {
          next.review_statuses = updates.review_statuses
        }
        if ('review_schedule' in updates) {
          next.review_schedule = updates.review_schedule
        }
        return next
      })
    }
  }

  return syncLegacyFromActive(merged)
}
