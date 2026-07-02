import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Task } from '../store/taskStore'
import type { TaskBreakdownItem } from '../lib/taskBreakdownTypes'
import { calculateProgress, formatIot, isTechnicalComplete } from '../lib/taskBreakdownTypes'
import {
  isBreakdownItemReady,
  resolveTaskBreakdown,
  setActiveBreakdownItem
} from '../lib/breakdownHelpers'
import { estimateSubtaskTime, subtaskHasEstimateContext } from '../lib/taskEstimate'
import { buildOutcome } from '../lib/subtaskTypes'
import { setActiveSubtask } from '../lib/electron-api'
import { clampProgressPercent } from '../lib/progressMilestones'
import { isFeatureEnabled, type FeatureFlags } from '../features/types'
import type { OpenProbeHandler } from '../features/manifests'

interface TaskBreakdownPanelProps {
  task: Task
  flags?: FeatureFlags
  onUpdate: (updates: Partial<Task>) => void | Promise<void>
  onStuck?: () => void
  onOpenProbe?: OpenProbeHandler
}

export default function TaskBreakdownPanel({
  task,
  flags,
  onUpdate,
  onStuck,
  onOpenProbe
}: TaskBreakdownPanelProps) {
  const [addMode, setAddMode] = useState<'simple' | 'technical' | null>(null)
  const [newItemTitle, setNewItemTitle] = useState('')
  const [newInput, setNewInput] = useState('')
  const [newOutput, setNewOutput] = useState('')
  const [newTransformation, setNewTransformation] = useState('')
  const [estimatingId, setEstimatingId] = useState<string | null>(null)
  const [estimateError, setEstimateError] = useState<string | null>(null)
  const [editingTechnicalId, setEditingTechnicalId] = useState<string | null>(null)

  const items = resolveTaskBreakdown(task)
  const progress = calculateProgress(items)
  const probeEnabled = !flags || isFeatureEnabled(flags, 'subtaskProbe')

  const persistBreakdown = async (
    updatedItems: TaskBreakdownItem[],
    extra?: Partial<Task>
  ) => {
    const nextProgress =
      updatedItems.length > 0 ? clampProgressPercent(calculateProgress(updatedItems)) : undefined
    await onUpdate({
      task_breakdown: updatedItems,
      ...(nextProgress != null ? { progress_percent: nextProgress } : {}),
      ...extra
    })
  }

  const handleToggleStatus = (item: TaskBreakdownItem) => {
    const updatedItems = items.map((i) =>
      i.id === item.id
        ? {
            ...i,
            status: (i.status === 'done' ? 'pending' : 'done') as TaskBreakdownItem['status']
          }
        : i
    )
    void persistBreakdown(updatedItems)
  }

  const handleSetActive = async (item: TaskBreakdownItem) => {
    if (!isBreakdownItemReady(item)) return
    await setActiveSubtask(task.id, item.id)
    const updatedItems = setActiveBreakdownItem(items, item.id)
    await persistBreakdown(updatedItems, { active_subtask_id: item.id })
  }

  const handleAddSimple = () => {
    if (!newItemTitle.trim()) return
    const newItem: TaskBreakdownItem = {
      id: uuidv4(),
      title: newItemTitle.trim(),
      type: 'simple',
      status: 'pending',
      created_at: new Date().toISOString(),
      source: 'user',
      order: items.length
    }
    void persistBreakdown([...items, newItem])
    setNewItemTitle('')
    setAddMode(null)
  }

  const handleAddTechnical = () => {
    if (!newItemTitle.trim()) return
    const input = newInput.trim()
    const output = newOutput.trim()
    const transformation = newTransformation.trim()
    const newItem: TaskBreakdownItem = {
      id: uuidv4(),
      title: newItemTitle.trim(),
      type: 'technical',
      status: 'pending',
      created_at: new Date().toISOString(),
      source: 'user',
      order: items.length,
      technical: {
        input,
        output,
        transformation,
        outcome: buildOutcome(input, output, transformation)
      }
    }
    void persistBreakdown([...items, newItem])
    setNewItemTitle('')
    setNewInput('')
    setNewOutput('')
    setNewTransformation('')
    setAddMode(null)
  }

  const handleMakeTechnical = (item: TaskBreakdownItem) => {
    setEditingTechnicalId(item.id)
  }

  const handleSaveTechnicalUpgrade = (itemId: string) => {
    const input = newInput.trim()
    const output = newOutput.trim()
    const transformation = newTransformation.trim()
    if (!input || !output || !transformation) return

    const updatedItems = items.map((i) =>
      i.id === itemId
        ? {
            ...i,
            type: 'technical' as const,
            technical: {
              input,
              output,
              transformation,
              outcome: buildOutcome(input, output, transformation)
            }
          }
        : i
    )
    void persistBreakdown(updatedItems)
    setEditingTechnicalId(null)
    setNewInput('')
    setNewOutput('')
    setNewTransformation('')
  }

  const handleValidationToggle = (item: TaskBreakdownItem) => {
    if (item.type !== 'technical' || !item.technical) return

    const updatedItems = items.map((i) =>
      i.id === item.id && i.technical
        ? {
            ...i,
            technical: {
              ...i.technical,
              validated_with_real_input: !i.technical.validated_with_real_input,
              validated_at: !i.technical.validated_with_real_input
                ? new Date().toISOString()
                : undefined
            },
            status: (!i.technical.validated_with_real_input
              ? 'done'
              : i.status) as TaskBreakdownItem['status']
          }
        : i
    )
    void persistBreakdown(updatedItems)
  }

  const runItemEstimate = async (itemId: string) => {
    setEstimatingId(itemId)
    setEstimateError(null)
    try {
      const result = await estimateSubtaskTime(task.id, itemId)
      const updatedItems = items.map((i) =>
        i.id === itemId ? { ...i, ai_estimate_minutes: result.estimate } : i
      )
      await persistBreakdown(updatedItems)
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

  const smeTitle = (item: TaskBreakdownItem) => {
    if (item.source !== 'ai_sme' || !item.sme_validation_id) return 'From SME expert recommendation'
    const validation = task.sme_validations?.find((v) => v.id === item.sme_validation_id)
    return validation?.recorded_at
      ? `From SME validation ${new Date(validation.recorded_at).toLocaleDateString()}`
      : 'From SME expert recommendation'
  }

  return (
    <>
      <div className="bg-gray-800 rounded-lg p-3 border border-gray-600/80">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs text-gray-500 uppercase tracking-wide">Task Breakdown</h3>
            {items.length > 0 && (
              <span className="text-xs text-gray-400">
                ({items.filter((i) => i.status === 'done').length}/{items.length} complete)
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {probeEnabled && onOpenProbe && (
              <button
                type="button"
                onClick={() => {
                  onOpenProbe('manual')
                  onStuck?.()
                }}
                className="text-xs px-2 py-1 bg-orange-900/60 hover:bg-orange-800/80 border border-orange-700/50 rounded text-orange-100"
              >
                I&apos;m stuck
              </button>
            )}
            <button
              type="button"
              onClick={() => setAddMode('simple')}
              className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
            >
              + Add
            </button>
            <button
              type="button"
              onClick={() => setAddMode('technical')}
              className="text-xs px-2 py-1 bg-violet-900/50 hover:bg-violet-800/70 border border-violet-700/50 rounded text-violet-100"
            >
              + Technical
            </button>
          </div>
        </div>

        {mustCodeBy && (
          <p className="text-xs text-amber-300 mb-2">
            Code by {new Date(mustCodeBy).toLocaleTimeString()} — 30 min cap
          </p>
        )}

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

        {addMode === 'simple' && (
          <div className="mb-3 p-2 bg-gray-700/50 rounded border border-gray-600">
            <input
              type="text"
              value={newItemTitle}
              onChange={(e) => setNewItemTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddSimple()
                if (e.key === 'Escape') {
                  setAddMode(null)
                  setNewItemTitle('')
                }
              }}
              placeholder="Enter step title..."
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm"
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleAddSimple}
                className="text-xs px-2 py-1 bg-violet-800 hover:bg-violet-700 rounded text-white"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setAddMode(null)
                  setNewItemTitle('')
                }}
                className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {addMode === 'technical' && (
          <div className="mb-3 p-2 bg-gray-700/50 rounded border border-gray-600 space-y-2">
            <input
              value={newItemTitle}
              onChange={(e) => setNewItemTitle(e.target.value)}
              placeholder="Title"
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm"
              autoFocus
            />
            <input
              value={newInput}
              onChange={(e) => setNewInput(e.target.value)}
              placeholder="Input"
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm"
            />
            <input
              value={newOutput}
              onChange={(e) => setNewOutput(e.target.value)}
              placeholder="Output"
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm"
            />
            <input
              value={newTransformation}
              onChange={(e) => setNewTransformation(e.target.value)}
              placeholder="Transformation"
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={handleAddTechnical}
                className="text-xs px-2 py-1 bg-violet-800 hover:bg-violet-700 rounded text-white"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setAddMode(null)
                  setNewItemTitle('')
                  setNewInput('')
                  setNewOutput('')
                  setNewTransformation('')
                }}
                className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {items.length === 0 && !addMode ? (
          <p className="text-xs text-gray-600">No breakdown items yet. Add one or run a probe.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => {
              const isActive = item.status === 'active'
              const ready = isBreakdownItemReady(item)
              const canEstimate =
                item.type === 'technical' &&
                item.technical &&
                subtaskHasEstimateContext({
                  title: item.title,
                  input: item.technical.input,
                  output: item.technical.output,
                  transformation: item.technical.transformation
                } as import('../lib/subtaskTypes').TaskSubtask)

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
                            <span
                              className={`font-medium ${
                                item.status === 'done' ? 'line-through text-gray-500' : 'text-gray-200'
                              }`}
                            >
                              {item.title}
                            </span>
                            {item.source === 'ai_sme' && (
                              <span
                                className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-indigo-900/50 text-indigo-200"
                                title={smeTitle(item)}
                              >
                                SME
                              </span>
                            )}
                            <span
                              className={`ml-2 px-1.5 py-0.5 rounded text-[10px] uppercase ${
                                item.type === 'technical'
                                  ? 'bg-blue-900/60 text-blue-200'
                                  : 'bg-gray-700 text-gray-400'
                              }`}
                            >
                              {item.type === 'technical' ? 'tech' : 'simple'}
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
                            {estimatingId === item.id
                              ? '…'
                              : item.ai_estimate_minutes
                                ? 'Re-est'
                                : 'Est'}
                          </button>
                        )}
                        {item.type === 'simple' && editingTechnicalId !== item.id && (
                          <button
                            type="button"
                            onClick={() => handleMakeTechnical(item)}
                            className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-[10px] text-gray-300"
                          >
                            Make technical
                          </button>
                        )}
                        {!isActive && item.status !== 'done' && (
                          <button
                            type="button"
                            disabled={!ready}
                            title={
                              ready
                                ? 'Set active'
                                : item.type === 'technical'
                                  ? 'Fill input, output, transformation first'
                                  : 'Set active'
                            }
                            onClick={() => void handleSetActive(item)}
                            className="px-2 py-0.5 bg-violet-800 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed rounded text-[10px] text-white"
                          >
                            Set active
                          </button>
                        )}
                      </div>
                    </div>

                    {editingTechnicalId === item.id && (
                      <div className="pl-2 border-l-2 border-violet-700 space-y-2">
                        <input
                          value={newInput}
                          onChange={(e) => setNewInput(e.target.value)}
                          placeholder="Input"
                          className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm"
                        />
                        <input
                          value={newOutput}
                          onChange={(e) => setNewOutput(e.target.value)}
                          placeholder="Output"
                          className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm"
                        />
                        <input
                          value={newTransformation}
                          onChange={(e) => setNewTransformation(e.target.value)}
                          placeholder="Transformation"
                          className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleSaveTechnicalUpgrade(item.id)}
                            disabled={!isTechnicalComplete({
                              input: newInput,
                              output: newOutput,
                              transformation: newTransformation,
                              outcome: ''
                            })}
                            className="px-2 py-0.5 bg-violet-800 hover:bg-violet-700 disabled:opacity-40 rounded text-[10px] text-white"
                          >
                            Save IOT
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTechnicalId(null)
                              setNewInput('')
                              setNewOutput('')
                              setNewTransformation('')
                            }}
                            className="px-2 py-0.5 bg-gray-600 hover:bg-gray-500 rounded text-[10px] text-white"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {item.type === 'technical' &&
                      item.technical &&
                      (item.status === 'done' || item.status === 'active') && (
                        <div className="pl-2 border-l-2 border-gray-700">
                          <label className="flex items-center gap-2 text-[11px] cursor-pointer hover:text-gray-300 transition-colors">
                            <input
                              type="checkbox"
                              checked={!!item.technical.validated_with_real_input}
                              onChange={() => handleValidationToggle(item)}
                              className="w-3.5 h-3.5 rounded border-gray-600 text-green-600 focus:ring-green-500 focus:ring-offset-gray-900"
                            />
                            <span
                              className={
                                item.technical.validated_with_real_input
                                  ? 'text-green-300'
                                  : 'text-gray-400'
                              }
                            >
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

        {estimateError && <p className="text-xs text-red-300 mt-2">{estimateError}</p>}
      </div>
    </>
  )
}
