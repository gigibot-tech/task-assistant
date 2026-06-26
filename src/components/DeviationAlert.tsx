import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { TaskSubtask } from '../lib/subtaskTypes'

interface DeviationData {
  severity: 'low' | 'medium' | 'high'
  similarity: number
  onTask?: boolean
  suggestion: string
  currentActivity: string
  expectedTask: string
  taskId?: string
  taskTitle?: string
  matched_subtask_id?: string | null
  on_active_subtask?: boolean
  work_mode?: string
  active_subtask_id?: string | null
  phase_mismatch?: boolean
  work_phase?: string | null
  workplace_guidance?: {
    generated_at: string
    summary: string
    suggested_files: Array<{ path: string; reason: string }>
    suggested_actions: string[]
    tools_hint?: string
  }
}

interface DeviationAlertProps {
  onReturnToTask?: (taskId: string) => void
  onStuckProbe?: (taskId: string, trigger: 'deviation' | 'stale' | 'manual') => void
  onAddSubtask?: (taskId: string, subtask: TaskSubtask) => Promise<void>
}

export default function DeviationAlert({ onReturnToTask, onStuckProbe, onAddSubtask }: DeviationAlertProps) {
  const [deviation, setDeviation] = useState<DeviationData | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    window.electron?.onNotification((data: { type: string; data: DeviationData }) => {
      if (data.type === 'deviation_alert') {
        setDeviation(data.data)
        setVisible(true)
      }
    })
  }, [])

  const handleDismiss = () => {
    setVisible(false)
  }

  const handleReturnToTask = () => {
    if (deviation?.taskId && onReturnToTask) {
      onReturnToTask(deviation.taskId)
    }
    handleDismiss()
  }

  const openWorkplaceFile = async (relativePath: string) => {
    if (!deviation?.taskId || !window.electron?.openWorkplacePath) return
    await window.electron.openWorkplacePath(deviation.taskId, relativePath)
  }

  const addActionAsSubtask = async (action: string, index: number) => {
    if (!deviation?.taskId || !onAddSubtask) return
    
    // Mark button as added
    const button = document.querySelector(`[data-action-index="${index}"]`)
    if (button?.classList.contains('added')) return
    
    const newSubtask: TaskSubtask = {
      id: uuidv4(),
      title: action,
      input: '',
      output: '',
      transformation: '',
      outcome: '',
      status: 'pending',
      created_at: new Date().toISOString(),
      source: 'ai_probe'
    }
    
    await onAddSubtask(deviation.taskId, newSubtask)
    
    // Mark as added
    if (button) {
      button.classList.add('added')
      button.textContent = '✓ Added'
    }
  }

  if (!visible || !deviation) return null

  const guidance = deviation.workplace_guidance

  const severityColors = {
    low: 'bg-yellow-900 border-yellow-700',
    medium: 'bg-orange-900 border-orange-700',
    high: 'bg-red-900 border-red-700'
  }

  const severityLabels = {
    low: 'Low — gentle reminder',
    medium: 'Medium — check your focus',
    high: 'High — significant deviation'
  }

  return (
    <div className="fixed bottom-4 right-4 max-w-md z-50 animate-slide-up">
      <div className={`${severityColors[deviation.severity]} border-2 rounded-lg p-4 shadow-lg max-h-[85vh] overflow-y-auto`}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚠️</span>
            <div>
              <h3 className="font-bold text-lg">Task Deviation Detected</h3>
              <p className="text-xs text-gray-400">{severityLabels[deviation.severity]}</p>
            </div>
          </div>
          <button onClick={handleDismiss} className="text-gray-400 hover:text-gray-200">
            ✕
          </button>
        </div>

        <div className="space-y-2 text-sm">
          {deviation.taskTitle && (
            <p className="text-gray-300">
              <span className="font-medium">Planned:</span> {deviation.taskTitle}
            </p>
          )}
          {deviation.currentActivity && (
            <p className="text-gray-300">
              <span className="font-medium">On screen:</span> {deviation.currentActivity}
            </p>
          )}
          {deviation.onTask === false && (
            <p className="text-orange-200 text-xs font-medium">
              Not doing substantive work on this task yet.
            </p>
          )}
          <p className="text-gray-300">{deviation.suggestion}</p>

          {deviation.matched_subtask_id &&
            deviation.active_subtask_id &&
            deviation.matched_subtask_id !== deviation.active_subtask_id && (
              <p className="text-xs text-violet-300">
                Screen matches a different subtask — consider switching focus.
              </p>
            )}

          {deviation.work_mode === 'over_design' && (
            <p className="text-xs text-orange-200">
              Over-design detected — 30 min thinking cap: write the stupid version now.
            </p>
          )}

          {deviation.phase_mismatch && deviation.work_phase && (
            <p className="text-xs text-teal-300">
              Phase mismatch: declared {deviation.work_phase} but screen work looks different.
            </p>
          )}

          {guidance && (
            <div className="pt-2 mt-2 border-t border-gray-700/80 space-y-2">
              <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wide">
                Where to continue
              </p>
              <p className="text-gray-200 text-sm">{guidance.summary}</p>
              {guidance.suggested_actions?.length > 0 && (
                <div className="space-y-1">
                  {guidance.suggested_actions.map((action, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="text-gray-300 flex-1">• {action}</span>
                      {onAddSubtask && (
                        <button
                          type="button"
                          data-action-index={i}
                          onClick={() => void addActionAsSubtask(action, i)}
                          className="px-2 py-0.5 bg-violet-800/60 hover:bg-violet-700 rounded text-[10px] text-violet-100 whitespace-nowrap transition-colors"
                          title="Add as subtask"
                        >
                          + Subtask
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {guidance.suggested_files?.length > 0 && (
                <div className="space-y-1">
                  {guidance.suggested_files.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      onClick={() => void openWorkplaceFile(f.path)}
                      className="block w-full text-left text-xs px-2 py-1.5 bg-gray-800/80 hover:bg-gray-700 rounded border border-gray-600/50 transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        <svg className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <span className="text-indigo-300 font-mono block truncate">{f.path}</span>
                          {f.reason && (
                            <span className="block text-gray-500 mt-0.5">{f.reason}</span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {guidance.tools_hint && (
                <p className="text-xs text-gray-500 italic">{guidance.tools_hint}</p>
              )}
            </div>
          )}

          <div className="pt-2 border-t border-gray-700">
            <div className="text-xs text-gray-400">
              Similarity: {Math.round(deviation.similarity * 100)}%
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-4">
          <div className="flex gap-2">
            <button
              onClick={handleDismiss}
              className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium"
            >
              Dismiss
            </button>
            <button
              onClick={handleReturnToTask}
              className="flex-1 px-3 py-2 bg-primary-600 hover:bg-primary-700 rounded text-sm font-medium"
            >
              Return to Task
            </button>
          </div>
          {deviation.taskId && onStuckProbe && (
            <button
              type="button"
              onClick={() => {
                onStuckProbe(deviation.taskId!, 'deviation')
                handleDismiss()
              }}
              className="w-full px-3 py-2 bg-orange-800 hover:bg-orange-700 rounded text-sm font-medium text-orange-50"
            >
              I'm stuck — probe subtask
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
