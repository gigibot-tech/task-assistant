import { useEffect, useRef, useState } from 'react'
import type { Task } from '../store/taskStore'
import PrimeMilestonePrompt from './PrimeMilestonePrompt'
import {
  effectiveEstimateMinutes,
  estimateTaskTime,
  formatEstimateLabel
} from '../lib/taskEstimate'
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
  const [milestoneQueue, setMilestoneQueue] = useState<PrimeMilestone[]>([])
  const [draftProgress, setDraftProgress] = useState<number | null>(null)
  const [estimating, setEstimating] = useState(false)
  const [estimateError, setEstimateError] = useState<string | null>(null)
  const autoEstimateAttemptedRef = useRef(false)
  const progressBaselineRef = useRef(clampProgressPercent(task.progress_percent ?? 0))

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
    autoEstimateAttemptedRef.current = false
    setEstimateError(null)
  }, [task.id, task.progress_percent])

  const runTaskEstimate = async () => {
    setEstimating(true)
    setEstimateError(null)
    try {
      const result = await estimateTaskTime(task)
      await onUpdate({ ai_estimate_minutes: result.estimate })
    } catch (err) {
      setEstimateError(err instanceof Error ? err.message : 'Estimate failed')
    } finally {
      setEstimating(false)
    }
  }

  useEffect(() => {
    if (autoEstimateAttemptedRef.current) return
    if (effectiveEstimateMinutes(task) != null) return
    if (!task.title.trim()) return
    autoEstimateAttemptedRef.current = true
    void runTaskEstimate()
  }, [task.id, task.title, task.ai_estimate_minutes, task.user_estimate_minutes])

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
          <p className="text-xs text-gray-500 mt-2">
            Add and complete steps in Task Breakdown below — or drag the slider to override.
          </p>
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
          {estimateError && (
            <p className="text-xs text-red-300 mt-1">{estimateError}</p>
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
