import { useState, useEffect, useMemo } from 'react'
import { useTaskStore } from '../store/taskStore'
import type { Task } from '../store/taskStore'
import { ScreenshotGallery } from './ScreenshotGallery'
import { buildAutomaticScreenshotHistory } from '../lib/focusScreenshotHistory'

interface ScreenCaptureProps {
  selectedTaskId?: string | null
}

export function ScreenCapture({ selectedTaskId }: ScreenCaptureProps) {
  const { tasks, loadTasks } = useTaskStore()
  const [taskId, setTaskId] = useState(selectedTaskId || '')

  const currentTask = tasks.find((t: Task) => t.id === taskId)
  const screenshotHistory = useMemo(
    () => buildAutomaticScreenshotHistory(currentTask),
    [currentTask]
  )

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  useEffect(() => {
    if (selectedTaskId) setTaskId(selectedTaskId)
  }, [selectedTaskId])

  useEffect(() => {
    if (!window.electron?.onNotification) return
    return window.electron.onNotification((data: { type?: string }) => {
      if (
        data.type === 'focus_check_complete' ||
        data.type === 'monitoring_check_started'
      ) {
        void loadTasks()
      }
    })
  }, [loadTasks])

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Screen Capture</h2>
        <p className="text-gray-400 text-sm mt-1">
          View automatic screenshot history for a task. Enable intervals from the task details
          panel when a task is In Progress.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Task</label>
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

      {taskId ? (
        <ScreenshotGallery screenshots={screenshotHistory} maxDisplay={12} />
      ) : (
        <p className="text-xs text-gray-500">
          Select a task to view its capture history.
        </p>
      )}
    </div>
  )
}
