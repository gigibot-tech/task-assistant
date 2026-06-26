import { useState } from 'react'
import { formatDuration } from '../lib/timeFormat'

interface OfflineTimePromptProps {
  taskId: string
  taskTitle: string
  offlineMinutes: number
  sessionStartedAt: string
  onSubmit: (breakMinutes: number, workMinutes: number) => void
  onDismiss: () => void
}

export default function OfflineTimePrompt({
  taskTitle,
  offlineMinutes,
  onSubmit,
  onDismiss
}: OfflineTimePromptProps) {
  const [breakMinutes, setBreakMinutes] = useState(0)
  const [workMinutes, setWorkMinutes] = useState(0)

  const handleSubmit = () => {
    onSubmit(breakMinutes, workMinutes)
  }

  const totalAllocated = breakMinutes + workMinutes
  const remaining = offlineMinutes - totalAllocated

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4 border border-gray-700">
        <h2 className="text-xl font-bold mb-4 text-white">App was closed while working</h2>
        
        <div className="mb-4">
          <p className="text-gray-300 mb-2">
            Task: <span className="font-semibold text-white">{taskTitle}</span>
          </p>
          <p className="text-gray-300">
            The app was closed for <span className="font-semibold text-white">{formatDuration(offlineMinutes * 60)}</span>
          </p>
        </div>

        <div className="mb-4 p-3 bg-blue-900/30 border border-blue-700/50 rounded">
          <p className="text-sm text-blue-200 mb-2">
            How much of this time was:
          </p>
        </div>

        <div className="space-y-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-300">
              Break time (minutes)
            </label>
            <input
              type="number"
              min="0"
              max={offlineMinutes}
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(Math.max(0, Math.min(offlineMinutes, parseInt(e.target.value) || 0)))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-gray-300">
              Work time (minutes)
            </label>
            <input
              type="number"
              min="0"
              max={offlineMinutes}
              value={workMinutes}
              onChange={(e) => setWorkMinutes(Math.max(0, Math.min(offlineMinutes, parseInt(e.target.value) || 0)))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {totalAllocated > offlineMinutes && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded">
            <p className="text-sm text-red-200">
              Total time ({totalAllocated} min) exceeds offline time ({offlineMinutes} min)
            </p>
          </div>
        )}

        {remaining > 0 && totalAllocated > 0 && (
          <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-700/50 rounded">
            <p className="text-sm text-yellow-200">
              {remaining} minutes unaccounted for (will be treated as pause time)
            </p>
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={totalAllocated > offlineMinutes}
            className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  )
}

// Made with Bob
