import { formatDistanceToNow } from 'date-fns'

interface Task {
  id: string
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  tags?: string[]
  created_at: string
}

interface TaskTimeStatus {
  taskId: string
  isRunning: boolean
  isPaused: boolean
}

interface TaskListProps {
  tasks: Task[]
  onTaskClick: (task: Task) => void
  taskTimeStatus?: TaskTimeStatus | null
  onPlay?: (task: Task) => void
  onPause?: (task: Task) => void
  onResume?: (task: Task) => void
}

function PlayIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  )
}

export default function TaskList({
  tasks,
  onTaskClick,
  taskTimeStatus,
  onPlay,
  onPause,
  onResume,
}: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="text-center">
          <div className="text-6xl mb-4">📋</div>
          <h3 className="text-xl font-medium mb-2">No tasks yet</h3>
          <p className="text-sm">Create your first task to get started!</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => {
        const isThisTask = taskTimeStatus?.taskId === task.id
        const isRunning = isThisTask && taskTimeStatus?.isRunning
        const isPaused = isThisTask && taskTimeStatus?.isPaused
        const isCompleted = task.status === 'completed'

        return (
          <div
            key={task.id}
            onClick={() => onTaskClick(task)}
            className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-primary-500 cursor-pointer transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-medium text-lg flex-1 min-w-0 pr-2">{task.title}</h3>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Play / Pause / Resume button */}
                {!isCompleted && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (isRunning) onPause?.(task)
                      else if (isPaused) onResume?.(task)
                      else onPlay?.(task)
                    }}
                    title={isRunning ? 'Pause' : isPaused ? 'Resume' : 'Start'}
                    className={`p-1 rounded transition-colors ${
                      isRunning
                        ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-900/30'
                        : isPaused
                        ? 'text-blue-400 hover:text-blue-300 hover:bg-blue-900/30'
                        : 'text-gray-400 hover:text-green-400 hover:bg-green-900/20'
                    }`}
                  >
                    {isRunning ? <PauseIcon /> : <PlayIcon />}
                  </button>
                )}

                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  task.priority === 'urgent' ? 'bg-red-900 text-red-200' :
                  task.priority === 'high' ? 'bg-orange-900 text-orange-200' :
                  task.priority === 'medium' ? 'bg-yellow-900 text-yellow-200' :
                  'bg-gray-700 text-gray-300'
                }`}>
                  {task.priority}
                </span>
              </div>
            </div>

            {task.description && (
              <p className="text-gray-400 text-sm mb-3 line-clamp-2">
                {task.description}
              </p>
            )}

            <div className="flex items-center justify-between text-xs text-gray-500">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded ${
                  task.status === 'completed' ? 'bg-green-900 text-green-200' :
                  isRunning ? 'bg-green-900/60 text-green-300' :
                  isPaused ? 'bg-amber-900/60 text-amber-300' :
                  task.status === 'in_progress' ? 'bg-blue-900 text-blue-200' :
                  'bg-gray-700 text-gray-300'
                }`}>
                  {isRunning ? '▶ running' : isPaused ? '⏸ paused' : task.status.replace('_', ' ')}
                </span>
                {task.tags && task.tags.length > 0 && (
                  <div className="flex gap-1">
                    {task.tags.slice(0, 3).map((tag, i) => (
                      <span key={i} className="px-2 py-1 bg-gray-700 rounded">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span>
                {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Made with Bob
