import type { Task } from '../store/taskStore'
import TaskSmePanel from './TaskSmePanel'

interface SMEValidationProps {
  task?: Task | null
  onUpdate?: (updates: Partial<Task>) => Promise<void>
}

export default function SMEValidation({ task, onUpdate }: SMEValidationProps) {
  if (!task || !onUpdate) {
    return (
      <div className="max-w-xl mx-auto text-center py-16 px-6">
        <h2 className="text-xl font-bold mb-2">SME Opinion Validation</h2>
        <p className="text-gray-400 text-sm">
          Select a task from the Tasks view to validate an approach in context. Expert opinions are
          stored on each task&apos;s timeline.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <TaskSmePanel task={task} onUpdate={onUpdate} fullWidth />
    </div>
  )
}
