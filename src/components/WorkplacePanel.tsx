import { useState } from 'react'
import type { Task } from '../store/taskStore'
import {
  PHASE_LABELS,
  type SoftwarePhase
} from '../features/softwarePhases/types'
import { isFeatureEnabled, type FeatureFlags } from '../features/types'
import { syncPhaseGitSignals } from '../lib/electron-api'

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
  const [folder, setFolder] = useState(task.workplace_folder ?? '')
  const [indexing, setIndexing] = useState(false)
  const [guidanceLoading, setGuidanceLoading] = useState(false)
  const [gitSyncing, setGitSyncing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const showGitSync = flags && isFeatureEnabled(flags, 'phaseGitSignals')

  const pickFolder = async () => {
    if (!window.electron?.pickWorkplaceFolder) {
      setMessage('Restart the app (Cmd+Q) to enable workplace folder picker.')
      return
    }
    const result = await window.electron.pickWorkplaceFolder()
    if (result.path) {
      setFolder(result.path)
      await onUpdate({ workplace_folder: result.path, workplace_index: undefined })
      setMessage('Folder set — refresh index to scan files.')
    }
  }

  const saveFolder = async () => {
    const trimmed = folder.trim()
    await onUpdate({
      workplace_folder: trimmed || null,
      workplace_index: trimmed ? task.workplace_index : undefined
    })
    setMessage(trimmed ? 'Workplace folder saved.' : 'Workplace folder cleared.')
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
        setMessage('No git repo in workplace folder.')
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
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Workplace folder</span>
        {task.workplace_index && (
          <span className="text-xs text-gray-500">
            {task.workplace_index.file_count} files indexed
          </span>
        )}
      </div>

      <p className="text-xs text-gray-500 mb-2">
        Project folder for AI context when you drift off-task. Files are listed and read as text
        (not all at once).
      </p>

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
          onClick={() => void pickFolder()}
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
    </div>
  )
}
