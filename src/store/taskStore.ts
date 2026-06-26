import { create } from 'zustand'
import type { FileReviewStatus, ReviewSchedule, ReviewStatistics } from '../types/review'
import { calculateReviewStats } from '../types/review'
import type { TaskWorkspace } from '../lib/taskWorkspaces'

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
  /** @deprecated Use task_breakdown instead. Kept for backward compatibility during migration. */
  progress_checklist?: Array<{ id: string; label: string; done: boolean }>
  progress_milestone_updates?: Array<{ prime: number; note: string; acknowledged_at: string }>
  /** @deprecated Use task_breakdown instead. Kept for backward compatibility during migration. */
  subtasks?: import('../lib/subtaskTypes').TaskSubtask[]
  active_subtask_id?: string | null
  /** New unified task breakdown system - replaces progress_checklist and subtasks */
  task_breakdown?: import('../lib/taskBreakdownTypes').TaskBreakdownItem[]
  /** @deprecated Use workspaces + active_workspace_id. Kept synced from active workspace. */
  workplace_folder?: string | null
  /** Multiple project folders per task; one active at a time */
  workspaces?: TaskWorkspace[]
  active_workspace_id?: string | null
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
  /** YYYY-MM-DD per prompt key — aspect/prime/probe auto-prompt snooze for the day */
  drive_prompt_dates?: Record<string, string>
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
  /** File review tracking - maps file path to review status */
  review_statuses?: Record<string, FileReviewStatus>
  /** AI-generated review schedule */
  review_schedule?: ReviewSchedule
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

  // Review tracking actions
  markFileReviewed: (taskId: string, filePath: string, notes?: string) => Promise<void>
  addReviewNote: (taskId: string, filePath: string, note: string) => Promise<void>
  setReviewSchedule: (taskId: string, schedule: ReviewSchedule) => Promise<void>
  getReviewStats: (taskId: string, totalIndexed?: number) => ReviewStatistics | null
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
  },

  // Review tracking actions
  markFileReviewed: async (taskId: string, filePath: string, notes?: string) => {
    const { tasks, activeTask } = get()
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    const reviewStatuses = task.review_statuses || {}
    const existingStatus = reviewStatuses[filePath] || {
      filePath,
      reviewed: false
    }

    const updatedStatus: FileReviewStatus = {
      ...existingStatus,
      reviewed: true,
      reviewedAt: new Date().toISOString(),
      notes: notes ? [...(existingStatus.notes || []), notes] : existingStatus.notes
    }

    const updates = {
      review_statuses: {
        ...reviewStatuses,
        [filePath]: updatedStatus
      }
    }

    await get().updateTask(taskId, updates)
  },

  addReviewNote: async (taskId: string, filePath: string, note: string) => {
    const { tasks } = get()
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    const reviewStatuses = task.review_statuses || {}
    const existingStatus = reviewStatuses[filePath] || {
      filePath,
      reviewed: false
    }

    const updatedStatus: FileReviewStatus = {
      ...existingStatus,
      notes: [...(existingStatus.notes || []), note]
    }

    const updates = {
      review_statuses: {
        ...reviewStatuses,
        [filePath]: updatedStatus
      }
    }

    await get().updateTask(taskId, updates)
  },

  setReviewSchedule: async (taskId: string, schedule: ReviewSchedule) => {
    await get().updateTask(taskId, { review_schedule: schedule })
  },

  getReviewStats: (taskId: string, totalIndexed?: number): ReviewStatistics | null => {
    const { tasks } = get()
    const task = tasks.find(t => t.id === taskId)
    if (!task || !task.review_statuses) return null

    const statusMap = new Map<string, FileReviewStatus>(
      Object.entries(task.review_statuses)
    )

    return calculateReviewStats(statusMap, task.review_schedule, totalIndexed)
  }
}))
