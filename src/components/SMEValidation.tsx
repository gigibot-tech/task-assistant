import { useState } from 'react'

export default function SMEValidation() {
  const [topic, setTopic] = useState('')
  const [opinion, setOpinion] = useState('')
  const [result, setResult] = useState<{
    alignment: number
    feedback: string
    agreement: 'agree' | 'disagree' | 'partial'
    reasoning: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleValidate = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!topic || !opinion) {
      setError('Please fill in both fields')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const validation = await window.electron.validateWithSME(opinion, topic)
      setResult(validation)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed')
    } finally {
      setLoading(false)
    }
  }

  const getAgreementColor = (agreement: string) => {
    switch (agreement) {
      case 'agree': return 'bg-green-900/50 text-green-200 border-green-700'
      case 'disagree': return 'bg-red-900/50 text-red-200 border-red-700'
      case 'partial': return 'bg-yellow-900/50 text-yellow-200 border-yellow-700'
      default: return 'bg-gray-700 text-gray-300 border-gray-600'
    }
  }

  const getAgreementIcon = (agreement: string) => {
    switch (agreement) {
      case 'agree': return '✅'
      case 'disagree': return '❌'
      case 'partial': return '⚠️'
      default: return '❓'
    }
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-2">SME Opinion Validation</h2>
      <p className="text-gray-400 mb-6">
        Validate your approach against AI-powered subject matter expert knowledge using gemma4:latest.
      </p>

      <form onSubmit={handleValidate} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Topic / Domain *</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-primary-500"
            placeholder="e.g., Machine Learning Best Practices"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Your Approach / Opinion *</label>
          <textarea
            value={opinion}
            onChange={(e) => setOpinion(e.target.value)}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-primary-500 h-32"
            placeholder="Describe your approach or opinion..."
            required
          />
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-red-200 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg font-medium transition-colors"
        >
          {loading ? 'Consulting SME...' : 'Get Expert Opinion'}
        </button>
      </form>

      {result && (
        <div className="mt-6 space-y-4">
          <div className={`p-4 rounded-lg border-2 ${getAgreementColor(result.agreement)}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">{getAgreementIcon(result.agreement)}</span>
              <h3 className="text-lg font-bold capitalize">
                {result.agreement === 'partial' ? 'Partially Agrees' : result.agreement}
              </h3>
              <span className="ml-auto text-sm">
                Alignment: {Math.round(result.alignment * 100)}%
              </span>
            </div>
          </div>

          <div className="bg-gray-800 border border-gray-700 p-4 rounded-lg">
            <h4 className="font-semibold mb-2">SME Feedback</h4>
            <p className="text-gray-300 text-sm">{result.feedback}</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 p-4 rounded-lg">
            <h4 className="font-semibold mb-2">Reasoning</h4>
            <p className="text-gray-300 text-sm">{result.reasoning}</p>
          </div>

          <button
            onClick={() => {
              setResult(null)
              setTopic('')
              setOpinion('')
            }}
            className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors"
          >
            New Validation
          </button>
        </div>
      )}
    </div>
  )
}
