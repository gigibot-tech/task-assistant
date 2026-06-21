import { useEffect, useState } from 'react'
import type { ProgressMilestoneUpdate } from '../lib/progressMilestones'
import { milestoneLabel } from '../lib/progressMilestones'

interface PrimeMilestonePromptProps {
  taskTitle: string
  prime: number
  queueLength: number
  onSave: (note: string) => Promise<void>
  onSkip: () => void
}

export default function PrimeMilestonePrompt({
  taskTitle,
  prime,
  queueLength,
  onSave,
  onSkip
}: PrimeMilestonePromptProps) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setNote('')
    setSaving(false)
  }, [prime])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(note.trim())
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-labelledby="milestone-prompt-title"
    >
      <div className="w-full max-w-md bg-gray-900 border border-indigo-700/60 rounded-xl shadow-2xl p-5 animate-slide-up">
        <div className="flex items-start gap-3 mb-3">
          <span className="text-2xl shrink-0" aria-hidden>
            📍
          </span>
          <div className="min-w-0">
            <p className="text-xs text-indigo-300 font-medium uppercase tracking-wide">
              Progress check-in · {milestoneLabel(prime)}
            </p>
            <h2 id="milestone-prompt-title" className="text-lg font-semibold text-white mt-0.5 truncate">
              {taskTitle}
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              You reached <span className="text-indigo-200 font-medium">{prime}%</span>. What&apos;s
              done so far?
            </p>
            {queueLength > 1 && (
              <p className="text-xs text-gray-500 mt-1">
                {queueLength - 1} more check-in{queueLength - 1 === 1 ? '' : 's'} after this one
              </p>
            )}
          </div>
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional — e.g. finished outline, blocked on review…"
          rows={3}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-gray-100 placeholder:text-gray-500 resize-none focus:outline-none focus:border-indigo-500"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              void handleSave()
            }
          }}
        />

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={onSkip}
            disabled={saving}
            className="flex-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 disabled:opacity-50"
          >
            Later
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex-[2] px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : note.trim() ? 'Save update' : 'Looks good'}
          </button>
        </div>
      </div>
    </div>
  )
}

export type { ProgressMilestoneUpdate }
