import { useEffect, useState } from 'react'
import type { Task } from '../store/taskStore'
import {
  PHASE_LABELS,
  type SoftwarePhase
} from '../features/softwarePhases/types'
import { isFeatureEnabled, type FeatureFlags } from '../features/types'
import { syncPhaseGitSignals } from '../lib/electron-api'
import {
  addWorkspace,
  getActiveWorkspace,
  migrateTaskWorkspaces,
  removeWorkspace,
  setActiveWorkspace,
  updateWorkspacePath
} from '../lib/taskWorkspaces'
import WorkspaceSelector from './WorkspaceSelector'

interface WorkplacePanelProps {
  task: Task
  flags?: FeatureFlags
  onUpdate: (updates: Partial<Task>) => Promise<void>
  compact?: boolean
}

export default function WorkplacePanel({
  task,
  flags,
  onUpdate,
  compact = false
}: WorkplacePanelProps) {
  const normalized = migrateTaskWorkspaces(task)
  const active = getActiveWorkspace(normalized)
  const [folder, setFolder] = useState(active?.path ?? '')
  const [indexing, setIndexing] = useState(false)
  const [guidanceLoading, setGuidanceLoading] = useState(false)
  const [gitSyncing, setGitSyncing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const showGitSync = flags && isFeatureEnabled(flags, 'phaseGitSignals')
  const workspaceCount = normalized.workspaces?.length ?? 0

  useEffect(() => {
    setFolder(getActiveWorkspace(migrateTaskWorkspaces(task))?.path ?? '')
  }, [task.id, task.active_workspace_id, task.workspaces, task.workplace_folder])

  const applyTaskPatch = async (patch: Partial<Task>) => {
    await onUpdate(patch)
  }

  const selectWorkspace = async (workspaceId: string) => {
    const next = setActiveWorkspace(normalized, workspaceId)
    await applyTaskPatch({
      workspaces: next.workspaces,
      active_workspace_id: next.active_workspace_id,
      workplace_folder: next.workplace_folder,
      workplace_index: next.workplace_index,
      review_statuses: next.review_statuses,
      review_schedule: next.review_schedule
    })
    setMessage('Active workspace switched.')
  }

  const pickFolder = async (makeActive = true) => {
    if (!window.electron?.pickWorkplaceFolder) {
      setMessage('Restart the app (Cmd+Q) to enable workplace folder picker.')
      return
    }
    const result = await window.electron.pickWorkplaceFolder()
    if (!result.path) return

    if (makeActive && active) {
      const next = updateWorkspacePath(normalized, active.id, result.path)
      await applyTaskPatch({
        workspaces: next.workspaces,
        active_workspace_id: next.active_workspace_id,
        workplace_folder: next.workplace_folder,
        workplace_index: undefined,
        review_statuses: next.review_statuses,
        review_schedule: next.review_schedule
      })
      setFolder(result.path)
      setMessage('Folder updated — refresh index to scan files.')
      return
    }

    const next = addWorkspace(normalized, result.path, { makeActive: true })
    await applyTaskPatch({
      workspaces: next.workspaces,
      active_workspace_id: next.active_workspace_id,
      workplace_folder: next.workplace_folder,
      workplace_index: undefined,
      review_statuses: next.review_statuses,
      review_schedule: next.review_schedule
    })
    setFolder(result.path)
    setMessage('Workspace added — refresh index to scan files.')
  }

  const addAnotherWorkspace = async () => {
    await pickFolder(false)
  }

  const removeActiveWorkspace = async () => {
    if (!active || workspaceCount <= 1) return
    const next = removeWorkspace(normalized, active.id)
    await applyTaskPatch({
      workspaces: next.workspaces,
      active_workspace_id: next.active_workspace_id,
      workplace_folder: next.workplace_folder,
      workplace_index: next.workplace_index,
      review_statuses: next.review_statuses,
      review_schedule: next.review_schedule
    })
    setFolder(getActiveWorkspace(next)?.path ?? '')
    setMessage('Workspace removed.')
  }

  const saveFolder = async () => {
    if (!active) {
      const trimmed = folder.trim()
      if (!trimmed) {
        await applyTaskPatch({
          workspaces: [],
          active_workspace_id: null,
          workplace_folder: null,
          workplace_index: undefined
        })
        setMessage('Workplace cleared.')
        return
      }
      const next = addWorkspace(normalized, trimmed, { makeActive: true })
      await applyTaskPatch({
        workspaces: next.workspaces,
        active_workspace_id: next.active_workspace_id,
        workplace_folder: next.workplace_folder,
        workplace_index: undefined
      })
      setMessage('Workspace saved.')
      return
    }

    const trimmed = folder.trim()
    const next = updateWorkspacePath(normalized, active.id, trimmed)
    await applyTaskPatch({
      workspaces: next.workspaces,
      active_workspace_id: next.active_workspace_id,
      workplace_folder: next.workplace_folder,
      workplace_index: trimmed ? task.workplace_index : undefined
    })
    setMessage(trimmed ? 'Workplace path saved.' : 'Workplace cleared.')
  }

  const refreshIndex = async () => {
    if (!window.electron?.indexWorkplace) return
    setIndexing(true)
    setMessage(null)
    try {
      const index = await window.electron.indexWorkplace(task.id)
      await onUpdate({ workplace_index: index })
      setMessage(`Indexed ${index.file_count} files.`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Index failed')
    } finally {
      setIndexing(false)
    }
  }

  const syncGit = async () => {
    if (!showGitSync) return
    setGitSyncing(true)
    setMessage(null)
    try {
      const result = await syncPhaseGitSignals(task.id)
      await onUpdate({
        phase_balance: result.phase_balance as Task['phase_balance']
      })
      if (result.git_available) {
        setMessage(
          `Git suggests ${PHASE_LABELS[result.suggested_phase as SoftwarePhase] ?? result.suggested_phase} (${Math.round(result.confidence * 100)}%)`
        )
      } else {
        setMessage('No git repo in active workspace.')
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Git sync failed')
    } finally {
      setGitSyncing(false)
    }
  }

  const fetchGuidance = async (force = false) => {
    if (!window.electron?.getWorkplaceGuidance) return
    setGuidanceLoading(true)
    setMessage(null)
    try {
      const guidance = await window.electron.getWorkplaceGuidance(task.id, force)
      if (guidance) {
        await onUpdate({ workplace_guidance: guidance })
        setMessage('Workplace guidance updated.')
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Guidance failed')
    } finally {
      setGuidanceLoading(false)
    }
  }

  const openFile = async (relativePath: string) => {
    if (!window.electron?.openWorkplacePath) return
    const result = await window.electron.openWorkplacePath(task.id, relativePath)
    if (!result.success && result.error) {
      setMessage(result.error)
    }
  }

  return (
    <div className={`bg-gray-800 rounded-lg border border-gray-600/80 ${compact ? 'p-3' : 'p-4'}`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between mb-2 hover:text-gray-300 transition-colors"
      >
        <span className="text-xs text-gray-500 uppercase tracking-wide">
          Workspaces {expanded ? '▾' : '▸'}
          {workspaceCount > 1 && (
            <span className="text-gray-600 normal-case ml-1">({workspaceCount})</span>
          )}
        </span>
        {task.workplace_index && (
          <span className="text-xs text-gray-500">
            {task.workplace_index.file_count} files indexed
          </span>
        )}
      </button>

      {expanded && (
        <>
          <p className="text-xs text-gray-500 mb-2">
            One active workspace at a time — used for AI context, git sync, and file review.
          </p>

          {workspaceCount > 0 && (
            <div className="mb-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Active workspace</p>
              <WorkspaceSelector task={task} onSelect={(id) => void selectWorkspace(id)} />
            </div>
          )}

          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="/path/to/project"
              className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm font-mono truncate"
            />
            <button
              type="button"
              onClick={() => void pickFolder(true)}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs whitespace-nowrap"
            >
              Browse
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveFolder()}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs"
            >
              Save path
            </button>
            <button
              type="button"
              onClick={() => void refreshIndex()}
              disabled={!folder.trim() || indexing}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs disabled:opacity-50"
            >
              {indexing ? 'Indexing…' : 'Refresh index'}
            </button>
            <button
              type="button"
              onClick={() => void addAnotherWorkspace()}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs"
            >
              Add workspace
            </button>
            {workspaceCount > 1 && active && (
              <button
                type="button"
                onClick={() => void removeActiveWorkspace()}
                className="px-3 py-1.5 bg-red-900/30 hover:bg-red-900/50 text-red-300 rounded text-xs"
              >
                Remove active
              </button>
            )}
            {showGitSync && (
              <button
                type="button"
                onClick={() => void syncGit()}
                disabled={!folder.trim() || gitSyncing}
                className="px-3 py-1.5 bg-teal-900/40 hover:bg-teal-800/60 text-teal-200 rounded text-xs disabled:opacity-50"
              >
                {gitSyncing ? 'Syncing git…' : 'Sync git phase'}
              </button>
            )}
            {!compact && (
              <button
                type="button"
                onClick={() => void fetchGuidance(true)}
                disabled={!folder.trim() || guidanceLoading}
                className="px-3 py-1.5 bg-indigo-900/50 hover:bg-indigo-800/50 text-indigo-200 rounded text-xs disabled:opacity-50"
              >
                {guidanceLoading ? 'Thinking…' : 'Get guidance now'}
              </button>
            )}
          </div>

          {task.workplace_index?.indexed_at && (
            <p className="text-xs text-gray-600 mt-2">
              Last indexed {new Date(task.workplace_index.indexed_at).toLocaleString()}
            </p>
          )}

          {task.phase_balance?.last_git_sync_at && showGitSync && (
            <p className="text-xs text-gray-600 mt-1">
              Last git sync {new Date(task.phase_balance.last_git_sync_at).toLocaleString()}
              {task.phase_balance.git_suggested_phase && (
                <span className="text-teal-400/80 ml-1">
                  → {PHASE_LABELS[task.phase_balance.git_suggested_phase as SoftwarePhase]}
                </span>
              )}
            </p>
          )}

          {task.last_on_task_capture && (
            <p className="text-xs text-gray-600 mt-1">
              Last on-task capture:{' '}
              {new Date(task.last_on_task_capture.capturedAt).toLocaleString()}
            </p>
          )}

          {task.workplace_guidance && !compact && (
            <div className="mt-3 pt-3 border-t border-gray-700">
              <p className="text-xs text-indigo-300 font-medium mb-1">Latest guidance</p>
              <p className="text-sm text-gray-300">{task.workplace_guidance.summary}</p>
              {task.workplace_guidance.suggested_files?.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {task.workplace_guidance.suggested_files.map((f) => (
                    <li key={f.path}>
                      <button
                        type="button"
                        onClick={() => void openFile(f.path)}
                        className="text-xs text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline text-left"
                      >
                        {f.path}
                      </button>
                      {f.reason && <span className="text-gray-500 text-xs ml-2">{f.reason}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {message && <p className="text-xs text-gray-400 mt-2">{message}</p>}
        </>
      )}
    </div>
  )
}
