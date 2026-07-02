import { useEffect, useMemo, useState } from 'react'
import type { Task } from '../store/taskStore'
import type { SmeValidationEntry, SmeWindowDays } from '../types/smeValidation'
import {
  agreementColorClass,
  agreementIcon,
  domainFromTask,
  filterSmeByWindow,
  formatSmeTimelineLabel
} from '../lib/smeValidation'
import { promoteSmeStepToSubtask, validateSmeForTask } from '../lib/electron-api'
import { resolveTaskBreakdown } from '../lib/breakdownHelpers'

interface TaskSmePanelProps {
  task: Task
  onUpdate: (updates: Partial<Task>) => Promise<void>
  fullWidth?: boolean
}

const WINDOW_OPTIONS: SmeWindowDays[] = [7, 14, 30, 90]

export default function TaskSmePanel({ task, onUpdate, fullWidth = false }: TaskSmePanelProps) {
  const validations = task.sme_validations ?? []
  const windowDays = (task.sme_window_days ?? 14) as SmeWindowDays
  const latest = validations.length > 0 ? validations[validations.length - 1] : null

  const [expanded, setExpanded] = useState(fullWidth || validations.length > 0)
  const domain = useMemo(() => domainFromTask(task), [task.id, task.title, task.tags])
  const [approach, setApproach] = useState(
    latest?.approach ?? task.description?.trim() ?? ''
  )
  const [loading, setLoading] = useState(false)
  const [promotingKey, setPromotingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [latestEntry, setLatestEntry] = useState<SmeValidationEntry | null>(null)

  useEffect(() => {
    setApproach(latest?.approach ?? task.description?.trim() ?? '')
    setLatestEntry(null)
    setSelectedEntryId(null)
  }, [task.id])

  const filteredHistory = useMemo(
    () => filterSmeByWindow(validations, windowDays),
    [validations, windowDays]
  )

  const selectedEntry =
    filteredHistory.find((e) => e.id === selectedEntryId) ??
    latestEntry ??
    null

  const handleValidate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!domain.trim() || !approach.trim()) {
      setError('Task title and approach are required.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const entry = await validateSmeForTask(task.id, domain.trim(), approach.trim())
      setLatestEntry(entry)
      setSelectedEntryId(entry.id)
      await onUpdate({
        sme_validations: [...validations, entry]
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed')
    } finally {
      setLoading(false)
    }
  }

  const handlePromote = async (entryId: string, stepIndex: number) => {
    const key = `${entryId}:${stepIndex}`
    setPromotingKey(key)
    setError(null)
    try {
      const result = await promoteSmeStepToSubtask(task.id, entryId, stepIndex)
      const updated = result.task as Task
      await onUpdate({
        task_breakdown: updated.task_breakdown,
        sme_validations: updated.sme_validations
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add subtask')
    } finally {
      setPromotingKey(null)
    }
  }

  const isStepPromoted = (entry: SmeValidationEntry, stepIndex: number): boolean => {
    const ids = entry.promoted_subtask_ids ?? []
    const breakdown = resolveTaskBreakdown(task)
    const step = entry.recommended_steps?.[stepIndex]
    if (!step) return false
    return (
      breakdown.some(
        (item) =>
          item.source === 'ai_sme' &&
          item.sme_validation_id === entry.id &&
          item.title === step.title
      ) || ids.length > stepIndex
    )
  }

  const panelClass = fullWidth
    ? 'space-y-4'
    : 'bg-gray-800 rounded-lg border border-gray-600/80 p-3'

  return (
    <div className={panelClass}>
      {!fullWidth && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between mb-2 hover:text-gray-300 transition-colors"
        >
          <span className="text-xs text-gray-500 uppercase tracking-wide">
            SME validation {expanded ? '▾' : '▸'}
          </span>
          {validations.length > 0 && (
            <span className="text-xs text-gray-500">{validations.length} entries</span>
          )}
        </button>
      )}

      {(fullWidth || expanded) && (
        <div className="space-y-3">
          {fullWidth && (
            <div>
              <h2 className="text-xl font-bold mb-1">SME Opinion Validation</h2>
              <p className="text-sm text-gray-400">
                Expert review for <span className="text-gray-300">{task.title}</span> — stored on this task timeline.
              </p>
            </div>
          )}

          <form onSubmit={(e) => void handleValidate(e)} className="space-y-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Domain / topic (from task)</label>
              <p className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300">
                {domain || 'Untitled task'}
              </p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Your approach</label>
              <textarea
                value={approach}
                onChange={(e) => setApproach(e.target.value)}
                rows={fullWidth ? 4 : 3}
                placeholder="Describe the approach you want validated…"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm resize-none focus:outline-none focus:border-primary-500"
              />
            </div>
            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="px-3 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg text-sm font-medium"
            >
              {loading ? 'Consulting SME…' : 'Get expert opinion'}
            </button>
          </form>

          {selectedEntry && (
            <div className="space-y-2 pt-2 border-t border-gray-700">
              <div className={`p-3 rounded-lg border ${agreementColorClass(selectedEntry.agreement)}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-lg">{agreementIcon(selectedEntry.agreement)}</span>
                  <span className="font-semibold capitalize text-sm">
                    {selectedEntry.agreement === 'partial'
                      ? 'Partially agrees'
                      : selectedEntry.agreement}
                  </span>
                  <span className="ml-auto text-xs">
                    {Math.round(selectedEntry.alignment * 100)}% aligned
                  </span>
                </div>
                <p className="text-xs text-gray-400">
                  {new Date(selectedEntry.recorded_at).toLocaleString()}
                </p>
              </div>
              <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Feedback</p>
                <p className="text-sm text-gray-300">{selectedEntry.feedback}</p>
              </div>
              <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Reasoning</p>
                <p className="text-sm text-gray-300">{selectedEntry.reasoning}</p>
              </div>
              {(selectedEntry.recommended_steps?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Recommended steps</p>
                  {selectedEntry.recommended_steps!.map((step, index) => {
                    const promoted = isStepPromoted(selectedEntry, index)
                    const key = `${selectedEntry.id}:${index}`
                    return (
                      <div
                        key={key}
                        className="flex items-start gap-2 p-2 bg-gray-900/40 border border-gray-700 rounded-lg"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-200 font-medium">{step.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{step.rationale}</p>
                          {step.priority && (
                            <span className="text-[10px] text-gray-600 uppercase mt-1 inline-block">
                              {step.priority} priority
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={promoted || promotingKey === key}
                          onClick={() => void handlePromote(selectedEntry.id, index)}
                          className="shrink-0 px-2 py-1 text-xs bg-indigo-900/50 hover:bg-indigo-800/60 disabled:opacity-40 rounded"
                        >
                          {promoted ? 'Added' : promotingKey === key ? '…' : 'Add subtask'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>History window</span>
            {WINDOW_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => void onUpdate({ sme_window_days: days })}
                className={`px-2 py-0.5 rounded ${
                  windowDays === days
                    ? 'bg-gray-600 text-gray-200'
                    : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                }`}
              >
                {days}d
              </button>
            ))}
          </div>

          <details
            open={historyOpen}
            onToggle={(e) => setHistoryOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="text-xs text-gray-400 cursor-pointer select-none">
              SME timeline ({filteredHistory.length})
            </summary>
            {filteredHistory.length === 0 ? (
              <p className="text-xs text-gray-600 mt-2">No validations in the last {windowDays} days.</p>
            ) : (
              <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {filteredHistory.map((entry) => {
                  const isSelected = selectedEntryId === entry.id
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedEntryId(isSelected ? null : entry.id)
                          setLatestEntry(entry)
                        }}
                        className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                          isSelected
                            ? 'bg-indigo-900/40 border border-indigo-700/50'
                            : 'hover:bg-gray-700/60 border border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-300">{formatSmeTimelineLabel(entry)}</span>
                          <span className="text-gray-600 shrink-0">
                            {new Date(entry.recorded_at).toLocaleDateString()}
                          </span>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </details>
        </div>
      )}
    </div>
  )
}
