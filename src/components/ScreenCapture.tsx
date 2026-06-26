import { useState, useEffect } from 'react'
import { useTaskStore } from '../store/taskStore'
import type { Task } from '../store/taskStore'
import { ScreenshotGallery } from './ScreenshotGallery'

interface ScreenCaptureProps {
  selectedTaskId?: string | null
}

export function ScreenCapture({ selectedTaskId }: ScreenCaptureProps) {
  const [capturing, setCapturing] = useState(false)
  const [lastCapture, setLastCapture] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<string | null>(null)
  const { tasks, refreshActiveTask } = useTaskStore()
  const [taskId, setTaskId] = useState(selectedTaskId || '')
  
  // Get current task for screenshot history
  const currentTask = tasks.find((t: Task) => t.id === taskId)

  useEffect(() => {
    if (selectedTaskId) setTaskId(selectedTaskId)
  }, [selectedTaskId])

  const handleCapture = async () => {
    setCapturing(true)
    setError(null)
    setAnalysis(null)

    try {
      const result = await window.electron.captureScreen()
      setLastCapture(result.imagePath)

      if (taskId) {
        try {
          const analysisResult = await window.electron.analyzeScreenshotForTask(
            taskId,
            result.imagePath
          )
          
          // Validate analysis result has required data
          if (analysisResult &&
              analysisResult.aiPrediction &&
              analysisResult.activityLabel &&
              analysisResult.recommendation) {
            setAnalysis(
              `${analysisResult.aiPrediction} (${analysisResult.activityLabel}) — ${analysisResult.recommendation}`
            )
          } else if (analysisResult && analysisResult.aiPrediction) {
            // Partial data available
            setAnalysis(
              `${analysisResult.aiPrediction}${analysisResult.activityLabel ? ` (${analysisResult.activityLabel})` : ''}${analysisResult.recommendation ? ` — ${analysisResult.recommendation}` : ''}`
            )
          } else {
            // No valid analysis data
            setAnalysis('Analysis completed but no insights were generated. The AI may need more context or the screen content was unclear.')
          }
          await refreshActiveTask()
        } catch (analysisError) {
          // Analysis failed but screenshot was captured
          console.error('Analysis error:', analysisError)
          setAnalysis('Screenshot captured successfully, but analysis failed. Please try again or check if the AI service is running.')
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to capture screen')
    } finally {
      setCapturing(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-2xl font-bold">Focus Monitor</h2>
      <p className="text-gray-400 text-sm">
        Capture your screen and analyze activity against your active task using gemma4:latest.
      </p>

      <div>
        <label className="block text-sm font-medium mb-2">Link to Task</label>
        <select
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-primary-500"
        >
          <option value="">No task (capture only)</option>
          {tasks.map((t: Task) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Screen Capture</h3>
          <button
            onClick={handleCapture}
            disabled={capturing}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {capturing ? 'Capturing...' : 'Capture Screen'}
          </button>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-500 rounded-lg p-3">
            <p className="text-red-200 text-sm">{error}</p>
          </div>
        )}

        {lastCapture && (
          <div className="bg-gray-700 rounded-lg p-3">
            <p className="text-gray-300 text-sm">
              <span className="font-semibold">Last capture:</span> {lastCapture}
            </p>
          </div>
        )}

        {analysis && (
          <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-3">
            <p className="text-blue-200 text-sm">{analysis}</p>
          </div>
        )}

        <div className="bg-gray-700 rounded-lg p-3">
          <h4 className="text-sm font-semibold mb-2">How it works</h4>
          <ul className="text-gray-300 text-sm space-y-1">
            <li>Captures your current screen via Electron desktopCapturer</li>
            <li>AI analyzes what you are doing</li>
            <li>Compares with your linked task</li>
            <li>Logs screenshot history for analytics</li>
          </ul>
        </div>
      </div>

      {/* Screenshot Gallery */}
      {taskId && currentTask?.screenshots && currentTask.screenshots.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-4 mt-4">
          <ScreenshotGallery screenshots={currentTask.screenshots} maxDisplay={10} />
        </div>
      )}
    </div>
  )
}
