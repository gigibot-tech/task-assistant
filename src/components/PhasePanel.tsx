import { useState } from 'react'
import type { Task } from '../store/taskStore'
import {
  PHASE_LABELS,
  PHASE_TAGLINE,
  type SoftwarePhase
} from '../features/softwarePhases/types'
import { isFeatureEnabled } from '../features/types'
import type { FeatureFlags } from '../features/types'
import { setWorkPhase, syncPhaseGitSignals } from '../lib/electron-api'
import SubtaskProbeModal from './SubtaskProbeModal'

interface PhasePanelProps {
  task: Task
  flags: FeatureFlags
  onUpdate: (updates: Partial<Task>) => Promise<void>
}

export default function PhasePanel({ task, flags, onUpdate }: PhasePanelProps) {
  const [syncing, setSyncing] = useState(false)
  const [showExtractProbe, setShowExtractProbe] = useState(false)
  const [gitMessage, setGitMessage] = useState<string | null>(null)

  if (!isFeatureEnabled(flags, 'softwarePhases')) return null

  const phase = (task.work_phase ?? 'playground') as SoftwarePhase
  const balance = task.phase_balance

  const setPhase = async (next: SoftwarePhase) => {
    await setWorkPhase(task.id, next, 'user')
    await onUpdate({
      work_phase: next,
      work_phase_set_at: new Date().toISOString(),
      work_phase_source: 'user'
    })
    if (next === 'extract') {
      setShowExtractProbe(true)
    }
  }

  const applyGitSuggestion = async () => {
    const suggested = balance?.git_suggested_phase
    if (!suggested) return
    await setWorkPhase(task.id, suggested, 'git')
    await onUpdate({
      work_phase: suggested,
      work_phase_set_at: new Date().toISOString(),
      work_phase_source: 'git'
    })
    setGitMessage(null)
  }

  const syncGit = async () => {
    if (!isFeatureEnabled(flags, 'phaseGitSignals')) return
    setSyncing(true)
    setGitMessage(null)
    try {
      const result = await syncPhaseGitSignals(task.id)
      await onUpdate({
        phase_balance: result.phase_balance as Task['phase_balance']
      })
      if (result.git_available) {
        setGitMessage(
          `Git suggests ${PHASE_LABELS[result.suggested_phase as SoftwarePhase] ?? result.suggested_phase} (${Math.round(result.confidence * 100)}%)`
        )
      } else {
        setGitMessage('No git repo in workplace folder.')
      }
    } catch (err) {
      setGitMessage(err instanceof Error ? err.message : 'Git sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      <div className="bg-gray-800 rounded-lg p-3 border border-teal-700/50">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span className="text-xs text-teal-400 uppercase tracking-wide">Software phase</span>
          <span className="text-xs text-gray-500 italic">{PHASE_TAGLINE}</span>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {(['playground', 'core', 'extract'] as SoftwarePhase[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => void setPhase(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                phase === p
                  ? 'bg-teal-900/60 border-teal-500 text-teal-100'
                  : 'bg-gray-900/50 border-gray-600 text-gray-400 hover:border-teal-700'
              }`}
            >
              {PHASE_LABELS[p]}
            </button>
          ))}
        </div>

        {balance && (
          <div className="flex flex-wrap gap-3 text-xs text-gray-400 mb-2">
            <span>Playground 7d: {balance.playground_minutes_7d ?? 0}m</span>
            <span>Core 7d: {balance.core_minutes_7d ?? 0}m</span>
            <span>Extracts 7d: {balance.extract_events_7d ?? 0}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {isFeatureEnabled(flags, 'phaseGitSignals') && (
            <button
              type="button"
              onClick={() => void syncGit()}
              disabled={syncing || !task.workplace_folder}
              className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded"
            >
              {syncing ? 'Syncing git…' : 'Sync git phase'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowExtractProbe(true)}
            className="text-xs px-2 py-1 bg-teal-900/60 hover:bg-teal-800/80 border border-teal-700/50 rounded text-teal-100"
          >
            Start extract
          </button>
        </div>

        {balance?.git_suggested_phase && balance.git_suggested_phase !== phase && (
          <button
            type="button"
            onClick={() => void applyGitSuggestion()}
            className="mt-2 text-xs text-teal-300 hover:text-teal-200 underline"
          >
            Git suggests {PHASE_LABELS[balance.git_suggested_phase]} — switch?
          </button>
        )}

        {balance?.recent_commits_summary && balance.recent_commits_summary.length > 0 && (
          <ul className="mt-2 text-[10px] text-gray-500 space-y-0.5 max-h-16 overflow-y-auto font-mono">
            {balance.recent_commits_summary.map((line, i) => (
              <li key={i} className="truncate">
                {line}
              </li>
            ))}
          </ul>
        )}

        {gitMessage && <p className="mt-2 text-xs text-gray-400">{gitMessage}</p>}
      </div>

      {showExtractProbe && (
        <SubtaskProbeModal
          taskId={task.id}
          taskTitle={task.title}
          trigger="manual"
          workPhase="extract"
          existingSubtasks={task.subtasks ?? []}
          activeSubtaskId={task.active_subtask_id}
          onLater={() => setShowExtractProbe(false)}
          onAccept={async (updates) => {
            await onUpdate({
              ...updates,
              work_phase: 'core',
              work_phase_source: 'probe',
              work_phase_set_at: new Date().toISOString()
            })
            setShowExtractProbe(false)
          }}
        />
      )}
    </>
  )
}
