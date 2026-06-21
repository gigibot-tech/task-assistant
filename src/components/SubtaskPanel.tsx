import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Task } from '../store/taskStore'
import {
  buildOutcome,
  formatSubtaskIot,
  isSubtaskReady,
  type TaskSubtask
} from '../lib/subtaskTypes'
import { setActiveSubtask } from '../lib/electron-api'
import SubtaskProbeModal from './SubtaskProbeModal'
import { isFeatureEnabled, type FeatureFlags } from '../features/types'

interface SubtaskPanelProps {
  task: Task
  flags: FeatureFlags
  onUpdate: (updates: Partial<Task>) => Promise<void>
  onStuck?: () => void
}

export default function SubtaskPanel({ task, flags, onUpdate, onStuck }: SubtaskPanelProps) {
  if (!isFeatureEnabled(flags, 'subtaskProbe')) return null
  const [expanded, setExpanded] = useState((task.subtasks?.length ?? 0) > 0)
  const [showAdd, setShowAdd] = useState(false)
  const [showProbe, setShowProbe] = useState(false)
  const [title, setTitle] = useState('')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [transformation, setTransformation] = useState('')

  const subtasks = task.subtasks ?? []
  const activeId = task.active_subtask_id ?? null

  const addSubtask = async () => {
    if (!title.trim()) return
    const newSt: TaskSubtask = {
      id: uuidv4(),
      title: title.trim(),
      input: input.trim(),
      output: output.trim(),
      transformation: transformation.trim(),
      outcome: buildOutcome(input, output, transformation),
      status: 'pending',
      created_at: new Date().toISOString(),
      source: 'user'
    }
    await onUpdate({ subtasks: [...subtasks, newSt] })
    setTitle('')
    setInput('')
    setOutput('')
    setTransformation('')
    setShowAdd(false)
    setExpanded(true)
  }

  const setActive = async (subtaskId: string) => {
    const st = subtasks.find((s) => s.id === subtaskId)
    if (!st || !isSubtaskReady(st)) return
    await setActiveSubtask(task.id, subtaskId)
    const next = subtasks.map((s) => ({
      ...s,
      status:
        s.id === subtaskId ? ('active' as const) : s.status === 'active' ? ('pending' as const) : s.status
    }))
    await onUpdate({ subtasks: next, active_subtask_id: subtaskId })
  }

  const markValidated = async (subtaskId: string, validated: boolean) => {
    const next = subtasks.map((s) =>
      s.id === subtaskId
        ? {
            ...s,
            validated_with_real_input: validated,
            validated_at: validated ? new Date().toISOString() : undefined,
            status: validated ? ('done' as const) : s.status
          }
        : s
    )
    await onUpdate({ subtasks: next })
  }

  const mustCodeBy = (task as Task & { probe_must_code_by?: string }).probe_must_code_by

  return (
    <>
      <div className="bg-gray-800 rounded-lg p-3 border border-gray-600/80">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-gray-500 uppercase tracking-wide hover:text-gray-300"
          >
            Subtasks ({subtasks.length}) {expanded ? '▾' : '▸'}
          </button>
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
              onClick={() => {
                setShowAdd((a) => !a)
                setExpanded(true)
              }}
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

        {expanded && (
          <>
            {subtasks.length === 0 && !showAdd && (
              <p className="text-xs text-gray-600">No subtasks yet. Add one or run a probe.</p>
            )}

            <ul className="space-y-2">
              {subtasks.map((st) => {
                const isActive = st.id === activeId
                const ready = isSubtaskReady(st)
                return (
                  <li
                    key={st.id}
                    className={`px-2 py-2 rounded border text-xs ${
                      isActive
                        ? 'bg-violet-900/30 border-violet-700/60'
                        : 'bg-gray-900/40 border-gray-700/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-medium text-gray-200">{st.title}</span>
                        <span
                          className={`ml-2 px-1.5 py-0.5 rounded text-[10px] uppercase ${
                            st.status === 'done'
                              ? 'bg-green-900/60 text-green-200'
                              : st.status === 'active'
                                ? 'bg-violet-800/60 text-violet-200'
                                : 'bg-gray-700 text-gray-400'
                          }`}
                        >
                          {st.status}
                        </span>
                        {ready && (
                          <p className="text-gray-500 mt-1 truncate">{formatSubtaskIot(st)}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {!isActive && st.status !== 'done' && (
                          <button
                            type="button"
                            disabled={!ready}
                            title={ready ? 'Set active' : 'Fill input, output, transformation first'}
                            onClick={() => void setActive(st.id)}
                            className="px-2 py-0.5 bg-violet-800 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed rounded text-[10px] text-white"
                          >
                            Set active
                          </button>
                        )}
                        {(st.status === 'done' || st.status === 'active') && (
                          <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!st.validated_with_real_input}
                              onChange={(e) => void markValidated(st.id, e.target.checked)}
                            />
                            Tested w/ real input
                          </label>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>

            {showAdd && (
              <div className="mt-3 space-y-2 border-t border-gray-700 pt-3">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Title"
                  className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm"
                />
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Input"
                  className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm"
                />
                <input
                  value={output}
                  onChange={(e) => setOutput(e.target.value)}
                  placeholder="Output"
                  className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm"
                />
                <input
                  value={transformation}
                  onChange={(e) => setTransformation(e.target.value)}
                  placeholder="Transformation"
                  className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm"
                />
                <button
                  type="button"
                  onClick={() => void addSubtask()}
                  className="w-full px-3 py-1.5 bg-violet-800 hover:bg-violet-700 rounded text-sm text-white"
                >
                  Save subtask
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showProbe && (
        <SubtaskProbeModal
          taskId={task.id}
          taskTitle={task.title}
          trigger="manual"
          existingSubtasks={subtasks}
          onLater={() => setShowProbe(false)}
          onAccept={async (updates) => {
            const ack = updates.drive_acknowledged_primes
            const patch: Partial<Task> = {
              subtasks: updates.subtasks,
              active_subtask_id: updates.active_subtask_id
            }
            if (updates.probe_must_code_by) {
              ;(patch as Task & { probe_must_code_by?: string }).probe_must_code_by =
                updates.probe_must_code_by
            }
            if (ack?.length) {
              patch.drive_acknowledged_primes = [
                ...new Set([...(task.drive_acknowledged_primes ?? []), ...ack])
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
