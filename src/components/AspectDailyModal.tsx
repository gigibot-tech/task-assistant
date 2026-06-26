import { useEffect, useState } from 'react'
import TooltipChip from './TooltipChip'
import {
  DRIVE_ASPECT_LABELS,
  getAspectPromptQuestion,
  getAspectTooltip,
  type DriveAspect
} from '../lib/taskDrive'

interface AspectDailyModalProps {
  taskTitle: string
  taskDay: number
  aspect: DriveAspect
  onSave: (note: string) => Promise<void>
  onLater: () => void
}

export default function AspectDailyModal({
  taskTitle,
  taskDay,
  aspect,
  onSave,
  onLater
}: AspectDailyModalProps) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setNote('')
    setSaving(false)
  }, [aspect, taskTitle])

  const handleSave = async () => {
    const trimmed = note.trim()
    if (!trimmed) {
      onLater()
      return
    }
    setSaving(true)
    try {
      await onSave(trimmed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-labelledby="aspect-daily-title"
    >
      <div className="w-full max-w-md bg-gray-900 border border-violet-700/60 rounded-xl shadow-2xl p-5 animate-slide-up">
        <div className="mb-4">
          <p className="text-xs text-violet-300 font-medium uppercase tracking-wide">
            Day {taskDay} · Daily reflection
          </p>
          <h2 id="aspect-daily-title" className="text-lg font-semibold text-white mt-0.5 truncate">
            {taskTitle}
          </h2>
        </div>

        <div className="mb-3">
          <TooltipChip
            label={DRIVE_ASPECT_LABELS[aspect]}
            tooltip={getAspectTooltip(aspect, taskTitle)}
            active
          />
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={getAspectPromptQuestion(aspect)}
          rows={3}
          autoFocus
          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-gray-100 placeholder:text-gray-500 resize-none focus:outline-none focus:border-violet-500"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleSave()
            if (e.key === 'Escape') onLater()
          }}
        />

        <div className="flex gap-2 mt-4">
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
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
