import { useState, useEffect } from 'react'
import { useTaskStore } from '../store/taskStore'

interface Task {
  id: string
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  tags?: string[]
  workplace_folder?: string | null
}

interface TaskFormProps {
  onClose: () => void
  editTask?: Task
}

export default function TaskForm({ onClose, editTask }: TaskFormProps) {
  const [title, setTitle] = useState(editTask?.title || '')
  const [description, setDescription] = useState(editTask?.description || '')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>(
    editTask?.priority || 'medium'
  )
  const [tags, setTags] = useState(editTask?.tags?.join(', ') || '')
  const [workplaceFolder, setWorkplaceFolder] = useState(editTask?.workplace_folder ?? '')
  const [titleSuggestions, setTitleSuggestions] = useState<string[]>([])
  const [descSuggestions, setDescSuggestions] = useState<string[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const { createTask, updateTask } = useTaskStore()

  useEffect(() => {
    if (title.length > 3) {
      const timer = setTimeout(async () => {
        setLoadingSuggestions(true)
        try {
          const result = await window.electron.suggestCommunication(
            `Task title: "${title}". Suggest improvements for clarity.`,
            'casual'
          )
          setTitleSuggestions(result.suggestions?.slice(0, 3) || [])
        } catch {
          setTitleSuggestions([])
        } finally {
          setLoadingSuggestions(false)
        }
      }, 1000)
      return () => clearTimeout(timer)
    } else {
      setTitleSuggestions([])
    }
  }, [title])

  useEffect(() => {
    if (description.length > 10) {
      const timer = setTimeout(async () => {
        setLoadingSuggestions(true)
        try {
          const result = await window.electron.suggestCommunication(
            `Task description: "${description}". Suggest improvements for clarity.`,
            'technical'
          )
          setDescSuggestions(result.suggestions?.slice(0, 3) || [])
        } catch {
          setDescSuggestions([])
        } finally {
          setLoadingSuggestions(false)
        }
      }, 1500)
      return () => clearTimeout(timer)
    } else {
      setDescSuggestions([])
    }
  }, [description])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const taskData = {
      title,
      description,
      priority,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      status: editTask?.status || ('pending' as const),
      workplace_folder: workplaceFolder.trim() || null
    }

    if (editTask) {
      await updateTask(editTask.id, taskData)
    } else {
      await createTask(taskData)
    }

    onClose()
  }

  const applySuggestion = (field: 'title' | 'description', suggestion: string) => {
    if (field === 'title') setTitle(suggestion)
    else setDescription(suggestion)
  }

  return (
    <form onSubmit={handleSubmit} className="p-6">
      <h2 className="text-2xl font-bold mb-6">
        {editTask ? 'Edit Task' : 'Create New Task'}
      </h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Title *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-primary-500"
            placeholder="Enter task title"
            required
          />
          {titleSuggestions.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-gray-500">AI suggestions:</p>
              {titleSuggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => applySuggestion('title', s)}
                  className="block w-full text-left text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-primary-500 h-32"
            placeholder="Enter task description"
          />
          {descSuggestions.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-gray-500">AI suggestions:</p>
              {descSuggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => applySuggestion('description', s)}
                  className="block w-full text-left text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as typeof priority)}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-primary-500"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Tags (comma-separated)</label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-primary-500"
            placeholder="work, urgent, frontend"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Workplace folder</label>
          <p className="text-xs text-gray-500 mb-2">
            Project directory for AI file context when you go off-task.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={workplaceFolder}
              onChange={(e) => setWorkplaceFolder(e.target.value)}
              className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-primary-500 font-mono text-sm"
              placeholder="/path/to/project"
            />
            <button
              type="button"
              onClick={async () => {
                if (!window.electron?.pickWorkplaceFolder) return
                const { path: picked } = await window.electron.pickWorkplaceFolder()
                if (picked) setWorkplaceFolder(picked)
              }}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
            >
              Browse
            </button>
          </div>
        </div>

        {loadingSuggestions && (
          <p className="text-xs text-gray-500">Getting AI suggestions...</p>
        )}
      </div>

      <div className="flex gap-3 mt-6">
        <button
          type="submit"
          className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg font-medium transition-colors"
        >
          {editTask ? 'Update Task' : 'Create Task'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
