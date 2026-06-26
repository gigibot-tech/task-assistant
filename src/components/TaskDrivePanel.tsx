import { useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Task } from '../store/taskStore'
import TooltipChip from './TooltipChip'
import SubtaskProbeModal from './SubtaskProbeModal'
import AspectDailyModal from './AspectDailyModal'
import {
  aspectPromptKey,
  markPromptedToday,
  primePromptKey
} from '../lib/dailyPrompts'
import {
  DRIVE_ASPECTS,
  DRIVE_ASPECT_LABELS,
  countAspectsAnsweredToday,
  emptyDriveNotes,
  entryHasNote,
  filterCheckinsByWindow,
  formatCheckinRowLabel,
  getAspectPromptQuestion,
  getAspectTooltip,
  getDailyAspectQueue,
  getNextPrimeCheckIn,
  getTaskDayIndex,
  isPrimeProbeDueToday,
  type DriveAspect,
  type DriveReflectionEntry,
  type DriveWindowDays
} from '../lib/taskDrive'

interface TaskDrivePanelProps {
  task: Task
  onUpdate: (updates: Partial<Task>) => Promise<void>
}

const WINDOW_OPTIONS: DriveWindowDays[] = [7, 14, 30, 90]

export default function TaskDrivePanel({ task, onUpdate }: TaskDrivePanelProps) {
  const [showProbeModal, setShowProbeModal] = useState(false)
  const [showAspectModal, setShowAspectModal] = useState(false)
  const [modalPrime, setModalPrime] = useState<number | null>(null)
  const [dailyAspect, setDailyAspect] = useState<DriveAspect | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [adhocAspect, setAdhocAspect] = useState<DriveAspect | null>(null)
  const [adhocNote, setAdhocNote] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const autoPromptedRef = useRef<string | null>(null)

  const workStartedAt =
    task.drive_work_started_at ??
    task.work_sessions?.[0]?.started_at ??
    (task.status === 'in_progress' ? task.start_time : undefined)

  const taskDay = getTaskDayIndex(workStartedAt)
  const windowDays = (task.drive_window_days ?? 14) as DriveWindowDays
  const checkins = task.drive_checkins ?? []
  const acknowledged = task.drive_acknowledged_primes ?? []
  const promptDates = task.drive_prompt_dates ?? {}

  const duePrimeToday = isPrimeProbeDueToday(taskDay, acknowledged, checkins, promptDates)
  const nextPrime = getNextPrimeCheckIn(taskDay, acknowledged, checkins)
  const dailyAspectQueue = useMemo(
    () => getDailyAspectQueue(checkins, promptDates),
    [checkins, promptDates]
  )
  const aspectsAnsweredToday = countAspectsAnsweredToday(checkins)

  const filteredHistory = useMemo(
    () => filterCheckinsByWindow(checkins, windowDays),
    [checkins, windowDays]
  )

  const selectedEntry = filteredHistory.find((e) => e.id === selectedEntryId) ?? null

  useEffect(() => {
    autoPromptedRef.current = null
  }, [task.id])

  useEffect(() => {
    if (task.status !== 'in_progress') return
    if (showProbeModal || showAspectModal) return

    const autoKey =
      duePrimeToday != null
        ? `prime:${duePrimeToday}`
        : dailyAspectQueue[0]
          ? `aspect:${dailyAspectQueue[0]}`
          : null

    if (!autoKey || autoPromptedRef.current === autoKey) return
    autoPromptedRef.current = autoKey

    if (duePrimeToday != null) {
      setModalPrime(duePrimeToday)
      setShowProbeModal(true)
      return
    }

    const aspect = dailyAspectQueue[0]
    if (aspect) {
      setDailyAspect(aspect)
      setShowAspectModal(true)
    }
  }, [
    task.status,
    duePrimeToday,
    dailyAspectQueue,
    showProbeModal,
    showAspectModal,
    task.id
  ])

  const snoozePrompt = async (key: string) => {
    await onUpdate({
      drive_prompt_dates: markPromptedToday(promptDates, key)
    })
  }

  const savePrimeProbe = async (updates: {
    subtasks: import('../lib/subtaskTypes').TaskSubtask[]
    active_subtask_id: string
    probe_must_code_by?: string
    drive_acknowledged_primes?: number[]
  }) => {
    if (modalPrime == null) return

    const nextAck = [
      ...new Set([
        ...acknowledged,
        ...(updates.drive_acknowledged_primes ?? [modalPrime])
      ])
    ].sort((a, b) => a - b)

    const nextDates = markPromptedToday(promptDates, primePromptKey(modalPrime))

    await onUpdate({
      subtasks: updates.subtasks,
      active_subtask_id: updates.active_subtask_id,
      probe_must_code_by: updates.probe_must_code_by,
      drive_acknowledged_primes: nextAck,
      drive_prompt_dates: nextDates
    })

    setShowProbeModal(false)
    setModalPrime(null)
  }

  const handleProbeLater = async () => {
    if (modalPrime != null) {
      await snoozePrompt(primePromptKey(modalPrime))
    }
    setShowProbeModal(false)
    setModalPrime(null)
    autoPromptedRef.current = null
  }

  const handleAspectLater = async () => {
    if (dailyAspect) {
      await snoozePrompt(aspectPromptKey(dailyAspect))
    }
    setShowAspectModal(false)
    setDailyAspect(null)
    autoPromptedRef.current = null
  }

  const saveAspectNote = async (aspect: DriveAspect, note: string) => {
    const notes = emptyDriveNotes()
    notes[aspect] = note

    const entry: DriveReflectionEntry = {
      id: uuidv4(),
      prime_day: 0,
      task_day: taskDay,
      recorded_at: new Date().toISOString(),
      notes
    }

    await onUpdate({
      drive_checkins: [...checkins, entry],
      drive_prompt_dates: markPromptedToday(promptDates, aspectPromptKey(aspect))
    })
  }

  const handleAspectSave = async (note: string) => {
    if (!dailyAspect) return
    await saveAspectNote(dailyAspect, note)
    setShowAspectModal(false)
    setDailyAspect(null)
    autoPromptedRef.current = null
  }

  const saveAdhocNote = async () => {
    if (!adhocAspect) return
    const trimmed = adhocNote.trim()
    if (!trimmed) {
      setAdhocAspect(null)
      setAdhocNote('')
      return
    }

    await saveAspectNote(adhocAspect, trimmed)
    setAdhocAspect(null)
    setAdhocNote('')
  }

  const setWindow = async (days: DriveWindowDays) => {
    await onUpdate({ drive_window_days: days })
  }

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

        <div className="flex flex-wrap gap-2 mb-2">
          {DRIVE_ASPECTS.map((aspect) => (
            <TooltipChip
              key={aspect}
              label={DRIVE_ASPECT_LABELS[aspect]}
              tooltip={getAspectTooltip(aspect, task.title)}
              active={adhocAspect === aspect}
              onClick={() => {
                setAdhocAspect(aspect)
                setAdhocNote('')
              }}
            />
          ))}
        </div>

        {adhocAspect && (
          <div className="mb-2 flex gap-2">
            <textarea
              value={adhocNote}
              onChange={(e) => setAdhocNote(e.target.value)}
              placeholder={getAspectPromptQuestion(adhocAspect)}
              rows={2}
              autoFocus
              className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm resize-none focus:outline-none focus:border-violet-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void saveAdhocNote()
                if (e.key === 'Escape') {
                  setAdhocAspect(null)
                  setAdhocNote('')
                }
              }}
            />
            <button
              type="button"
              onClick={() => void saveAdhocNote()}
              className="px-3 py-1.5 bg-violet-800 hover:bg-violet-700 rounded text-xs text-white self-end"
            >
              Save
            </button>
          </div>
        )}

        <p className="text-xs text-gray-500">
          Today: {aspectsAnsweredToday}/{DRIVE_ASPECTS.length} reflections
          {duePrimeToday != null
            ? ` · Prime ${duePrimeToday} probe due`
            : nextPrime != null
              ? ` · Next prime probe: day ${nextPrime}`
              : workStartedAt
                ? ` · Day ${taskDay}`
                : ' · Start task work to begin check-ins'}
        </p>

        <details
          className="mt-3"
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
                      onClick={() =>
                        setSelectedEntryId(isSelected ? null : entry.id)
                      }
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
                        {DRIVE_ASPECTS.map((aspect) => (
                          <span
                            key={aspect}
                            className={`w-1.5 h-1.5 rounded-full ${
                              entryHasNote(entry, aspect) ? 'bg-violet-400' : 'bg-gray-600'
                            }`}
                            title={DRIVE_ASPECT_LABELS[aspect]}
                          />
                        ))}
                      </div>
                    </button>
                    {isSelected && (
                      <div className="px-2 py-2 mb-1 ml-1 border-l-2 border-violet-800/60 space-y-2">
                        {DRIVE_ASPECTS.map((aspect) => (
                          <div key={aspect} className="text-xs">
                            <span className="text-violet-300 font-medium">
                              {DRIVE_ASPECT_LABELS[aspect]}:
                            </span>{' '}
                            <span className="text-gray-400">
                              {entry.notes[aspect]?.trim() || (
                                <em className="text-gray-600">—</em>
                              )}
                            </span>
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

        <button
          type="button"
          onClick={() => {
            setModalPrime(null)
            setShowProbeModal(true)
          }}
          className="mt-2 text-xs text-orange-300 hover:text-orange-200 underline"
        >
          I'm stuck — probe subtask
        </button>
      </div>

      {showProbeModal && (
        <SubtaskProbeModal
          taskId={task.id}
          taskTitle={task.title}
          taskDay={taskDay}
          primeDay={modalPrime}
          trigger={modalPrime != null ? 'prime_day' : 'manual'}
          existingSubtasks={task.subtasks ?? []}
          activeSubtaskId={task.active_subtask_id}
          onLater={() => void handleProbeLater()}
          onAccept={savePrimeProbe}
        />
      )}

      {showAspectModal && dailyAspect && (
        <AspectDailyModal
          taskTitle={task.title}
          taskDay={taskDay}
          aspect={dailyAspect}
          onSave={handleAspectSave}
          onLater={() => void handleAspectLater()}
        />
      )}
    </>
  )
}
