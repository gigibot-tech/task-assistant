import { useCallback, useEffect, useState } from 'react'
import SemanticSorterReview from './SemanticSorterReview'
import {
  semanticSorterDryRun,
  semanticSorterApply,
  semanticSorterGetSettings,
  semanticSorterPickFolder,
  semanticSorterUpdateSettings
} from '../lib/electron-api'

export interface SorterDecisionRow {
  source: string
  category: string
  confidence: number
  destination: string
  reason: string
  human_category: string
  human_reason: string
  semantic_tags: string[]
  matched_rules: string[]
  script_category?: string
  script_confidence?: number
  script_reason?: string
  augmented_by_ollama?: boolean
  destination_relative?: string
}

interface SorterSettingsForm {
  sortInboxPath: string
  destRoot: string
  personalRoot: string
  hsRoot: string
  ollamaAugmentEnabled: boolean
  ollamaThreshold: number
  inspectContents: boolean
  minConfidence: number
  recursive: boolean
}

const defaultForm = (): SorterSettingsForm => ({
  sortInboxPath: '',
  destRoot: '',
  personalRoot: '',
  hsRoot: '',
  ollamaAugmentEnabled: true,
  ollamaThreshold: 0.62,
  inspectContents: true,
  minConfidence: 0.68,
  recursive: false
})

export default function SemanticSorterPanel() {
  const [form, setForm] = useState<SorterSettingsForm>(defaultForm)
  const [decisions, setDecisions] = useState<SorterDecisionRow[]>([])
  const [summary, setSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showReview, setShowReview] = useState(false)
  const [applyResult, setApplyResult] = useState<string | null>(null)

  const loadSettings = useCallback(async () => {
    try {
      const s = await semanticSorterGetSettings()
      setForm({
        sortInboxPath: String(s.sortInboxPath ?? ''),
        destRoot: String(s.destRoot ?? ''),
        personalRoot: String(s.personalRoot ?? ''),
        hsRoot: String(s.hsRoot ?? ''),
        ollamaAugmentEnabled: s.ollamaAugmentEnabled !== false,
        ollamaThreshold: Number(s.ollamaThreshold ?? 0.62),
        inspectContents: s.inspectContents !== false,
        minConfidence: Number(s.minConfidence ?? 0.68),
        recursive: !!s.recursive
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sorter settings')
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const persistSettings = async (patch: Partial<SorterSettingsForm>) => {
    const next = { ...form, ...patch }
    setForm(next)
    await semanticSorterUpdateSettings(next)
  }

  const pickFolder = async (field: keyof SorterSettingsForm) => {
    const result = await semanticSorterPickFolder()
    if (result.path) {
      await persistSettings({ [field]: result.path } as Partial<SorterSettingsForm>)
    }
  }

  const runDryRun = async () => {
    setLoading(true)
    setError(null)
    setApplyResult(null)
    try {
      await semanticSorterUpdateSettings(form)
      const result = await semanticSorterDryRun()
      setDecisions(result.decisions)
      setSummary(result.summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dry run failed')
    } finally {
      setLoading(false)
    }
  }

  const runApply = async () => {
    if (!decisions.length) return
    if (!window.confirm(`Move ${decisions.length} file(s)? This cannot be undone easily.`)) return
    setLoading(true)
    setError(null)
    try {
      const result = await semanticSorterApply(decisions)
      setApplyResult(`Moved ${result.moved} file(s).${result.errors.length ? ` ${result.errors.length} error(s).` : ''}`)
      if (result.errors.length) {
        setError(result.errors.map((e) => `${e.source}: ${e.error}`).join('\n'))
      }
      setDecisions([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-5xl">
      <h2 className="text-2xl font-bold mb-2 text-primary-300">Desktop Sorter</h2>
      <p className="text-sm text-gray-400 mb-6">
        Drag files into your sort inbox, dry-run here, then apply. Rule engine runs first; Ollama
        refines low-confidence items.
      </p>

      <div className="grid gap-4 mb-6">
        {(
          [
            ['sortInboxPath', 'Sort inbox (_Sort Inbox)'],
            ['destRoot', 'Destination root'],
            ['personalRoot', 'Personal OneDrive root'],
            ['hsRoot', 'HS-Hannover OneDrive root (optional)']
          ] as const
        ).map(([field, label]) => (
          <div key={field}>
            <label className="block text-sm text-gray-400 mb-1">{label}</label>
            <div className="flex gap-2">
              <input
                value={form[field]}
                onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                onBlur={() => semanticSorterUpdateSettings({ [field]: form[field] })}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm"
                placeholder="/path/to/folder"
              />
              <button
                type="button"
                onClick={() => pickFolder(field)}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm shrink-0"
              >
                Browse
              </button>
            </div>
          </div>
        ))}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.ollamaAugmentEnabled}
            onChange={(e) => persistSettings({ ollamaAugmentEnabled: e.target.checked })}
          />
          Ollama augment for review / low-confidence
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.inspectContents}
            onChange={(e) => persistSettings({ inspectContents: e.target.checked })}
          />
          Inspect text file contents (slower, more accurate)
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.recursive}
            onChange={(e) => persistSettings({ recursive: e.target.checked })}
          />
          Recursive (subfolders)
        </label>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          disabled={loading}
          onClick={runDryRun}
          className="px-4 py-2 bg-primary-700 hover:bg-primary-600 rounded-lg font-medium disabled:opacity-50"
        >
          {loading ? 'Running…' : 'Dry run'}
        </button>
        <button
          type="button"
          disabled={loading || !decisions.length}
          onClick={runApply}
          className="px-4 py-2 bg-teal-800 hover:bg-teal-700 rounded-lg font-medium disabled:opacity-50"
        >
          Apply moves
        </button>
        <button
          type="button"
          disabled={!decisions.length}
          onClick={() => setShowReview(true)}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium disabled:opacity-50"
        >
          Review & teach
        </button>
      </div>

      {summary && <p className="text-sm text-green-300 mb-2">{summary}</p>}
      {applyResult && <p className="text-sm text-teal-300 mb-2">{applyResult}</p>}
      {error && (
        <pre className="text-sm text-red-300 bg-red-950/40 border border-red-800 rounded-lg p-3 mb-4 whitespace-pre-wrap">
          {error}
        </pre>
      )}

      {decisions.length > 0 && (
        <div className="overflow-x-auto border border-gray-700 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-800 text-gray-400">
              <tr>
                <th className="text-left p-2">File</th>
                <th className="text-left p-2">Category</th>
                <th className="text-left p-2">Conf.</th>
                <th className="text-left p-2">Destination</th>
                <th className="text-left p-2">AI</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.source} className="border-t border-gray-700/80">
                  <td className="p-2 max-w-[200px] truncate" title={d.source}>
                    {d.source.split('/').pop()}
                  </td>
                  <td className="p-2">{d.category}</td>
                  <td className="p-2">{d.confidence.toFixed(2)}</td>
                  <td className="p-2 max-w-[240px] truncate" title={d.destination}>
                    {d.destination}
                  </td>
                  <td className="p-2">{d.augmented_by_ollama ? 'yes' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showReview && (
        <SemanticSorterReview
          decisions={decisions}
          onClose={() => setShowReview(false)}
          onSaved={() => setSummary((s) => (s ? `${s} Feedback saved.` : 'Feedback saved.'))}
        />
      )}
    </div>
  )
}
