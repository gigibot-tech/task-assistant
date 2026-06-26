import { useEffect, useState } from 'react'
import type { SorterDecisionRow } from './SemanticSorterPanel'

interface SemanticSorterReviewProps {
  decisions: SorterDecisionRow[]
  onClose: () => void
  onSaved: () => void
}

export default function SemanticSorterReview({
  decisions,
  onClose,
  onSaved
}: SemanticSorterReviewProps) {
  const [index, setIndex] = useState(0)
  const [category, setCategory] = useState('')
  const [destination, setDestination] = useState('')
  const [tags, setTags] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const row = decisions[index]

  useEffect(() => {
    const d = decisions[index]
    if (!d) return
    setCategory(d.script_category ?? d.category)
    setDestination(d.destination)
    setTags((d.semantic_tags ?? []).join(';'))
    setNote('')
  }, [index, decisions])

  if (!row) {
    return (
      <div className="p-6 text-gray-400">
        No decisions to review.
        <button type="button" onClick={onClose} className="ml-3 text-primary-400 underline">
          Close
        </button>
      </div>
    )
  }

  const saveFeedback = async (acceptScript: boolean) => {
    setSaving(true)
    try {
      const sourceName = row.source.split('/').pop() ?? row.source
      await window.electron.semanticSorterSaveFeedback({
        created_at: new Date().toISOString(),
        source: row.source,
        source_name: sourceName,
        category: category.trim() || 'review',
        destination: destination.trim(),
        tags: tags
          .split(';')
          .map((t) => t.trim())
          .filter(Boolean),
        note: acceptScript ? 'accepted script decision' : note.trim()
      })
      onSaved()
      if (index + 1 >= decisions.length) {
        onClose()
      } else {
        setIndex(index + 1)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-800 border border-gray-600 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-primary-300">Review sort decisions</h2>
            <p className="text-sm text-gray-400 mt-1">
              {index + 1} / {decisions.length} — {row.source.split('/').pop()}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
            Close
          </button>
        </div>

        <p className="text-sm text-gray-300 mb-4">
          Script: {row.script_category ?? row.category} ({(row.script_confidence ?? row.confidence).toFixed(2)}) →{' '}
          {row.destination}
          {row.augmented_by_ollama && (
            <span className="ml-2 text-teal-400 text-xs">Ollama augmented</span>
          )}
        </p>

        <div className="grid gap-3 mb-4">
          <label className="block text-sm">
            <span className="text-gray-400">Category</span>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-400">Destination</span>
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-400">Tags (semicolon-separated)</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-400">Note</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg"
            />
          </label>
        </div>

        <details className="text-xs text-gray-500 mb-4">
          <summary className="cursor-pointer text-gray-400">Details</summary>
          <pre className="mt-2 whitespace-pre-wrap">{JSON.stringify(row, null, 2)}</pre>
        </details>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={index === 0 || saving}
            onClick={() => setIndex(Math.max(0, index - 1))}
            className="px-3 py-2 bg-gray-700 rounded-lg text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => saveFeedback(true)}
            className="px-3 py-2 bg-primary-700 hover:bg-primary-600 rounded-lg text-sm"
          >
            Accept
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => saveFeedback(false)}
            className="px-3 py-2 bg-teal-800 hover:bg-teal-700 rounded-lg text-sm"
          >
            Save correction
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (index + 1 >= decisions.length) onClose()
              else setIndex(index + 1)
            }}
            className="px-3 py-2 bg-gray-700 rounded-lg text-sm"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}
