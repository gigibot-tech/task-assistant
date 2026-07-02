import { useEffect, useState } from 'react'
import TooltipChip from './TooltipChip'
import {
  DRIVE_ASPECT_LABELS,
  emptyDriveNotes,
  getAspectBullets,
  getAspectPromptQuestion,
  getAspectTooltip,
  type DriveAspect,
  type DriveCheckInMode
} from '../lib/taskDrive'

interface DriveCheckInModalProps {
  taskTitle: string
  taskDay: number
  primeDay: number
  mode: DriveCheckInMode
  aspects: DriveAspect[]
  initialNotes?: Partial<Record<DriveAspect, string>>
  onSave: (notes: Record<DriveAspect, string>) => Promise<void>
  onLater: () => void
}

function modeSubtitle(mode: DriveCheckInMode, taskDay: number, primeDay: number): string {
  if (mode === 'prime') return `Day ${taskDay} · Prime ${primeDay} check-in`
  if (mode === 'daily') return `Day ${taskDay} · Daily reflection`
  return `Day ${taskDay} · Reflection`
}

export default function DriveCheckInModal({
  taskTitle,
  taskDay,
  primeDay,
  mode,
  aspects,
  initialNotes,
  onSave,
  onLater
}: DriveCheckInModalProps) {
  const [notes, setNotes] = useState(emptyDriveNotes())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setNotes(mergeInitialNotes(initialNotes))
    setSaving(false)
    // Reset when modal context changes, not on every initialNotes object reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primeDay, taskTitle, mode, aspects.join('|')])

  function mergeInitialNotes(partial?: Partial<Record<DriveAspect, string>>) {
    const base = emptyDriveNotes()
    if (!partial) return base
    for (const aspect of aspects) {
      if (partial[aspect]) base[aspect] = partial[aspect] ?? ''
    }
    return base
  }

  const setAspect = (aspect: DriveAspect, value: string) => {
    setNotes((prev) => ({ ...prev, [aspect]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(notes)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-labelledby="drive-checkin-title"
    >
      <div className="w-full max-w-lg bg-gray-900 border border-violet-700/60 rounded-xl shadow-2xl p-5 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="mb-4">
          <p className="text-xs text-violet-300 font-medium uppercase tracking-wide">
            {modeSubtitle(mode, taskDay, primeDay)}
          </p>
          <h2 id="drive-checkin-title" className="text-lg font-semibold text-white mt-0.5 truncate">
            {taskTitle}
          </h2>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {aspects.map((aspect) => (
            <TooltipChip
              key={aspect}
              label={DRIVE_ASPECT_LABELS[aspect]}
              tooltip={getAspectTooltip(aspect, taskTitle)}
            />
          ))}
        </div>

        <div className="space-y-4">
          {aspects.map((aspect) => (
            <div key={aspect}>
              <p className="text-sm font-medium text-violet-200 mb-1">
                {DRIVE_ASPECT_LABELS[aspect]}
              </p>
              <ul className="text-xs text-gray-500 mb-2 space-y-0.5 list-disc list-inside">
                {getAspectBullets(aspect).map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
              <label className="sr-only" htmlFor={`drive-${aspect}`}>
                {DRIVE_ASPECT_LABELS[aspect]}
              </label>
              <textarea
                id={`drive-${aspect}`}
                value={notes[aspect]}
                onChange={(e) => setAspect(aspect, e.target.value)}
                placeholder={getAspectPromptQuestion(aspect)}
                rows={2}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-gray-100 placeholder:text-gray-500 resize-none focus:outline-none focus:border-violet-500"
              />
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onLater}
            disabled={saving}
            className="flex-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 disabled:opacity-50"
          >
            Later today
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex-[2] px-3 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save check-in'}
          </button>
        </div>
      </div>
    </div>
  )
}
