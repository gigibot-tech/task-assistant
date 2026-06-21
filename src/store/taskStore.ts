import { create } from 'zustand'

export interface WorkSession {
  id: string
  started_at: string
  ended_at?: string | null
  pause_reason?: string
}

export interface Task {
  id: string
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  tags?: string[]
  estimated_minutes?: number
  actual_minutes?: number
  recorded_seconds?: number
  work_sessions?: WorkSession[]
  time_last_checkpoint_at?: string
  user_estimate_minutes?: number
  ai_estimate_minutes?: number
  progress_percent?: number
  progress_updated_at?: string
  progress_checklist?: Array<{ id: string; label: string; done: boolean }>
  progress_milestone_updates?: Array<{ prime: number; note: string; acknowledged_at: string }>
  workplace_folder?: string | null
  workplace_index?: {
    indexed_at: string
    file_count: number
    tree_text: string
    relative_paths?: string[]
  }
  last_on_task_capture?: {
    imagePath: string
    capturedAt: string
    similarity: number
    activity: string
  }
  workplace_guidance?: {
    generated_at: string
    summary: string
    suggested_files: Array<{ path: string; reason: string }>
    suggested_actions: string[]
    tools_hint?: string
  }
  drive_checkins?: Array<{
    id: string
    prime_day: number
    task_day: number
    recorded_at: string
    notes: {
      curiosity: string
      ownership: string
      external_pressure: string
      freedom: string
    }
  }>
  drive_acknowledged_primes?: number[]
  drive_window_days?: 7 | 14 | 30 | 90
  drive_work_started_at?: string
  subtasks?: import('../lib/subtaskTypes').TaskSubtask[]
  active_subtask_id?: string | null
  stuck_events?: import('../lib/subtaskTypes').StuckEvent[]
  wasted_time_seconds?: number
  probe_must_code_by?: string
  work_phase?: import('../features/softwarePhases/types').SoftwarePhase
  work_phase_set_at?: string
  work_phase_source?: import('../features/softwarePhases/types').PhaseSource
  phase_balance?: import('../features/softwarePhases/types').PhaseBalance
  focus_capture_history?: Array<{ imagePath: string; capturedAt: string; dHash: string }>
  start_time?: string
  end_time?: string
  due_date?: string
  parent_task_id?: string
  created_at: string
  updated_at: string
  screenshots?: Array<{
    timestamp: string
    imagePath: string
    aiPrediction: string
    activityLabel: string
    recommendation: string
    deviationScore: number
  }>
}

interface TaskStore {
  tasks: Task[]
  activeTask: Task | null
  loading: boolean
  error: string | null

  loadTasks: () => Promise<void>
  createTask: (task: Partial<Task>) => Promise<void>
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  setActiveTask: (task: Task | null) => void
  refreshActiveTask: () => Promise<void>
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  activeTask: null,
  loading: false,
  error: null,

  loadTasks: async () => {
    set({ loading: true, error: null })
    try {
      const tasks = await window.electron.getTasks()
      set({ tasks, loading: false })
    } catch (error) {
      set({ error: 'Failed to load tasks', loading: false })
      console.error('Load tasks error:', error)
    }
  },

  createTask: async (task) => {
    set({ loading: true, error: null })
    try {
      const newTask = await window.electron.createTask(task)
      set((state) => ({
        tasks: [newTask, ...state.tasks],
        loading: false
      }))
    } catch (error) {
      set({ error: 'Failed to create task', loading: false })
      console.error('Create task error:', error)
    }
  },

  updateTask: async (id, updates) => {
    set({ loading: true, error: null })
    try {
      const updated = await window.electron.updateTask(id, updates)
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updated } : t)),
        activeTask:
          state.activeTask?.id === id
            ? { ...state.activeTask, ...updated }
            : state.activeTask,
        loading: false
      }))
    } catch (error) {
      set({ error: 'Failed to update task', loading: false })
      console.error('Update task error:', error)
    }
  },

  deleteTask: async (id) => {
    set({ loading: true, error: null })
    try {
      await window.electron.deleteTask(id)
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== id),
        activeTask: state.activeTask?.id === id ? null : state.activeTask,
        loading: false
      }))
    } catch (error) {
      set({ error: 'Failed to delete task', loading: false })
      console.error('Delete task error:', error)
    }
  },

  setActiveTask: (task) => {
    set({ activeTask: task })
    window.electron.setActiveTask(task?.id ?? null)
  },

  refreshActiveTask: async () => {
    const { activeTask } = get()
    if (!activeTask) return
    const tasks = await window.electron.getTasks()
    const updated = tasks.find((t: Task) => t.id === activeTask.id)
    if (updated) {
      set({ activeTask: updated, tasks })
    }
  }
}))
