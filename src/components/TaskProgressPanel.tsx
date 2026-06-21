import { useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Task } from '../store/taskStore'
import PrimeMilestonePrompt from './PrimeMilestonePrompt'
import {
  clampProgressPercent,
  getNewlyCrossedPrimes,
  getPendingMilestoneQueue,
  getUpcomingMilestone,
  getNextPendingMilestone,
  type PrimeMilestone,
  type ProgressMilestoneUpdate
} from '../lib/progressMilestones'

interface TaskProgressPanelProps {
  task: Task
  onUpdate: (updates: Partial<Task>) => Promise<void>
}

export default function TaskProgressPanel({ task, onUpdate }: TaskProgressPanelProps) {
  const [newItem, setNewItem] = useState('')
  const [milestoneQueue, setMilestoneQueue] = useState<PrimeMilestone[]>([])
  const [draftProgress, setDraftProgress] = useState<number | null>(null)
  const progressBaselineRef = useRef(clampProgressPercent(task.progress_percent ?? 0))

  const checklist = task.progress_checklist ?? []
  const milestoneUpdates = task.progress_milestone_updates ?? []
  const savedProgress = clampProgressPercent(task.progress_percent ?? 0)
  const currentProgress = draftProgress ?? savedProgress

  const activePrime = milestoneQueue[0] ?? null
  const nextPending = getNextPendingMilestone(currentProgress, milestoneUpdates)
  const upcoming = getUpcomingMilestone(currentProgress, milestoneUpdates)
  const ackedCount = milestoneUpdates.length

  useEffect(() => {
    progressBaselineRef.current = clampProgressPercent(task.progress_percent ?? 0)
    setDraftProgress(null)
  }, [task.id, task.progress_percent])

  const commitProgressChange = async (nextPercent: number) => {
    const before = progressBaselineRef.current
    const after = clampProgressPercent(nextPercent)
    setDraftProgress(null)

    if (after === before) return

    await onUpdate({ progress_percent: after })
    progressBaselineRef.current = after

    const newlyCrossed = getNewlyCrossedPrimes(before, after)
    if (newlyCrossed.length > 0) {
      setMilestoneQueue((prev) =>
        getPendingMilestoneQueue(after, milestoneUpdates, [...newlyCrossed, ...prev])
      )
    }
  }

  const syncChecklist = async (next: Task['progress_checklist']) => {
    const before = progressBaselineRef.current
    await onUpdate({ progress_checklist: next })

    const done = next?.filter((i) => i.done).length ?? 0
    const total = next?.length ?? 0
    const after =
      total > 0 ? clampProgressPercent(Math.round((done / total) * 100)) : before
    const newlyCrossed = getNewlyCrossedPrimes(before, after)
    progressBaselineRef.current = after

    if (newlyCrossed.length > 0) {
      setMilestoneQueue((prev) =>
        getPendingMilestoneQueue(after, milestoneUpdates, [...newlyCrossed, ...prev])
      )
    }
  }

  const acknowledgeMilestone = async (prime: number, note: string) => {
    const entry: ProgressMilestoneUpdate = {
      prime,
      note,
      acknowledged_at: new Date().toISOString()
    }
    const nextUpdates = [...milestoneUpdates, entry].sort((a, b) => a.prime - b.prime)
    await onUpdate({ progress_milestone_updates: nextUpdates })
    setMilestoneQueue((prev) => prev.filter((p) => p !== prime))
  }

  const handleMilestoneSave = async (note: string) => {
    if (!activePrime) return
    await acknowledgeMilestone(activePrime, note)
  }

  const handleMilestoneSkip = () => {
    if (!activePrime) return
    setMilestoneQueue((prev) => prev.slice(1))
  }

  const openBacklogPrompt = () => {
    if (!nextPending) return
    setMilestoneQueue((prev) => {
      if (prev.includes(nextPending)) return prev
      return [nextPending, ...prev]
    })
  }

  const addItem = async () => {
    const label = newItem.trim()
    if (!label || checklist.length >= 7) return
    const next = [...checklist, { id: uuidv4(), label, done: false }]
    setNewItem('')
    await syncChecklist(next)
  }

  const toggleItem = async (id: string) => {
    const next = checklist.map((item) =>
      item.id === id ? { ...item, done: !item.done } : item
    )
    await syncChecklist(next)
  }

  const removeItem = async (id: string) => {
    await syncChecklist(checklist.filter((item) => item.id !== id))
  }

  return (
    <>
      <div className="space-y-3">
        <div className="bg-gray-800 rounded-lg p-3 border border-gray-600/80">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 uppercase tracking-wide">Progress</span>
            <span className="text-sm font-mono">{currentProgress}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={currentProgress}
            onChange={(e) => setDraftProgress(parseInt(e.target.value, 10))}
            onMouseUp={(e) => void commitProgressChange(parseInt(e.currentTarget.value, 10))}
            onTouchEnd={(e) => void commitProgressChange(parseInt(e.currentTarget.value, 10))}
            className="w-full"
          />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            {nextPending && !activePrime && (
              <button
                type="button"
                onClick={openBacklogPrompt}
                className="text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline"
              >
                Check-in due at {nextPending}%
              </button>
            )}
            {upcoming && (
              <span className="text-gray-600">Next milestone: {upcoming}%</span>
            )}
            {ackedCount > 0 && (
              <span className="text-gray-600">
                {ackedCount} check-in{ackedCount === 1 ? '' : 's'} saved
              </span>
            )}
          </div>
          {task.progress_updated_at && (
            <p className="text-xs text-gray-500 mt-1">
              Updated {new Date(task.progress_updated_at).toLocaleString()}
            </p>
          )}
        </div>

        {milestoneUpdates.length > 0 && (
          <details className="bg-gray-800/60 rounded-lg border border-gray-700/80">
            <summary className="px-3 py-2 text-xs text-gray-400 cursor-pointer select-none">
              Progress notes ({milestoneUpdates.length})
            </summary>
            <ul className="px-3 pb-3 space-y-2 max-h-40 overflow-y-auto">
              {[...milestoneUpdates]
                .sort((a, b) => b.prime - a.prime)
                .map((entry) => (
                  <li key={entry.prime} className="text-xs border-l-2 border-indigo-700/50 pl-2">
                    <span className="text-indigo-300 font-mono">{entry.prime}%</span>
                    {entry.note ? (
                      <span className="text-gray-300 ml-2">{entry.note}</span>
                    ) : (
                      <span className="text-gray-500 ml-2 italic">Confirmed</span>
                    )}
                    <span className="text-gray-600 ml-2">
                      {new Date(entry.acknowledged_at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
            </ul>
          </details>
        )}

        <div className="bg-gray-800 rounded-lg p-3 border border-gray-600/80">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Checklist</span>
          <p className="text-xs text-gray-500 mt-1 mb-2">
            Checking items auto-updates progress % and may trigger check-ins at prime milestones.
          </p>
          <ul className="space-y-2 mb-2">
            {checklist.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => toggleItem(item.id)}
                />
                <span className={item.done ? 'line-through text-gray-500 flex-1' : 'flex-1'}>
                  {item.label}
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="text-xs text-gray-500 hover:text-red-300"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          {checklist.length < 7 && (
            <div className="flex gap-2">
              <input
                type="text"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addItem()}
                placeholder="Add step…"
                className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm"
              />
              <button
                type="button"
                onClick={addItem}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs"
              >
                Add
              </button>
            </div>
          )}
        </div>

        <div className="bg-gray-800 rounded-lg p-3 border border-gray-600/80">
          <label className="text-xs text-gray-500 uppercase tracking-wide">Your estimate (min)</label>
          <input
            type="number"
            min={1}
            value={task.user_estimate_minutes ?? ''}
            placeholder="Optional override"
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              void onUpdate({
                user_estimate_minutes: Number.isFinite(val) && val > 0 ? val : undefined
              })
            }}
            className="mt-2 w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm"
          />
        </div>
      </div>

      {activePrime && (
        <PrimeMilestonePrompt
          taskTitle={task.title}
          prime={activePrime}
          queueLength={milestoneQueue.length}
          onSave={handleMilestoneSave}
          onSkip={handleMilestoneSkip}
        />
      )}
    </>
  )
}
