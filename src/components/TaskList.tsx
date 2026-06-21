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

interface TaskListProps {
  tasks: Task[]
  onTaskClick: (task: Task) => void
}

export default function TaskList({ tasks, onTaskClick }: TaskListProps) {
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
      {tasks.map((task) => (
        <div
          key={task.id}
          onClick={() => onTaskClick(task)}
          className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-primary-500 cursor-pointer transition-colors"
        >
          <div className="flex items-start justify-between mb-2">
            <h3 className="font-medium text-lg">{task.title}</h3>
            <span className={`px-2 py-1 rounded text-xs font-medium ${
              task.priority === 'urgent' ? 'bg-red-900 text-red-200' :
              task.priority === 'high' ? 'bg-orange-900 text-orange-200' :
              task.priority === 'medium' ? 'bg-yellow-900 text-yellow-200' :
              'bg-gray-700 text-gray-300'
            }`}>
              {task.priority}
            </span>
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
                task.status === 'in_progress' ? 'bg-blue-900 text-blue-200' :
                'bg-gray-700 text-gray-300'
              }`}>
                {task.status.replace('_', ' ')}
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
      ))}
    </div>
  )
}

// Made with Bob
