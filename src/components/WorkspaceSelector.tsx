import type { Task } from '../store/taskStore'
import {
  getActiveWorkspace,
  migrateTaskWorkspaces,
  type TaskWorkspace
} from '../lib/taskWorkspaces'

interface WorkspaceSelectorProps {
  task: Task
  onSelect: (workspaceId: string) => void
  compact?: boolean
  /** When set, highlights this workspace instead of the active workplace workspace */
  selectedId?: string | null
  alwaysSelectable?: boolean
  ariaLabel?: string
}

export default function WorkspaceSelector({
  task,
  onSelect,
  compact = false,
  selectedId,
  alwaysSelectable = false,
  ariaLabel = 'Active workspace'
}: WorkspaceSelectorProps) {
  const normalized = migrateTaskWorkspaces(task)
  const workspaces = normalized.workspaces ?? []
  const active = getActiveWorkspace(normalized)
  const selected =
    (selectedId ? workspaces.find((w) => w.id === selectedId) : null) ?? active

  if (workspaces.length <= 1 && !alwaysSelectable) {
    if (!active?.path) return null
    return (
      <p className={`text-gray-500 font-mono truncate ${compact ? 'text-[9px]' : 'text-xs'}`}>
        {active.label ?? active.path}
      </p>
    )
  }

  return (
    <div
      className={`flex flex-wrap gap-1 ${compact ? '' : 'gap-1.5'}`}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {workspaces.map((ws: TaskWorkspace) => {
        const isSelected = ws.id === selected?.id
        return (
          <button
            key={ws.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            title={ws.path}
            onClick={() => {
              if (!isSelected) onSelect(ws.id)
            }}
            className={`max-w-full truncate rounded border font-mono transition-colors ${
              compact ? 'text-[9px] px-1.5 py-0.5' : 'text-xs px-2 py-1'
            } ${
              isSelected
                ? 'border-primary-500 bg-primary-900/40 text-primary-200'
                : 'border-gray-600 bg-gray-800 text-gray-400 hover:border-gray-500 hover:text-gray-300'
            }`}
          >
            {ws.label ?? ws.path}
          </button>
        )
      })}
    </div>
  )
}
