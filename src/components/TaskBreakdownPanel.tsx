import { useState } from 'react'
import type { Task } from '../store/taskStore'
import type { TaskBreakdownItem } from '../lib/taskBreakdownTypes'
import { getTaskBreakdown } from '../lib/taskBreakdownMigration'
import { calculateProgress, formatIot } from '../lib/taskBreakdownTypes'
import { estimateSubtaskTime, subtaskHasEstimateContext } from '../lib/taskEstimate'
import { buildOutcome } from '../lib/subtaskTypes'
import SubtaskProbeModal from './SubtaskProbeModal'

interface TaskBreakdownPanelProps {
  task: Task
  onUpdate: (updates: Partial<Task>) => void
  onStuck?: () => void
}

export default function TaskBreakdownPanel({ task, onUpdate, onStuck }: TaskBreakdownPanelProps) {
  const [isAddingNew, setIsAddingNew] = useState(false)
  const [newItemTitle, setNewItemTitle] = useState('')
  const [showProbe, setShowProbe] = useState(false)
  const [estimatingId, setEstimatingId] = useState<string | null>(null)
  const [estimateError, setEstimateError] = useState<string | null>(null)

  // Get breakdown items (migrated if necessary)
  const items = getTaskBreakdown(task)
  const progress = calculateProgress(items)

  const handleToggleStatus = (item: TaskBreakdownItem) => {
    const updatedItems = items.map(i =>
      i.id === item.id
        ? { ...i, status: (i.status === 'done' ? 'pending' : 'done') as TaskBreakdownItem['status'] }
        : i
    )
    onUpdate({ task_breakdown: updatedItems })
  }

  const handleSetActive = (item: TaskBreakdownItem) => {
    const updatedItems = items.map(i => ({
      ...i,
      status: (i.id === item.id ? 'active' : i.status === 'active' ? 'pending' : i.status) as TaskBreakdownItem['status']
    }))
    onUpdate({ task_breakdown: updatedItems })
  }

  const handleAddItem = () => {
    if (!newItemTitle.trim()) return

    const newItem: TaskBreakdownItem = {
      id: `item-${Date.now()}`,
      title: newItemTitle.trim(),
      type: 'simple',
      status: 'pending',
      created_at: new Date().toISOString(),
      source: 'user',
      order: items.length
    }

    onUpdate({ task_breakdown: [...items, newItem] })
    setNewItemTitle('')
    setIsAddingNew(false)
  }

  const handleValidationToggle = (item: TaskBreakdownItem) => {
    if (item.type !== 'technical' || !item.technical) return
    
    const updatedItems = items.map(i =>
      i.id === item.id && i.technical
        ? {
            ...i,
            technical: {
              ...i.technical,
              validated_with_real_input: !i.technical.validated_with_real_input,
              validated_at: !i.technical.validated_with_real_input ? new Date().toISOString() : undefined
            },
            status: (!i.technical.validated_with_real_input ? 'done' : i.status) as TaskBreakdownItem['status']
          }
        : i
    )
    onUpdate({ task_breakdown: updatedItems })
  }

  const runItemEstimate = async (itemId: string) => {
    setEstimatingId(itemId)
    setEstimateError(null)
    try {
      const result = await estimateSubtaskTime(task.id, itemId)
      const updatedItems = items.map(i =>
        i.id === itemId ? { ...i, ai_estimate_minutes: result.estimate } : i
      )
      onUpdate({ task_breakdown: updatedItems })
    } catch (err) {
      setEstimateError(err instanceof Error ? err.message : 'Estimate failed')
    } finally {
      setEstimatingId(null)
    }
  }

  const mustCodeBy = (task as Task & { probe_must_code_by?: string }).probe_must_code_by

  const getStatusIcon = (status: TaskBreakdownItem['status']) => {
    switch (status) {
      case 'done':
        return '☑'
      case 'active':
        return '▶'
      case 'blocked':
        return '⊘'
      default:
        return '☐'
    }
  }

  const getTypeLabel = (type: TaskBreakdownItem['type']) => {
    return type === 'technical' ? 'tech' : 'simple'
  }

  return (
    <>
      <div className="bg-gray-800 rounded-lg p-3 border border-gray-600/80">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs text-gray-500 uppercase tracking-wide">Task Breakdown</h3>
            {items.length > 0 && (
              <span className="text-xs text-gray-400">
                ({items.filter(i => i.status === 'done').length}/{items.length} complete)
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowProbe(true)
                onStuck?.()
              }}
              className="text-xs px-2 py-1 bg-orange-900/60 hover:bg-orange-800/80 border border-orange-700/50 rounded text-orange-100"
            >
              I'm stuck
            </button>
            <button
              type="button"
              onClick={() => setIsAddingNew(true)}
              className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
            >
              + Add
            </button>
          </div>
        </div>

        {mustCodeBy && (
          <p className="text-xs text-amber-300 mb-2">
            Code by {new Date(mustCodeBy).toLocaleTimeString()} — 30 min cap
          </p>
        )}

        {/* Progress Bar */}
        {items.length > 0 && (
          <div className="mb-3">
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-violet-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Add New Item Form */}
        {isAddingNew && (
          <div className="mb-3 p-2 bg-gray-700/50 rounded border border-gray-600">
            <input
              type="text"
              value={newItemTitle}
              onChange={(e) => setNewItemTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddItem()
                if (e.key === 'Escape') {
                  setIsAddingNew(false)
                  setNewItemTitle('')
                }
              }}
              placeholder="Enter item title..."
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm"
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleAddItem}
                className="text-xs px-2 py-1 bg-violet-800 hover:bg-violet-700 rounded text-white"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setIsAddingNew(false)
                  setNewItemTitle('')
                }}
                className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Items List */}
        {items.length === 0 && !isAddingNew ? (
          <p className="text-xs text-gray-600">No breakdown items yet. Add one or run a probe.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => {
              const isActive = item.status === 'active'
              const canEstimate = item.type === 'technical' && item.technical && 
                                 subtaskHasEstimateContext({ 
                                   input: item.technical.input, 
                                   output: item.technical.output, 
                                   transformation: item.technical.transformation 
                                 } as any)
              
              return (
                <li
                  key={item.id}
                  className={`px-2 py-2 rounded border text-xs ${
                    isActive
                      ? 'bg-violet-900/30 border-violet-700/60'
                      : 'bg-gray-900/40 border-gray-700/60'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <button
                            onClick={() => handleToggleStatus(item)}
                            className="text-lg leading-none hover:scale-110 transition-transform flex-shrink-0"
                            title={`Mark as ${item.status === 'done' ? 'pending' : 'done'}`}
                          >
                            {getStatusIcon(item.status)}
                          </button>
                          <div className="min-w-0 flex-1">
                            <span className={`font-medium ${item.status === 'done' ? 'line-through text-gray-500' : 'text-gray-200'}`}>
                              {item.title}
                            </span>
                            <span
                              className={`ml-2 px-1.5 py-0.5 rounded text-[10px] uppercase ${
                                item.type === 'technical'
                                  ? 'bg-blue-900/60 text-blue-200'
                                  : 'bg-gray-700 text-gray-400'
                              }`}
                            >
                              {getTypeLabel(item.type)}
                            </span>
                            {item.type === 'technical' && item.technical && (
                              <p className="text-gray-500 mt-1 text-[11px] font-mono">
                                {formatIot(item.technical)}
                              </p>
                            )}
                            {item.ai_estimate_minutes != null && (
                              <p className="text-indigo-300/80 mt-1">
                                ~{item.ai_estimate_minutes} min
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {canEstimate && (
                          <button
                            type="button"
                            onClick={() => void runItemEstimate(item.id)}
                            disabled={estimatingId === item.id}
                            className="px-2 py-0.5 bg-indigo-900/50 hover:bg-indigo-800/70 disabled:opacity-40 rounded text-[10px] text-indigo-100"
                          >
                            {estimatingId === item.id ? '…' : item.ai_estimate_minutes ? 'Re-est' : 'Est'}
                          </button>
                        )}
                        {!isActive && item.status !== 'done' && (
                          <button
                            type="button"
                            onClick={() => handleSetActive(item)}
                            className="px-2 py-0.5 bg-violet-800 hover:bg-violet-700 rounded text-[10px] text-white"
                          >
                            Set active
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {item.type === 'technical' && item.technical && (item.status === 'done' || item.status === 'active') && (
                      <div className="pl-2 border-l-2 border-gray-700">
                        <label className="flex items-center gap-2 text-[11px] cursor-pointer hover:text-gray-300 transition-colors">
                          <input
                            type="checkbox"
                            checked={!!item.technical.validated_with_real_input}
                            onChange={() => handleValidationToggle(item)}
                            className="w-3.5 h-3.5 rounded border-gray-600 text-green-600 focus:ring-green-500 focus:ring-offset-gray-900"
                          />
                          <span className={item.technical.validated_with_real_input ? 'text-green-300' : 'text-gray-400'}>
                            Tested w/ real input
                          </span>
                        </label>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {estimateError && (
          <p className="text-xs text-red-300 mt-2">{estimateError}</p>
        )}
      </div>

      {showProbe && (
        <SubtaskProbeModal
          taskId={task.id}
          taskTitle={task.title}
          trigger="manual"
          existingSubtasks={task.subtasks ?? []}
          onLater={() => setShowProbe(false)}
          onAccept={async (updates) => {
            // Convert subtasks to breakdown items and merge
            const newBreakdownItems: TaskBreakdownItem[] = (updates.subtasks ?? []).map((st, idx) => ({
              id: st.id,
              title: st.title,
              type: 'technical' as const,
              status: st.status,
              created_at: st.created_at,
              source: st.source,
              order: items.length + idx,
              technical: {
                input: st.input,
                output: st.output,
                transformation: st.transformation,
                outcome: buildOutcome(st.input, st.output, st.transformation),
                validated_with_real_input: st.validated_with_real_input,
                validated_at: st.validated_at
              },
              ai_estimate_minutes: st.ai_estimate_minutes
            }))
            
            const patch: Partial<Task> = {
              task_breakdown: [...items, ...newBreakdownItems],
              active_subtask_id: updates.active_subtask_id
            }
            
            if (updates.probe_must_code_by) {
              ;(patch as Task & { probe_must_code_by?: string }).probe_must_code_by =
                updates.probe_must_code_by
            }
            
            if (updates.drive_acknowledged_primes?.length) {
              patch.drive_acknowledged_primes = [
                ...new Set([...(task.drive_acknowledged_primes ?? []), ...updates.drive_acknowledged_primes])
              ]
            }
            
            await onUpdate(patch)
            setShowProbe(false)
          }}
        />
      )}
    </>
  )
}

// Made with Bob
