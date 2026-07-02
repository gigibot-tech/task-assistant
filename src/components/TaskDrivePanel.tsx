import { useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Task } from '../store/taskStore'
import TooltipChip from './TooltipChip'
import DriveCheckInModal from './DriveCheckInModal'
import type { OpenProbeHandler } from '../features/manifests'
import {
  driveDailyPromptKey,
  markPromptedToday,
  primePromptKey
} from '../lib/dailyPrompts'
import {
  DRIVE_ASPECT_LABELS,
  consolidateDriveCheckins,
  countAspectsAnsweredToday,
  filterCheckinsByWindow,
  formatCheckinRowLabel,
  formatPrimeSchedulePreview,
  getAspectBullets,
  getAspectTooltip,
  getDailyAspectQueue,
  getEnabledDriveAspects,
  getNextPrimeCheckIn,
  getTaskDayIndex,
  isPrimeProbeDueToday,
  todayDriveNotes,
  upsertDriveCheckin,
  type DriveAspect,
  type DriveCheckInMode,
  type DriveWindowDays
} from '../lib/taskDrive'

interface TaskDrivePanelProps {
  task: Task
  onUpdate: (updates: Partial<Task>) => Promise<void>
  onOpenProbe?: OpenProbeHandler
}

const WINDOW_OPTIONS: DriveWindowDays[] = [7, 14, 30, 90]

export default function TaskDrivePanel({ task, onUpdate, onOpenProbe }: TaskDrivePanelProps) {
  const [showCheckInModal, setShowCheckInModal] = useState(false)
  const [checkInMode, setCheckInMode] = useState<DriveCheckInMode>('daily')
  const [modalPrime, setModalPrime] = useState<number | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [enabledAspects, setEnabledAspects] = useState<DriveAspect[]>(
    getEnabledDriveAspects()
  )
  const autoPromptedRef = useRef<string | null>(null)

  const workStartedAt =
    task.drive_work_started_at ??
    task.work_sessions?.[0]?.started_at ??
    (task.status === 'in_progress' ? task.start_time : undefined)

  const taskDay = getTaskDayIndex(workStartedAt)
  const windowDays = (task.drive_window_days ?? 14) as DriveWindowDays
  const checkins = useMemo(
    () => consolidateDriveCheckins(task.drive_checkins),
    [task.drive_checkins]
  )
  const acknowledged = task.drive_acknowledged_primes ?? []
  const promptDates = task.drive_prompt_dates ?? {}

  const duePrimeToday = isPrimeProbeDueToday(taskDay, acknowledged, checkins, promptDates)
  const nextPrime = getNextPrimeCheckIn(taskDay, acknowledged, checkins)
  const dailyAspectQueue = useMemo(
    () => getDailyAspectQueue(checkins, promptDates, enabledAspects),
    [checkins, promptDates, enabledAspects]
  )
  const aspectsAnsweredToday = countAspectsAnsweredToday(checkins, enabledAspects)

  const filteredHistory = useMemo(
    () => filterCheckinsByWindow(checkins, windowDays),
    [checkins, windowDays]
  )

  const selectedEntry = filteredHistory.find((e) => e.id === selectedEntryId) ?? null

  useEffect(() => {
    void window.electron.getSettings().then((settings) => {
      setEnabledAspects(getEnabledDriveAspects(settings))
    })
  }, [task.id])

  useEffect(() => {
    autoPromptedRef.current = null
  }, [task.id])

  useEffect(() => {
    if (task.status !== 'in_progress') return
    if (showCheckInModal) return
    if (!enabledAspects.length) return

    const autoKey =
      duePrimeToday != null
        ? `prime:${duePrimeToday}`
        : dailyAspectQueue.length > 0
          ? 'drive:daily'
          : null

    if (!autoKey || autoPromptedRef.current === autoKey) return
    autoPromptedRef.current = autoKey

    if (duePrimeToday != null) {
      openCheckIn('prime', duePrimeToday)
      return
    }

    if (dailyAspectQueue.length > 0) {
      openCheckIn('daily', 0)
    }
  }, [
    task.status,
    duePrimeToday,
    dailyAspectQueue.length,
    showCheckInModal,
    task.id,
    enabledAspects.length
  ])

  const openCheckIn = (mode: DriveCheckInMode, prime: number | null) => {
    setCheckInMode(mode)
    setModalPrime(prime)
    setShowCheckInModal(true)
  }

  const snoozePrompt = async (key: string) => {
    await onUpdate({
      drive_prompt_dates: markPromptedToday(promptDates, key)
    })
  }

  const saveCheckIn = async (notes: Record<DriveAspect, string>) => {
    const primeDay = checkInMode === 'prime' && modalPrime != null ? modalPrime : 0
    const nextCheckins = upsertDriveCheckin(checkins, {
      id: uuidv4(),
      taskDay,
      primeDay,
      notes
    })

    const updates: Partial<Task> = {
      drive_checkins: nextCheckins
    }

    if (checkInMode === 'prime' && modalPrime != null) {
      updates.drive_acknowledged_primes = [
        ...new Set([...acknowledged, modalPrime])
      ].sort((a, b) => a - b)
      updates.drive_prompt_dates = markPromptedToday(promptDates, primePromptKey(modalPrime))
    } else {
      updates.drive_prompt_dates = markPromptedToday(promptDates, driveDailyPromptKey())
    }

    await onUpdate(updates)
    setShowCheckInModal(false)
    setModalPrime(null)
  }

  const handleCheckInLater = async () => {
    if (checkInMode === 'prime' && modalPrime != null) {
      await snoozePrompt(primePromptKey(modalPrime))
    } else {
      await snoozePrompt(driveDailyPromptKey())
    }
    setShowCheckInModal(false)
    setModalPrime(null)
    autoPromptedRef.current = null
  }

  const setWindow = async (days: DriveWindowDays) => {
    await onUpdate({ drive_window_days: days })
  }

  const initialNotes = todayDriveNotes(checkins)

  return (
    <>
      <div className="bg-gray-800 rounded-lg p-3 border border-gray-600/80">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Task drive</span>
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <span>Window</span>
            <select
              value={windowDays}
              onChange={(e) => void setWindow(parseInt(e.target.value, 10) as DriveWindowDays)}
              className="bg-gray-700 border border-gray-600 rounded px-1.5 py-0.5 text-gray-300"
            >
              {WINDOW_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}d
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mb-3 p-2.5 rounded-lg bg-gray-900/60 border border-gray-700/80 space-y-1.5">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium">Prompts</p>
          <ul className="text-xs text-gray-400 space-y-1">
            <li>
              <span className="text-violet-300">Prime check-in</span> — days{' '}
              {formatPrimeSchedulePreview()} (all enabled aspects in one form)
            </li>
            <li>
              <span className="text-violet-300">Daily reflection</span> — once per day if aspects
              are still unanswered
            </li>
            <li>
              <span className="text-violet-300">Subtask probe</span> — manual only (
              <span className="italic">I&apos;m stuck</span>)
            </li>
          </ul>
          <p className="text-xs text-gray-500 pt-1 border-t border-gray-700/60">
            {workStartedAt ? (
              <>
                Day {taskDay}
                {duePrimeToday != null
                  ? ` · Prime ${duePrimeToday} check-in due`
                  : nextPrime != null
                    ? ` · Next prime: day ${nextPrime}`
                    : ''}
                {' · '}
                {aspectsAnsweredToday}/{enabledAspects.length} reflections today
              </>
            ) : (
              'Start task work to begin check-ins'
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 mb-2">
          {enabledAspects.map((aspect) => (
            <TooltipChip
              key={aspect}
              label={DRIVE_ASPECT_LABELS[aspect]}
              tooltip={getAspectTooltip(aspect, task.title)}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => openCheckIn('adhoc', 0)}
          className="mb-2 text-xs px-2.5 py-1.5 bg-violet-900/50 hover:bg-violet-800/60 border border-violet-700/50 rounded text-violet-200"
        >
          Reflect now
        </button>

        <details
          className="mt-2"
          open={historyOpen}
          onToggle={(e) => setHistoryOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="text-xs text-gray-400 cursor-pointer select-none">
            Drive history ({filteredHistory.length})
          </summary>
          {filteredHistory.length === 0 ? (
            <p className="text-xs text-gray-600 mt-2 px-1">No entries in the last {windowDays} days.</p>
          ) : (
            <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {filteredHistory.map((entry) => {
                const isSelected = selectedEntryId === entry.id
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedEntryId(isSelected ? null : entry.id)}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                        isSelected
                          ? 'bg-violet-900/40 border border-violet-700/50'
                          : 'hover:bg-gray-700/60 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-300 font-medium">
                          {formatCheckinRowLabel(entry)}
                        </span>
                        <span className="text-gray-600 shrink-0">
                          {new Date(entry.recorded_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex gap-1 mt-1">
                        {enabledAspects.map((aspect) => (
                          <span
                            key={aspect}
                            className={`w-1.5 h-1.5 rounded-full ${
                              entry.notes[aspect]?.trim() ? 'bg-violet-400' : 'bg-gray-600'
                            }`}
                            title={DRIVE_ASPECT_LABELS[aspect]}
                          />
                        ))}
                      </div>
                    </button>
                    {isSelected && (
                      <div className="px-2 py-2 mb-1 ml-1 border-l-2 border-violet-800/60 space-y-3">
                        {enabledAspects.map((aspect) => (
                          <div key={aspect} className="text-xs">
                            <p className="text-violet-300 font-medium mb-0.5">
                              {DRIVE_ASPECT_LABELS[aspect]}
                            </p>
                            <ul className="text-gray-600 list-disc list-inside mb-1 space-y-0.5">
                              {getAspectBullets(aspect).map((bullet) => (
                                <li key={bullet}>{bullet}</li>
                              ))}
                            </ul>
                            <p className="text-gray-400">
                              {entry.notes[aspect]?.trim() || (
                                <em className="text-gray-600">—</em>
                              )}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </details>

        {onOpenProbe && (
          <button
            type="button"
            onClick={() => onOpenProbe('manual', { taskDay })}
            className="mt-2 text-xs text-orange-300 hover:text-orange-200 underline"
          >
            I&apos;m stuck — probe subtask
          </button>
        )}
      </div>

      {showCheckInModal && (
        <DriveCheckInModal
          taskTitle={task.title}
          taskDay={taskDay}
          primeDay={modalPrime ?? 0}
          mode={checkInMode}
          aspects={enabledAspects}
          initialNotes={checkInMode !== 'prime' ? initialNotes : undefined}
          onSave={saveCheckIn}
          onLater={() => void handleCheckInLater()}
        />
      )}
    </>
  )
}
