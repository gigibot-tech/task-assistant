import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTaskStore } from '../store/taskStore'
import type { Task } from '../store/taskStore'
import { ScreenshotGallery } from './ScreenshotGallery'
import { buildAutomaticScreenshotHistory } from '../lib/focusScreenshotHistory'
import {
  getMonitoringStatus,
  setMonitoringInterval,
  type MonitoringStatus
} from '../lib/electron-api'

interface ScreenCaptureProps {
  selectedTaskId?: string | null
}

const MONITOR_INTERVALS = [1, 3, 5, 10, 15, 30] as const

export function ScreenCapture({ selectedTaskId }: ScreenCaptureProps) {
  const { tasks, loadTasks } = useTaskStore()
  const [taskId, setTaskId] = useState(selectedTaskId || '')
  const [monitoring, setMonitoring] = useState<MonitoringStatus | null>(null)
  const [monitorLoading, setMonitorLoading] = useState(false)
  const [monitorMessage, setMonitorMessage] = useState<string | null>(null)

  const currentTask = tasks.find((t: Task) => t.id === taskId)
  const screenshotHistory = useMemo(
    () => buildAutomaticScreenshotHistory(currentTask),
    [currentTask]
  )

  const refreshMonitoring = useCallback(async () => {
    try {
      const status = await getMonitoringStatus()
      setMonitoring(status)
    } catch {
      setMonitoring(null)
    }
  }, [])

  useEffect(() => {
    void loadTasks()
    void refreshMonitoring()
  }, [loadTasks, refreshMonitoring])

  useEffect(() => {
    if (selectedTaskId) setTaskId(selectedTaskId)
  }, [selectedTaskId])

  useEffect(() => {
    if (!window.electron?.onNotification) return
    window.electron.onNotification((data: { type?: string }) => {
      if (
        data.type === 'focus_check_complete' ||
        data.type === 'monitoring_check_started' ||
        data.type === 'monitoring_schedule_updated'
      ) {
        void loadTasks()
        void refreshMonitoring()
      }
    })
  }, [loadTasks, refreshMonitoring])

  const isMonitoringThisTask =
    !!monitoring?.monitoring && monitoring.activeTaskId === taskId

  const handleStartMonitoring = async (minutes: number) => {
    if (!taskId || !currentTask) return
    if (currentTask.status !== 'in_progress') {
      setMonitorMessage('Set the task to In Progress before enabling auto capture.')
      return
    }
    setMonitorLoading(true)
    setMonitorMessage(null)
    try {
      await setMonitoringInterval(taskId, minutes)
      await refreshMonitoring()
      setMonitorMessage(`Auto capture every ${minutes} min — runs in background when minimized.`)
    } catch (err) {
      setMonitorMessage(err instanceof Error ? err.message : 'Failed to start auto capture')
    } finally {
      setMonitorLoading(false)
    }
  }

  const handleStopMonitoring = async () => {
    setMonitorLoading(true)
    setMonitorMessage(null)
    try {
      await setMonitoringInterval(null, null)
      await refreshMonitoring()
      setMonitorMessage('Auto capture stopped.')
    } catch (err) {
      setMonitorMessage(err instanceof Error ? err.message : 'Failed to stop auto capture')
    } finally {
      setMonitorLoading(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Screen Capture</h2>
        <p className="text-gray-400 text-sm mt-1">
          Automatic screenshots while a task is monitored. History below updates after each
          background check.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Link to task</label>
        <select
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-primary-500"
        >
          <option value="">Select a task…</option>
          {tasks.map((t: Task) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </div>

      {taskId && currentTask && (
        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-lg font-semibold">Automatic capture</h3>
            {isMonitoringThisTask && monitoring?.intervalMinutes && (
              <span className="text-xs text-green-400 font-medium">
                Active · every {monitoring.intervalMinutes} min
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">
            Captures run in the background when the app is minimized. Requires Screen Recording
            permission and Ollama for analysis.
          </p>
          {monitoring?.checkInProgress && isMonitoringThisTask && (
            <p className="text-xs text-orange-300 bg-orange-900/30 border border-orange-800/40 rounded px-3 py-2">
              Capturing screen and analyzing…
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {MONITOR_INTERVALS.map((min) => (
              <button
                key={min}
                type="button"
                onClick={() => void handleStartMonitoring(min)}
                disabled={monitorLoading || currentTask.status !== 'in_progress'}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${
                  isMonitoringThisTask && monitoring?.intervalMinutes === min
                    ? 'bg-green-700 text-white ring-2 ring-green-500'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                }`}
              >
                {min}m
              </button>
            ))}
            <button
              type="button"
              onClick={() => void handleStopMonitoring()}
              disabled={monitorLoading || !monitoring?.monitoring}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-900/80 hover:bg-red-800 text-red-200 disabled:opacity-40"
            >
              Off
            </button>
          </div>
          {currentTask.status !== 'in_progress' && (
            <p className="text-xs text-amber-400/90">
              Mark this task In Progress to enable automatic capture.
            </p>
          )}
          {monitorMessage && <p className="text-xs text-gray-400">{monitorMessage}</p>}
        </div>
      )}

      {taskId ? (
        <ScreenshotGallery screenshots={screenshotHistory} maxDisplay={12} />
      ) : (
        <p className="text-xs text-gray-500">
          Select a task to configure automatic capture and view screenshot history.
        </p>
      )}
    </div>
  )
}
