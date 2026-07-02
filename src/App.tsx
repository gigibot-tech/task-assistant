import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import TaskList from './components/TaskList'
import TaskForm from './components/TaskForm'
import DeviationAlert from './components/DeviationAlert'
import SettingsPanel from './components/SettingsPanel'
import TaskProgressPanel from './components/TaskProgressPanel'
import TaskBreakdownPanel from './components/TaskBreakdownPanel'
import SubtaskProbeModal from './components/SubtaskProbeModal'
import SMEValidation from './components/SMEValidation'
import { ScreenCapture } from './components/ScreenCapture'
import { TaskAnalytics } from './components/TaskAnalytics'
import OfflineTimePrompt from './components/OfflineTimePrompt'
import MonitorPicker from './components/MonitorPicker'
import WorktreeReviewTab from './components/WorktreeReviewTab'
import { useTaskStore } from './store/taskStore'
import type { Task } from './store/taskStore'
import {
  checkDeviationFromScreen,
  completeTaskWork,
  getScreenPermissionStatus,
  getMonitoringStatus,
  getPreloadDiagnostics,
  getTaskTimeStatus,
  openScreenSettings,
  pauseTaskWork,
  REQUIRED_PRELOAD_VERSION,
  requestScreenPermission,
  resumeTaskWork,
  setMonitoringInterval,
  startTaskWork,
  verifyScreenCapture,
  type TaskTimeStatus
} from './lib/electron-api'
import { formatDuration, formatDurationClock } from './lib/timeFormat'
import { effectiveEstimateMinutes, estimateTaskTime } from './lib/taskEstimate'
import {
  markPromptedToday,
  probePromptKey,
  wasPromptedToday
} from './lib/dailyPrompts'
import {
  EMPTY_FOCUS_MATCH,
  focusCheckFromNotification,
  focusCheckFromSettings
} from './lib/focusCheckDisplay'
import type { StuckTrigger, SoftwarePhase } from './lib/subtaskTypes'
import { useFeatureFlags } from './features/useFeatureFlags'
import { renderTaskDetailSlots } from './features/manifests'
import type { OpenProbeOptions } from './features/manifests'
import SemanticSorterPanel from './components/SemanticSorterPanel'
import { semanticSorterActive, reviewActive, smeValidatorActive, focusMonitorActive } from './features/registry'
import { allocateOfflineTime } from './lib/electron-api'
import {
  buildMigrationPatch,
  createTechnicalBreakdownItem,
  resolveTaskBreakdown
} from './lib/breakdownHelpers'
import { needsMigration } from './lib/taskBreakdownMigration'
import { calculateProgress } from './lib/taskBreakdownTypes'
import { clampProgressPercent } from './lib/progressMilestones'

type ActiveView = 'tasks' | 'analytics' | 'settings' | 'sme' | 'focus' | 'desktop_sorter' | 'review'
type TaskFilter = 'all' | 'in_progress' | 'completed'

type OllamaStatus = 'checking' | 'online' | 'offline' | 'model_missing'

function taskHasOpenSession(task: Task): boolean {
  return (task.work_sessions ?? []).some((s) => !s.ended_at)
}

const MONITOR_INTERVALS = [1, 3, 5, 10, 15, 30] as const

function App() {
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | undefined>()
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [activeView, setActiveView] = useState<ActiveView>('tasks')
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>('checking')
  const [ollamaModel, setOllamaModel] = useState('gemma4:latest')
  const [ollamaError, setOllamaError] = useState<string | null>(null)
  const [ollamaPausedUntil, setOllamaPausedUntil] = useState<number | null>(null)
  const [ollamaRuntimeError, setOllamaRuntimeError] = useState<{
    model: string
    command: string
    timestamp: number
  } | null>(null)
  const [monitoringInterval, setMonitoringIntervalState] = useState<number | null>(null)
  const [nextCheckAt, setNextCheckAt] = useState<number | null>(null)
  const [checkInProgress, setCheckInProgress] = useState(false)
  const [countdownLabel, setCountdownLabel] = useState('')
  const [taskTimeStatus, setTaskTimeStatus] = useState<TaskTimeStatus | null>(null)
  const [liveTimeSeconds, setLiveTimeSeconds] = useState(0)
  const [liveBreakSeconds, setLiveBreakSeconds] = useState(0)
  const [livePauseSeconds, setLivePauseSeconds] = useState(0)
  const [detectedActivity, setDetectedActivity] = useState('')
  const [lastCheckAt, setLastCheckAt] = useState<string | null>(null)
  const [focusMatch, setFocusMatch] = useState(EMPTY_FOCUS_MATCH)
  const [screenPermission, setScreenPermission] = useState<string>('unknown')
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null)
  const [grantingPermission, setGrantingPermission] = useState(false)
  const [preloadReady, setPreloadReady] = useState(false)
  const [preloadHint, setPreloadHint] = useState<string | null>(null)
  const [mainProcessStale, setMainProcessStale] = useState(false)
  const [aiLoading, setAiLoading] = useState<string | null>(null)
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [pomodoroPhase, setPomodoroPhase] = useState<'idle' | 'work' | 'break' | 'long_break'>('idle')
  const [pomodoroEndsAt, setPomodoroEndsAt] = useState<number | null>(null)
  const [pomodoroEnabled, setPomodoroEnabled] = useState(true)
  const [staleNotice, setStaleNotice] = useState<string | null>(null)
  const [staleTaskId, setStaleTaskId] = useState<string | null>(null)
  const [stuckProbe, setStuckProbe] = useState<{
    taskId: string
    trigger: StuckTrigger
    workPhase?: SoftwarePhase
    taskDay?: number
    primeDay?: number | null
  } | null>(null)
  const [phaseNotice, setPhaseNotice] = useState<string | null>(null)
  const [offlineTimePrompt, setOfflineTimePrompt] = useState<{
    taskId: string
    taskTitle: string
    offlineMinutes: number
    sessionStartedAt: string
  } | null>(null)

  const { flags: featureFlags, refresh: refreshFeatureFlags } = useFeatureFlags()
  const [, setPomodoroTick] = useState(0)

  useEffect(() => {
    if (activeView === 'review' && !reviewActive(featureFlags)) setActiveView('tasks')
    if (activeView === 'desktop_sorter' && !semanticSorterActive(featureFlags)) setActiveView('tasks')
    if (activeView === 'sme' && !smeValidatorActive(featureFlags)) setActiveView('tasks')
    if (activeView === 'focus' && !focusMonitorActive(featureFlags)) setActiveView('tasks')
  }, [activeView, featureFlags])

  const refreshPomodoro = useCallback(async () => {
    if (!window.electron.getPomodoroStatus) return
    try {
      const status = await window.electron.getPomodoroStatus()
      setPomodoroPhase(status.state.phase)
      setPomodoroEndsAt(status.state.phaseEndsAt)
      setPomodoroEnabled(status.settings.enabled)
    } catch {
      /* preload/main may be stale until restart */
    }
  }, [])

  const { tasks, loadTasks, activeTask, updateTask, deleteTask, setActiveTask } = useTaskStore()

  const pomodoroCountdown = (() => {
    if (!pomodoroEndsAt || pomodoroPhase === 'idle') return ''
    const sec = Math.max(0, Math.ceil((pomodoroEndsAt - Date.now()) / 1000))
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  })()

  const effectiveEstimate = (task: Task) => effectiveEstimateMinutes(task)

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  useEffect(() => {
    if (tasks.length === 0 || activeTask) return
    void getMonitoringStatus().then((status) => {
      if (!status.activeTaskId) return
      const task = tasks.find((t) => t.id === status.activeTaskId)
      if (task) setActiveTask(task)
    })
  }, [tasks, activeTask, setActiveTask])

  const checkOllama = useCallback(async () => {
    setOllamaStatus('checking')
    try {
      const health = await window.electron.checkOllamaHealth()
      setOllamaModel(health.model)
      if (!health.online) {
        setOllamaStatus('offline')
      } else if (!health.modelAvailable) {
        setOllamaStatus('model_missing')
      } else {
        setOllamaStatus('online')
        setOllamaError(null)
        setOllamaPausedUntil(null)
      }
    } catch {
      setOllamaStatus('offline')
    }
  }, [])

  useEffect(() => {
    checkOllama()
    const interval = setInterval(checkOllama, 30000)
    return () => clearInterval(interval)
  }, [checkOllama])

  // Listen for Ollama runtime errors from main process
  useEffect(() => {
    if (!window.electron.onNotification) return

    return window.electron.onNotification((data: { type?: string; model?: string; command?: string; timestamp?: number }) => {
      if (data.type === 'ollama-error') {
        setOllamaRuntimeError({
          model: data.model ?? '',
          command: data.command ?? '',
          timestamp: data.timestamp ?? Date.now()
        })
        setOllamaStatus('offline')
      }
    })
  }, [])

  const refreshTaskTimeStatus = useCallback(async (taskId?: string | null) => {
    const id = taskId ?? selectedTask?.id ?? activeTask?.id
    if (!id) {
      setTaskTimeStatus(null)
      setLiveTimeSeconds(0)
      setLiveBreakSeconds(0)
      return
    }
    try {
      const status = await getTaskTimeStatus(id)
      if (status) {
        setTaskTimeStatus(status)
        setLiveTimeSeconds(status.liveSeconds)
        setLiveBreakSeconds(status.breakSeconds)
        setLivePauseSeconds(status.pauseSeconds)
      }
    } catch {
      /* stale main */
    }
  }, [selectedTask?.id, activeTask?.id])

  const syncTaskFromWork = useCallback(
    async (task: Task) => {
      setSelectedTask((prev) => (prev?.id === task.id ? task : prev))
      if (activeTask?.id === task.id) {
        setActiveTask(task)
      }
      await loadTasks()
      await refreshTaskTimeStatus(task.id)
    },
    [activeTask?.id, loadTasks, refreshTaskTimeStatus, setActiveTask]
  )

  const openStuckProbe = useCallback(
    (taskId: string, trigger: StuckTrigger, options?: OpenProbeOptions) => {
      setStuckProbe({
        taskId,
        trigger,
        workPhase: options?.workPhase,
        taskDay: options?.taskDay,
        primeDay: options?.primeDay
      })
    },
    []
  )

  const openProbeForTask = useCallback(
    (trigger: StuckTrigger, options?: OpenProbeOptions) => {
      if (!selectedTask) return
      openStuckProbe(selectedTask.id, trigger, options)
    },
    [selectedTask, openStuckProbe]
  )

  const applyFocusDisplay = useCallback(
    (display: ReturnType<typeof focusCheckFromSettings>) => {
      if (!display) {
        setDetectedActivity('')
        setLastCheckAt(null)
        setFocusMatch(EMPTY_FOCUS_MATCH)
        return
      }
      setDetectedActivity(display.activity)
      setLastCheckAt(display.checkedAt)
      setFocusMatch(display.match)
    },
    []
  )

  const applyFocusFromSettings = useCallback(
    (settings: Record<string, unknown>, forTaskId?: string | null) => {
      applyFocusDisplay(focusCheckFromSettings(settings, forTaskId))
    },
    [applyFocusDisplay]
  )

  const syncFocusForSelectedTask = useCallback(async () => {
    if (!selectedTask) {
      applyFocusDisplay(null)
      return
    }
    try {
      const settings = await window.electron.getSettings()
      applyFocusFromSettings(settings, selectedTask.id)
    } catch {
      applyFocusDisplay(null)
    }
  }, [selectedTask, applyFocusFromSettings, applyFocusDisplay])

  const migrationPersistedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!selectedTask || migrationPersistedRef.current.has(selectedTask.id)) return
    if (!needsMigration(selectedTask)) return
    const patch = buildMigrationPatch(selectedTask)
    if (!patch) return
    migrationPersistedRef.current.add(selectedTask.id)
    void window.electron.updateTask(selectedTask.id, patch).then((updated) => {
      setSelectedTask(updated)
      void loadTasks()
    })
  }, [selectedTask, loadTasks])

  const refreshMonitoringState = useCallback(async () => {
    try {
      const settings = await window.electron.getSettings()
      const status = await getMonitoringStatus()

      setMainProcessStale(!!status.staleMainProcess)

      if (status.monitoring && status.intervalMinutes) {
        setMonitoringIntervalState(status.intervalMinutes)
      } else if (settings.autoScreenshotMonitoring && settings.pollIntervalMinutes) {
        setMonitoringIntervalState(settings.pollIntervalMinutes)
      } else {
        setMonitoringIntervalState(null)
      }

      setNextCheckAt(status.nextCheckAt)
      setCheckInProgress(status.checkInProgress)
      if (selectedTask?.id) {
        applyFocusFromSettings(settings, selectedTask.id)
      }
    } catch (err) {
      console.error('Failed to refresh monitoring state:', err)
    }
  }, [applyFocusFromSettings, selectedTask?.id])

  const checkScreenPermission = useCallback(async () => {
    const diagnostics = getPreloadDiagnostics()
    setPreloadReady(diagnostics.ready)
    if (!diagnostics.ready) {
      setPreloadHint(
        diagnostics.missing.length > 0
          ? `Missing APIs: ${diagnostics.missing.join(', ')}`
          : diagnostics.version > 0 && diagnostics.version < REQUIRED_PRELOAD_VERSION
            ? `Preload v${diagnostics.version} is outdated (need v${REQUIRED_PRELOAD_VERSION}) — quit and restart`
            : 'Preload not loaded'
      )
    } else {
      setPreloadHint(null)
    }
    const status = await getScreenPermissionStatus()
    setScreenPermission(status)
    if (status === 'granted') {
      setPermissionMessage(null)
    }
    return status
  }, [])

  useEffect(() => {
    refreshMonitoringState()
    checkScreenPermission()
    refreshTaskTimeStatus()
    refreshPomodoro()
  }, [refreshMonitoringState, checkScreenPermission, refreshTaskTimeStatus, refreshPomodoro])

  useEffect(() => {
    if (pomodoroPhase === 'idle' || !pomodoroEndsAt) return
    const id = setInterval(() => {
      setPomodoroTick((t) => t + 1)
      if (Date.now() >= pomodoroEndsAt) {
        refreshPomodoro()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [pomodoroPhase, pomodoroEndsAt, refreshPomodoro])

  useEffect(() => {
    if (selectedTask) {
      refreshMonitoringState()
      refreshTaskTimeStatus(selectedTask.id)
      void syncFocusForSelectedTask()
    } else {
      applyFocusDisplay(null)
    }
  }, [
    selectedTask,
    refreshMonitoringState,
    refreshTaskTimeStatus,
    syncFocusForSelectedTask,
    applyFocusDisplay
  ])

  useEffect(() => {
    if (!taskTimeStatus?.isRunning) return
    const tick = setInterval(() => {
      setLiveTimeSeconds((s) => s + 1)
    }, 1000)
    return () => clearInterval(tick)
  }, [taskTimeStatus?.isRunning, taskTimeStatus?.taskId])

  useEffect(() => {
    if (!taskTimeStatus?.isPaused) return
    const tick = setInterval(() => {
      setLiveBreakSeconds((s) => s + 1)
    }, 1000)
    return () => clearInterval(tick)
  }, [taskTimeStatus?.isPaused, taskTimeStatus?.taskId])

  useEffect(() => {
    const syncInterval = setInterval(() => {
      if (activeTask?.id || selectedTask?.id) {
        refreshTaskTimeStatus()
      }
    }, 30000)
    return () => clearInterval(syncInterval)
  }, [activeTask?.id, selectedTask?.id, refreshTaskTimeStatus])

  useEffect(() => {
    if (!window.electron.onNotification) return

    return window.electron.onNotification((data: { type: string; data?: Record<string, unknown> }) => {
      if (data.type === 'screen_permission_needed') {
        checkScreenPermission()
      }
      if (data.type === 'focus_check_complete' || data.type === 'deviation_alert') {
        refreshMonitoringState()
      }
      if (data.type === 'ollama_unavailable' && data.data) {
        const payload = data.data as { message?: string; pausedUntil?: number }
        setOllamaStatus('offline')
        setOllamaError(payload.message ?? 'Ollama unavailable')
        if (typeof payload.pausedUntil === 'number') {
          setOllamaPausedUntil(payload.pausedUntil)
          setNextCheckAt(payload.pausedUntil)
        }
        void checkOllama()
      }
      if (data.type === 'ollama_recovered') {
        setOllamaError(null)
        setOllamaPausedUntil(null)
        void checkOllama()
      }
      if (data.type === 'task_estimate_ready' && data.data) {
        const payload = data.data as { taskId?: string }
        void loadTasks().then(async () => {
          if (!payload.taskId || selectedTask?.id !== payload.taskId) return
          const tasks = await window.electron.getTasks()
          const updated = tasks.find((t: Task) => t.id === payload.taskId)
          if (updated) setSelectedTask(updated)
        })
      }
      if (data.type === 'focus_check_complete' && data.data) {
        const payload = data.data as Record<string, unknown>
        const display = focusCheckFromNotification(payload, selectedTask?.id ?? null)
        if (display) {
          applyFocusDisplay(display)
        }
      }
      if (data.type === 'monitoring_schedule_updated' && data.data) {
        if (typeof data.data.nextCheckAt === 'number' || data.data.nextCheckAt === null) {
          setNextCheckAt(data.data.nextCheckAt as number | null)
        }
        if (typeof data.data.checkInProgress === 'boolean') {
          setCheckInProgress(data.data.checkInProgress)
        }
      }
      if (data.type === 'monitoring_check_started') {
        setCheckInProgress(true)
      }
      if (data.type === 'time_tracking_updated' && data.data) {
        const status = data.data as TaskTimeStatus
        if (!selectedTask?.id || status.taskId === selectedTask.id) {
          setTaskTimeStatus(status)
          setLiveTimeSeconds(status.liveSeconds)
          setLiveBreakSeconds(status.breakSeconds)
          setLivePauseSeconds(status.pauseSeconds)
        }
      }
      if (data.type === 'pomodoro_updated' && data.data) {
        const state = data.data as {
          phase: typeof pomodoroPhase
          phaseEndsAt: number | null
        }
        setPomodoroPhase(state.phase)
        setPomodoroEndsAt(state.phaseEndsAt)
      }
      if (data.type === 'stale_progress' && data.data) {
        const payload = data.data as {
          taskId?: string
          taskTitle?: string
          reasons?: string[]
          level?: string
        }
        if (payload.level !== 'ok') {
          setStaleTaskId(payload.taskId ?? null)
          setStaleNotice(
            `${payload.taskTitle ?? 'Task'}: ${payload.reasons?.[0] ?? 'Progress looks stale'}`
          )
        }
      }
      if (data.type === 'phase_alert' && data.data) {
        const payload = data.data as { message?: string }
        if (payload.message) setPhaseNotice(payload.message)
      }
      if (data.type === 'offline_time_prompt' && data.data) {
        const payload = data.data as {
          taskId?: string
          taskTitle?: string
          offlineMinutes?: number
          sessionStartedAt?: string
        }
        if (payload.taskId && payload.taskTitle && payload.offlineMinutes && payload.sessionStartedAt) {
          setOfflineTimePrompt({
            taskId: payload.taskId,
            taskTitle: payload.taskTitle,
            offlineMinutes: payload.offlineMinutes,
            sessionStartedAt: payload.sessionStartedAt
          })
        }
      }
    })
  }, [checkScreenPermission, refreshMonitoringState, selectedTask?.id, applyFocusDisplay, checkOllama, loadTasks])

  useEffect(() => {
    if (checkInProgress) {
      setCountdownLabel('Checking screen…')
      return
    }
    if (!nextCheckAt || !monitoringInterval) {
      setCountdownLabel('')
      return
    }

    const tick = () => {
      const sec = Math.max(0, Math.ceil((nextCheckAt - Date.now()) / 1000))
      if (sec <= 0) {
        setCountdownLabel('Due now…')
        return
      }
      const m = Math.floor(sec / 60)
      const s = sec % 60
      setCountdownLabel(`${m}:${s.toString().padStart(2, '0')}`)
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [nextCheckAt, checkInProgress, monitoringInterval])

  const filteredTasks = tasks.filter((task) => {
    if (taskFilter === 'all') return true
    if (taskFilter === 'in_progress') return task.status === 'in_progress'
    if (taskFilter === 'completed') return task.status === 'completed'
    return true
  })

  const taskCounts = useMemo(() => {
    const completed = tasks.filter((t) => t.status === 'completed').length
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length
    return { total: tasks.length, completed, inProgress }
  }, [tasks])

  const showInProgressFilter =
    taskCounts.inProgress > 0 && taskCounts.inProgress < taskCounts.total
  const showCompletedFilter = taskCounts.completed > 0

  useEffect(() => {
    if (taskFilter === 'completed' && !showCompletedFilter) setTaskFilter('all')
    if (taskFilter === 'in_progress' && !showInProgressFilter) setTaskFilter('all')
  }, [taskFilter, showCompletedFilter, showInProgressFilter])

  const runningTask = useMemo(
    () => tasks.find((t) => t.work_sessions?.some((s) => !s.ended_at)),
    [tasks]
  )

  const quickStartTask = useMemo(() => {
    if (runningTask) return null
    return (
      tasks.find((t) => t.status === 'in_progress') ??
      (activeTask && activeTask.status !== 'completed' ? activeTask : null) ??
      tasks.find((t) => t.status === 'pending') ??
      null
    )
  }, [tasks, runningTask, activeTask])

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task)
    setAiResult(null)
  }

  const handleReturnToTask = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId)
    if (task) {
      setSelectedTask(task)
      setActiveView('tasks')
      setActiveTask(task)
    }
  }

  const startTaskById = async (task: Task) => {
    setSelectedTask(task)
    setActiveTask(task)
    try {
      const updated =
        task.status === 'in_progress'
          ? await resumeTaskWork(task.id)
          : await startTaskWork(task.id)
      await syncTaskFromWork(updated)
      await window.electron.setActiveTask(task.id)
      await refreshPomodoro()
      try {
        await requestScreenPermission()
      } catch {
        /* preload may be stale until restart */
      }
      await checkScreenPermission()
    } catch (err) {
      setAiResult(err instanceof Error ? err.message : 'Failed to start task')
    }
  }

  const handleStartTask = async () => {
    if (!selectedTask) return
    await startTaskById(selectedTask)
  }

  const handleQuickStart = async () => {
    if (!quickStartTask) return
    await startTaskById(quickStartTask)
  }

  const handlePauseTask = async () => {
    if (!selectedTask) return
    try {
      const task = await pauseTaskWork(selectedTask.id)
      await syncTaskFromWork(task)
    } catch (err) {
      setAiResult(err instanceof Error ? err.message : 'Failed to pause')
    }
  }

  const handleResumeTask = async () => {
    if (!selectedTask) return
    try {
      const task = await resumeTaskWork(selectedTask.id)
      await syncTaskFromWork(task)
      await window.electron.setActiveTask(selectedTask.id)
      await refreshPomodoro()
    } catch (err) {
      setAiResult(err instanceof Error ? err.message : 'Failed to resume')
    }
  }

  const handleEditTask = () => {
    if (!selectedTask) return
    setEditingTask(selectedTask)
    setShowTaskForm(true)
  }

  const handleDeleteTask = async () => {
    if (!selectedTask) return
    if (!confirm(`Delete "${selectedTask.title}"?`)) return
    await deleteTask(selectedTask.id)
    setSelectedTask(null)
  }

  const handleCompleteTask = async () => {
    if (!selectedTask) return
    try {
      const task = await completeTaskWork(selectedTask.id)
      await syncTaskFromWork(task)
      if (activeTask?.id === selectedTask.id) {
        setActiveTask(null)
      }
      try {
        await setMonitoringInterval(null, null)
      } catch {
        /* stale preload */
      }
      setMonitoringIntervalState(null)
      setNextCheckAt(null)
      setTaskTimeStatus(null)
      setLiveTimeSeconds(task.recorded_seconds ?? 0)
      setLiveBreakSeconds(0)
      setLivePauseSeconds(0)
    } catch (err) {
      setAiResult(err instanceof Error ? err.message : 'Failed to complete task')
    }
  }

  const applyPermissionCheck = async () => {
    const { status, captureWorks } = await verifyScreenCapture()
    if (status === 'granted' || captureWorks) {
      setScreenPermission('granted')
      setPermissionMessage(null)
      return true
    }
    setScreenPermission(status)
    return false
  }

  const handleGrantScreenPermission = async () => {
    setGrantingPermission(true)
    setPermissionMessage(null)
    try {
      const result = await requestScreenPermission()
      if (!(await applyPermissionCheck())) {
        setPermissionMessage(result.message)
      }
    } catch (err) {
      setPermissionMessage(err instanceof Error ? err.message : 'Grant permission failed')
    } finally {
      setGrantingPermission(false)
    }
  }

  const handleRecheckPermission = async () => {
    setGrantingPermission(true)
    try {
      if (!(await applyPermissionCheck())) {
        setPermissionMessage(
          'Still not enabled. In dev mode, turn on “Electron” under Privacy → Screen Recording.'
        )
      }
    } catch (err) {
      setPermissionMessage(err instanceof Error ? err.message : 'Could not check permission')
    } finally {
      setGrantingPermission(false)
    }
  }

  const handleOpenScreenSettings = async () => {
    setGrantingPermission(true)
    try {
      const result = await openScreenSettings()
      setPermissionMessage(
        result.opened
          ? 'System Settings opened — toggle Screen Recording for this app, then click “I enabled it”.'
          : 'Could not open System Settings. Go to Privacy & Security → Screen Recording manually.'
      )
    } catch (err) {
      setPermissionMessage(err instanceof Error ? err.message : 'Failed to open settings')
    } finally {
      setGrantingPermission(false)
    }
  }

  const handleStartMonitoring = async (minutes: number) => {
    if (!selectedTask) return
    if (selectedTask.status !== 'in_progress') {
      setAiResult('Start the task first, then pick a capture interval.')
      return
    }

    setAiLoading('monitor')
    setAiResult(null)
    try {
      await window.electron.setActiveTask(selectedTask.id)
      await setMonitoringInterval(selectedTask.id, minutes)
      setMonitoringIntervalState(minutes)
      const status = await getMonitoringStatus()
      setMainProcessStale(!!status.staleMainProcess)
      if (status.nextCheckAt) setNextCheckAt(status.nextCheckAt)
      setAiResult(
        status.staleMainProcess
          ? `Monitoring every ${minutes} min — restart app (Cmd+Q) for live countdown.`
          : `Monitoring every ${minutes} min — runs in background when minimized.`
      )
      await refreshMonitoringState()
    } catch (err) {
      setAiResult(err instanceof Error ? err.message : 'Failed to start monitoring')
    } finally {
      setAiLoading(null)
    }
  }

  const handleStopMonitoring = async () => {
    try {
      await setMonitoringInterval(null, null)
      setMonitoringIntervalState(null)
      setNextCheckAt(null)
      setCountdownLabel('')
      setAiResult('Screen monitoring stopped.')
    } catch (err) {
      setAiResult(err instanceof Error ? err.message : 'Failed to stop monitoring')
    }
  }

  const handleCheckNow = async () => {
    if (!selectedTask) return
    if (selectedTask.status !== 'in_progress') {
      setAiResult('Start the task first to check deviation from your screen.')
      return
    }

    setAiLoading('deviation')
    setAiResult(null)
    try {
      await window.electron.setActiveTask(selectedTask.id)
      const result = await checkDeviationFromScreen(selectedTask.id)
      const settings = await window.electron.getSettings()
      applyFocusFromSettings(settings, selectedTask.id)
      const pct = Math.round(result.similarity * 100)
      const status = result.onTask ? 'On task' : 'Off task'
      setAiResult(
        `${status} — ${pct}% match\n${result.suggestion}`
      )
    } catch (err) {
      setAiResult(err instanceof Error ? err.message : 'Screenshot check failed')
      await checkScreenPermission()
    } finally {
      setAiLoading(null)
    }
  }

  const handleCloseForm = async () => {
    setShowTaskForm(false)
    setEditingTask(undefined)
    await loadTasks()
  }

  const navButtonClass = (view: ActiveView) =>
    `w-full text-left px-4 py-2 rounded-lg transition-colors ${
      activeView === view
        ? 'bg-primary-600 text-white'
        : 'hover:bg-gray-700 text-gray-300'
    }`

  const filterButtonClass = (filter: TaskFilter) =>
    `w-full text-left px-4 py-2 rounded-lg transition-colors ${
      activeView === 'tasks' && taskFilter === filter
        ? 'bg-primary-600 text-white'
        : 'hover:bg-gray-700 text-gray-300'
    }`

  const getStatusColor = () => {
    switch (ollamaStatus) {
      case 'online': return 'bg-green-500'
      case 'offline': return 'bg-red-500'
      case 'model_missing': return 'bg-orange-500'
      case 'checking': return 'bg-yellow-500'
    }
  }

  const getStatusText = () => {
    if (ollamaError && ollamaStatus !== 'online') {
      return ollamaPausedUntil
        ? `Ollama down · retry ${new Date(ollamaPausedUntil).toLocaleTimeString()}`
        : 'Ollama down'
    }
    switch (ollamaStatus) {
      case 'online': return `Ollama · ${ollamaModel}`
      case 'offline': return 'Ollama offline'
      case 'model_missing': return `${ollamaModel} not found`
      case 'checking': return 'Checking Ollama...'
    }
  }

  return (
    <div className="h-screen bg-gray-900 text-gray-100 flex flex-col">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-primary-400">Task Assistant</h1>
            <p className="text-sm text-gray-400">AI-powered task management with gemma4:latest</p>
            <MonitorPicker compact className="mt-1" />
          </div>
          <div className="flex items-center gap-4">
            {activeView === 'tasks' && quickStartTask && (
              <button
                type="button"
                onClick={handleQuickStart}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary-600 hover:bg-primary-700 transition-colors max-w-[220px]"
                title={`Start: ${quickStartTask.title}`}
              >
                <span aria-hidden>▶</span>
                <span className="truncate">
                  {quickStartTask.status === 'in_progress' ? 'Resume' : 'Start'}{' '}
                  {quickStartTask.title}
                </span>
              </button>
            )}
            <button
              onClick={checkOllama}
              className="flex items-center gap-2 px-3 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
            >
              <div className={`w-2 h-2 rounded-full ${getStatusColor()} animate-pulse`} />
              <span className="text-xs text-gray-300">{getStatusText()}</span>
            </button>
            {pomodoroEnabled && pomodoroPhase !== 'idle' && pomodoroCountdown && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-red-900/40 text-red-100">
                <span>🍅</span>
                <span>
                  {pomodoroPhase === 'work'
                    ? 'Focus'
                    : pomodoroPhase === 'long_break'
                      ? 'Long break'
                      : 'Break'}{' '}
                  {pomodoroCountdown}
                </span>
                {window.electron.skipPomodoroPhase && (
                  <button
                    type="button"
                    onClick={() => window.electron.skipPomodoroPhase?.().then(refreshPomodoro)}
                    className="ml-1 text-[10px] underline opacity-80 hover:opacity-100"
                  >
                    Skip
                  </button>
                )}
              </div>
            )}
            {monitoringInterval && (
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                  checkInProgress ? 'bg-orange-900/60 text-orange-200' : 'bg-green-900/50 text-green-200'
                }`}
                title="Monitoring continues when minimized"
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    checkInProgress ? 'bg-orange-400 animate-pulse' : 'bg-green-400'
                  }`}
                />
                {checkInProgress ? 'Checking…' : countdownLabel ? `Next ${countdownLabel}` : 'Monitoring'}
              </div>
            )}
            {activeView === 'tasks' && (
              <button
                onClick={() => {
                  setEditingTask(undefined)
                  setShowTaskForm(true)
                }}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg font-medium transition-colors"
              >
                + New Task
              </button>
            )}
          </div>
        </div>
      </header>

      {phaseNotice && (
        <div className="bg-teal-900/40 border-b border-teal-700 px-6 py-2 text-sm text-teal-100 flex items-center justify-between gap-3">
          <span>{phaseNotice}</span>
          <button type="button" onClick={() => setPhaseNotice(null)} className="text-xs underline shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {staleNotice && (
        <div className="bg-orange-900/40 border-b border-orange-700 px-6 py-2 text-sm text-orange-100 flex items-center justify-between gap-3 flex-wrap">
          <span>{staleNotice}</span>
          <div className="flex gap-2 shrink-0">
            {(staleTaskId || selectedTask?.id) && (
              <button
                type="button"
                onClick={() =>
                  openStuckProbe(staleTaskId ?? selectedTask!.id, 'stale')
                }
                className="text-xs px-2 py-1 bg-orange-800 hover:bg-orange-700 rounded"
              >
                Stuck — probe subtask
              </button>
            )}
            {selectedTask && (
              <button
                type="button"
                onClick={async () => {
                  if (!selectedTask) return
                  try {
                    const result = await estimateTaskTime(selectedTask)
                    await updateTask(selectedTask.id, { ai_estimate_minutes: result.estimate })
                    setSelectedTask({ ...selectedTask, ai_estimate_minutes: result.estimate })
                    setStaleNotice(null)
                  } catch {
                    /* Progress panel shows estimate errors */
                  }
                }}
                className="text-xs px-2 py-1 bg-orange-800 hover:bg-orange-700 rounded"
              >
                Re-estimate
              </button>
            )}
            <button
              type="button"
              onClick={() => setStaleNotice(null)}
              className="text-xs underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {(ollamaError || ollamaStatus === 'offline' || ollamaStatus === 'model_missing' || ollamaRuntimeError) && (
        <div className="bg-red-950/80 border-b border-red-800 px-6 py-2 text-sm text-red-100 flex items-center justify-between gap-3">
          <span>
            {ollamaRuntimeError ? (
              <>
                ⚠️ Ollama stopped responding during operation. Restart with:{' '}
                <code className="bg-red-900 px-1 rounded font-mono text-xs">
                  {ollamaRuntimeError.command}
                </code>
              </>
            ) : (
              <>
                {ollamaError ??
                  (ollamaStatus === 'model_missing'
                    ? `Model "${ollamaModel}" not loaded — run: ollama run ${ollamaModel}`
                    : 'Ollama is not running. Start it with: ollama serve')}
              </>
            )}
            {ollamaPausedUntil && (
              <span className="text-red-300/80">
                {' '}
                · screen checks retry {new Date(ollamaPausedUntil).toLocaleTimeString()}
              </span>
            )}
          </span>
          <div className="flex gap-2 shrink-0">
            {ollamaRuntimeError && (
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(ollamaRuntimeError.command)
                }}
                className="px-2 py-1 text-xs rounded bg-red-900 hover:bg-red-800"
                title="Copy restart command"
              >
                📋 Copy
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setOllamaRuntimeError(null)
                void checkOllama()
              }}
              className="px-2 py-1 text-xs rounded bg-red-900 hover:bg-red-800"
            >
              Retry
            </button>
          </div>
        </div>
      )}
      {!preloadReady && (
        <div className="bg-amber-900/50 border-b border-amber-700 px-6 py-2 text-sm text-amber-100">
          Screen capture APIs not loaded — quit the app fully (Cmd+Q), then run{' '}
          <code className="bg-amber-900 px-1 rounded">npm run electron:dev</code> again.
          {preloadHint && <span className="block mt-1 text-amber-200/80 text-xs">{preloadHint}</span>}
        </div>
      )}
      {mainProcessStale && preloadReady && (
        <div className="bg-amber-900/50 border-b border-amber-700 px-6 py-2 text-sm text-amber-100">
          Monitoring timer out of sync — quit fully (<kbd className="px-1 bg-amber-900 rounded">Cmd+Q</kbd>)
          {' '}and run <code className="bg-amber-900 px-1 rounded">npm run electron:dev</code> again.
        </div>
      )}
      {preloadReady && screenPermission !== 'granted' && screenPermission !== 'unsupported' && (
        <div className="bg-blue-900/50 border-b border-blue-700 px-6 py-3 text-sm text-blue-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex-1 min-w-[200px]">
              <p className="font-medium">Screen Recording required</p>
              <p className="text-blue-200/80 text-xs mt-0.5">
                {permissionMessage ||
                  'Click Grant access — macOS will prompt you, or open Settings. In dev, enable “Electron”.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                type="button"
                onClick={handleGrantScreenPermission}
                disabled={grantingPermission}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs font-medium"
              >
                {grantingPermission ? 'Working…' : 'Grant access'}
              </button>
              <button
                type="button"
                onClick={handleOpenScreenSettings}
                disabled={grantingPermission}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-xs font-medium"
              >
                Open Settings
              </button>
              <button
                type="button"
                onClick={handleRecheckPermission}
                disabled={grantingPermission}
                className="px-3 py-1.5 bg-green-800 hover:bg-green-700 disabled:opacity-50 rounded text-xs font-medium"
              >
                I enabled it
              </button>
            </div>
          </div>
        </div>
      )}

      {ollamaStatus === 'model_missing' && (
        <div className="bg-orange-900/50 border-b border-orange-700 px-6 py-2 text-sm text-orange-200">
          Model not found. Run <code className="bg-orange-900 px-1 rounded">ollama pull {ollamaModel}</code>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-64 bg-gray-800 border-r border-gray-700 p-4 flex flex-col">
          {activeView === 'tasks' && (
            <div className="mb-4 pb-4 border-b border-gray-700">
              <MonitorPicker />
            </div>
          )}
          <nav className="space-y-1">
            <p className="text-xs text-gray-500 uppercase tracking-wide px-4 mb-2">Tasks</p>
            <button
              onClick={() => { setActiveView('tasks'); setTaskFilter('all') }}
              className={filterButtonClass('all')}
            >
              All Tasks
            </button>
            {showInProgressFilter && (
              <button
                onClick={() => { setActiveView('tasks'); setTaskFilter('in_progress') }}
                className={filterButtonClass('in_progress')}
              >
                In Progress
              </button>
            )}
            {showCompletedFilter && (
              <button
                onClick={() => { setActiveView('tasks'); setTaskFilter('completed') }}
                className={filterButtonClass('completed')}
              >
                Completed
              </button>
            )}

            <p className="text-xs text-gray-500 uppercase tracking-wide px-4 mb-2 mt-4">Features</p>
            <button onClick={() => setActiveView('analytics')} className={navButtonClass('analytics')}>
              Analytics
            </button>
            {smeValidatorActive(featureFlags) && (
              <button onClick={() => setActiveView('sme')} className={navButtonClass('sme')}>
                SME Validation
              </button>
            )}
            {focusMonitorActive(featureFlags) && (
              <button onClick={() => setActiveView('focus')} className={navButtonClass('focus')}>
                Screen Capture
              </button>
            )}
            {reviewActive(featureFlags) && (
              <button onClick={() => setActiveView('review')} className={navButtonClass('review')}>
                Review workspace
              </button>
            )}
            {semanticSorterActive(featureFlags) && (
              <button
                onClick={() => setActiveView('desktop_sorter')}
                className={navButtonClass('desktop_sorter')}
              >
                Desktop Sorter
              </button>
            )}
            <button onClick={() => setActiveView('settings')} className={navButtonClass('settings')}>
              Settings
            </button>
          </nav>

          {activeTask && (
            <div className="mt-6 p-4 bg-green-900/30 border border-green-700 rounded-lg">
              <div className="text-xs text-green-400 font-medium mb-1">ACTIVE TASK</div>
              <div className="text-sm font-medium">{activeTask.title}</div>
              <div className="text-xs text-gray-400 mt-2 font-mono">
                {formatDurationClock(
                  activeTask.id === taskTimeStatus?.taskId
                    ? liveTimeSeconds
                    : activeTask.recorded_seconds ?? 0
                )}
                {taskTimeStatus?.taskId === activeTask.id && taskTimeStatus.isPaused && (
                  <span className="ml-2 text-amber-400">paused</span>
                )}
              </div>
            </div>
          )}
        </aside>

        <main className="flex-1 overflow-auto p-6">
          {activeView === 'tasks' && (
            <TaskList
              tasks={filteredTasks}
              onTaskClick={handleTaskClick}
              taskTimeStatus={taskTimeStatus}
              onPlay={startTaskById}
              onPause={async (task) => {
                try {
                  const updated = await pauseTaskWork(task.id)
                  await syncTaskFromWork(updated)
                } catch { /* ignore */ }
              }}
              onResume={async (task) => {
                try {
                  const updated = await resumeTaskWork(task.id)
                  await syncTaskFromWork(updated)
                  await window.electron.setActiveTask(task.id)
                } catch { /* ignore */ }
              }}
            />
          )}
          {activeView === 'analytics' && <TaskAnalytics />}
          {activeView === 'settings' && (
            <SettingsPanel onSettingsSaved={() => void refreshFeatureFlags()} />
          )}
          {activeView === 'sme' && smeValidatorActive(featureFlags) && (
            <SMEValidation
              task={selectedTask}
              onUpdate={async (updates) => {
                if (!selectedTask) return
                await window.electron.updateTask(selectedTask.id, updates)
                setSelectedTask({ ...selectedTask, ...updates })
              }}
            />
          )}
          {activeView === 'desktop_sorter' && semanticSorterActive(featureFlags) && (
            <SemanticSorterPanel />
          )}
          {activeView === 'focus' && focusMonitorActive(featureFlags) && (
            <ScreenCapture selectedTaskId={selectedTask?.id || activeTask?.id} />
          )}
          {activeView === 'review' && reviewActive(featureFlags) && selectedTask && (
            <WorktreeReviewTab
              task={selectedTask}
              onTaskUpdated={(updated) => setSelectedTask(updated)}
            />
          )}
          {activeView === 'review' && reviewActive(featureFlags) && !selectedTask && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-gray-400">
                <p className="text-lg mb-2">Select a task to open its review workspace</p>
                <p className="text-sm">Choose a task from the sidebar to get started</p>
              </div>
            </div>
          )}
        </main>

        {selectedTask && activeView === 'tasks' && (
          <aside className="w-96 bg-gray-800 border-l border-gray-700 p-6 overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Task Details</h2>
              <button
                onClick={() => setSelectedTask(null)}
                className="text-gray-400 hover:text-gray-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-bold mb-2">{selectedTask.title}</h3>
                <p className="text-gray-400 text-sm">{selectedTask.description}</p>
              </div>

              <div className="flex gap-2 flex-wrap">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  selectedTask.priority === 'urgent' ? 'bg-red-900 text-red-200' :
                  selectedTask.priority === 'high' ? 'bg-orange-900 text-orange-200' :
                  selectedTask.priority === 'medium' ? 'bg-yellow-900 text-yellow-200' :
                  'bg-gray-700 text-gray-300'
                }`}>
                  {selectedTask.priority}
                </span>
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  selectedTask.status === 'completed' ? 'bg-green-900 text-green-200' :
                  selectedTask.status === 'in_progress' ? 'bg-blue-900 text-blue-200' :
                  'bg-gray-700 text-gray-300'
                }`}>
                  {selectedTask.status.replace('_', ' ')}
                </span>
              </div>

              {(selectedTask.ai_estimate_minutes || selectedTask.user_estimate_minutes) && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <span className="text-indigo-400">🤖</span>
                  <span>
                    {selectedTask.user_estimate_minutes
                      ? `${selectedTask.user_estimate_minutes} min`
                      : `~${selectedTask.ai_estimate_minutes} min`}
                    {effectiveEstimate(selectedTask) != null && (
                      <>
                        {' · '}
                        ~{Math.max(
                          0,
                          Math.round(
                            effectiveEstimate(selectedTask)! *
                              (1 - (selectedTask.progress_percent ?? 0) / 100) -
                              (selectedTask.recorded_seconds ?? 0) / 60
                          )
                        )}{' '}
                        left
                      </>
                    )}
                  </span>
                </div>
              )}

              <TaskProgressPanel
                task={selectedTask}
                onUpdate={async (updates) => {
                  const updated = await window.electron.updateTask(selectedTask.id, updates)
                  setSelectedTask(updated)
                  setStaleNotice(null)
                  await loadTasks()
                }}
              />

              <TaskBreakdownPanel
                task={selectedTask}
                flags={featureFlags}
                onUpdate={async (updates: Partial<Task>) => {
                  const updated = await window.electron.updateTask(selectedTask.id, updates)
                  setSelectedTask(updated)
                  await loadTasks()
                }}
                onOpenProbe={(trigger) => openProbeForTask(trigger)}
              />

              {renderTaskDetailSlots({
                task: selectedTask,
                flags: featureFlags,
                onOpenProbe: (trigger, options) => openProbeForTask(trigger, options),
                onUpdate: async (updates) => {
                  const merged = { ...updates }
                  if (updates.phase_balance && selectedTask.phase_balance) {
                    merged.phase_balance = {
                      ...selectedTask.phase_balance,
                      ...updates.phase_balance,
                      extract_events_7d:
                        (selectedTask.phase_balance.extract_events_7d ?? 0) +
                        (updates.phase_balance.extract_events_7d ?? 0)
                    }
                  }
                  const updated = await window.electron.updateTask(selectedTask.id, merged)
                  setSelectedTask(updated)
                  await loadTasks()
                }
              })}

              <div className="bg-gray-800 rounded-lg p-3 border border-gray-600/80">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500 uppercase tracking-wide">Recorded time</span>
                  {taskTimeStatus?.taskId === selectedTask.id && taskTimeStatus.isRunning && (
                    <span className="text-xs text-green-400">● recording</span>
                  )}
                  {taskTimeStatus?.taskId === selectedTask.id && taskTimeStatus.isPaused && (
                    <span className="text-xs text-amber-400">paused</span>
                  )}
                </div>
                <p className="text-2xl font-mono text-white">
                  {formatDurationClock(
                    taskTimeStatus?.taskId === selectedTask.id
                      ? liveTimeSeconds
                      : selectedTask.recorded_seconds ?? 0
                  )}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {formatDuration(
                    taskTimeStatus?.taskId === selectedTask.id
                      ? liveTimeSeconds
                      : selectedTask.recorded_seconds ?? 0
                  )}{' '}
                  work ·{' '}
                  {formatDuration(
                    taskTimeStatus?.taskId === selectedTask.id
                      ? liveBreakSeconds
                      : taskTimeStatus?.breakSeconds ?? 0
                  )}{' '}
                  break ·{' '}
                  {formatDuration(
                    taskTimeStatus?.taskId === selectedTask.id
                      ? livePauseSeconds
                      : taskTimeStatus?.pauseSeconds ?? 0
                  )}{' '}
                  paused · {selectedTask.work_sessions?.length ?? 0} sessions
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Auto screen capture
                    {monitoringInterval && (
                      <span className="ml-2 text-xs text-green-400 font-normal">
                        every {monitoringInterval} min
                      </span>
                    )}
                  </label>
                  <p className="text-xs text-gray-500 mb-2">
                    Runs in the background when minimized. Alerts via macOS notification + in-app banner.
                  </p>
                  {monitoringInterval && (countdownLabel || checkInProgress) && (
                    <div
                      className={`mb-3 px-3 py-2 rounded-lg text-xs font-medium ${
                        checkInProgress
                          ? 'bg-orange-900/40 text-orange-200 border border-orange-800/50'
                          : 'bg-green-900/30 text-green-200 border border-green-800/40'
                      }`}
                    >
                      {checkInProgress
                        ? 'Capturing screen and checking focus…'
                        : `Next check in ${countdownLabel}`}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {MONITOR_INTERVALS.map((min) => (
                      <button
                        key={min}
                        type="button"
                        onClick={() => handleStartMonitoring(min)}
                        disabled={aiLoading === 'monitor' || selectedTask.status !== 'in_progress'}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${
                          monitoringInterval === min
                            ? 'bg-green-700 text-white ring-2 ring-green-500'
                            : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                        }`}
                      >
                        {min}m
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={handleStopMonitoring}
                      disabled={!monitoringInterval}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-900/80 hover:bg-red-800 text-red-200 disabled:opacity-40"
                    >
                      Off
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCheckNow}
                  disabled={aiLoading === 'deviation' || selectedTask.status !== 'in_progress'}
                  className="w-full px-3 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 rounded-lg text-sm font-medium"
                >
                  {aiLoading === 'deviation' ? 'Capturing screen…' : 'Check now (screenshot)'}
                </button>

                {(detectedActivity || focusMatch.similarity !== null) && (
                  <div className="bg-gray-700/80 rounded-lg p-3 text-sm space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-gray-500">Last screen check</p>
                      {focusMatch.onTask !== null && (
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${
                            focusMatch.onTask
                              ? 'bg-green-900/80 text-green-200'
                              : 'bg-orange-900/80 text-orange-200'
                          }`}
                        >
                          {focusMatch.onTask ? 'On task' : 'Off task'}
                        </span>
                      )}
                    </div>
                    {detectedActivity && (
                      <p className="text-gray-200">{detectedActivity}</p>
                    )}
                    {focusMatch.similarity !== null && selectedTask && (
                      <p className="text-xs text-gray-400">
                        {Math.round(focusMatch.similarity * 100)}% match with &ldquo;{selectedTask.title}&rdquo;
                        {selectedTask.description ? ' (title + description)' : ''}
                      </p>
                    )}
                    {focusMatch.screenSimilarity != null && focusMatch.screenSimilarity >= 0.85 && (
                      <p className="text-xs text-amber-400">
                        Screen {Math.round(focusMatch.screenSimilarity * 100)}% similar to recent checks — possible stuck view
                      </p>
                    )}
                    {focusMatch.note && (
                      <p className="text-xs text-gray-500 italic">{focusMatch.note}</p>
                    )}
                    {lastCheckAt && (
                      <p className="text-xs text-gray-500">
                        {new Date(lastCheckAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                )}
                {selectedTask.status === 'in_progress' &&
                  !detectedActivity &&
                  focusMatch.similarity === null && (
                    <p className="text-xs text-gray-600 px-1">
                      No screen check for this task yet. Use Check now or enable auto capture.
                    </p>
                  )}

              </div>

              {aiResult && (
                <div className="bg-gray-700 rounded-lg p-3 text-sm text-gray-300 whitespace-pre-wrap">
                  {aiResult}
                </div>
              )}

              <div className="pt-4 border-t border-gray-700 space-y-2">
                {selectedTask.status !== 'in_progress' && selectedTask.status !== 'completed' && (
                  <button
                    onClick={handleStartTask}
                    className="w-full px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg font-medium"
                  >
                    Start Task
                  </button>
                )}
                {selectedTask.status === 'in_progress' && (
                  <>
                    {(taskTimeStatus?.taskId === selectedTask.id
                      ? taskTimeStatus.isRunning
                      : taskHasOpenSession(selectedTask)) ? (
                      <button
                        onClick={handlePauseTask}
                        className="w-full px-4 py-2 bg-amber-800 hover:bg-amber-700 rounded-lg font-medium"
                      >
                        Pause (break)
                      </button>
                    ) : (
                      <button
                        onClick={handleResumeTask}
                        className="w-full px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded-lg font-medium"
                      >
                        Resume
                      </button>
                    )}
                    <button
                      onClick={handleCompleteTask}
                      className="w-full px-4 py-2 bg-green-700 hover:bg-green-600 rounded-lg font-medium"
                    >
                      Complete Task
                    </button>
                  </>
                )}
                <button
                  onClick={handleEditTask}
                  className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium"
                >
                  Edit Task
                </button>
                <button
                  onClick={handleDeleteTask}
                  className="w-full px-4 py-2 bg-red-900 hover:bg-red-800 rounded-lg font-medium"
                >
                  Delete Task
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>

      <DeviationAlert
        onReturnToTask={handleReturnToTask}
        onStuckProbe={openStuckProbe}
        onAddSubtask={async (taskId: string, subtask: import('./lib/subtaskTypes').TaskSubtask) => {
          const task = tasks.find((t) => t.id === taskId)
          if (!task) return

          const items = resolveTaskBreakdown(task)
          const newItem = createTechnicalBreakdownItem({
            id: subtask.id,
            title: subtask.title,
            input: subtask.input,
            output: subtask.output,
            transformation: subtask.transformation,
            outcome: subtask.outcome,
            status: subtask.status,
            source: 'user',
            phase: subtask.phase,
            order: items.length
          })
          await window.electron.updateTask(taskId, {
            task_breakdown: [...items, newItem],
            progress_percent: clampProgressPercent(
              calculateProgress([...items, newItem])
            )
          })
          await loadTasks()
        }}
      />

      {stuckProbe && (() => {
        const probeTask =
          tasks.find((t) => t.id === stuckProbe.taskId) ??
          (selectedTask?.id === stuckProbe.taskId ? selectedTask : null)
        if (!probeTask) return null

        const snoozeAutoProbe = async () => {
          const trigger = stuckProbe.trigger
          if (trigger === 'deviation' || trigger === 'stale') {
            await updateTask(probeTask.id, {
              drive_prompt_dates: markPromptedToday(
                probeTask.drive_prompt_dates,
                probePromptKey(trigger)
              )
            })
          }
        }

        return (
          <SubtaskProbeModal
            taskId={probeTask.id}
            taskTitle={probeTask.title}
            taskDay={stuckProbe.taskDay}
            primeDay={stuckProbe.primeDay}
            trigger={stuckProbe.trigger}
            workPhase={stuckProbe.workPhase}
            existingItems={resolveTaskBreakdown(probeTask)}
            activeSubtaskId={probeTask.active_subtask_id}
            onLater={() => {
              void snoozeAutoProbe().finally(() => setStuckProbe(null))
            }}
            onWorkTimerStarted={() => {
              void refreshTaskTimeStatus(probeTask.id)
            }}
            onAccept={async (updates) => {
              const patch: Partial<Task> = {
                task_breakdown: updates.task_breakdown,
                active_subtask_id: updates.active_subtask_id,
                probe_must_code_by: updates.probe_must_code_by,
                work_phase: updates.work_phase,
                progress_percent: clampProgressPercent(
                  calculateProgress(updates.task_breakdown)
                )
              }
              if (updates.phase_balance) {
                patch.phase_balance = {
                  ...(probeTask.phase_balance ?? {
                    playground_minutes_7d: 0,
                    core_minutes_7d: 0,
                    extract_events_7d: 0
                  }),
                  extract_events_7d:
                    (probeTask.phase_balance?.extract_events_7d ?? 0) +
                    (updates.phase_balance.extract_events_7d ?? 0)
                }
              }
              if (updates.drive_acknowledged_primes?.length) {
                patch.drive_acknowledged_primes = [
                  ...new Set([
                    ...(probeTask.drive_acknowledged_primes ?? []),
                    ...updates.drive_acknowledged_primes
                  ])
                ]
              }
              if (stuckProbe.workPhase === 'extract') {
                patch.work_phase = updates.work_phase ?? 'core'
                patch.work_phase_source = 'probe'
                patch.work_phase_set_at = new Date().toISOString()
              }
              const updated = await window.electron.updateTask(probeTask.id, patch)
              if (selectedTask?.id === probeTask.id) setSelectedTask(updated)
              await loadTasks()
              await snoozeAutoProbe()
              setStuckProbe(null)
              setStaleNotice(null)
            }}
          />
        )
      })()}

      {showTaskForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-auto">
            <TaskForm editTask={editingTask} onClose={handleCloseForm} />
          </div>
        </div>
      )}

      {offlineTimePrompt && (
        <OfflineTimePrompt
          taskId={offlineTimePrompt.taskId}
          taskTitle={offlineTimePrompt.taskTitle}
          offlineMinutes={offlineTimePrompt.offlineMinutes}
          sessionStartedAt={offlineTimePrompt.sessionStartedAt}
          onSubmit={async (breakMinutes, workMinutes) => {
            try {
              await allocateOfflineTime(offlineTimePrompt.taskId, {
                offlineStartIso: offlineTimePrompt.sessionStartedAt,
                breakMinutes,
                workMinutes
              })
              await loadTasks()
              if (selectedTask?.id === offlineTimePrompt.taskId) {
                await refreshTaskTimeStatus(offlineTimePrompt.taskId)
              }
            } catch (err) {
              setAiResult(err instanceof Error ? err.message : 'Failed to record offline time')
            }
            setOfflineTimePrompt(null)
          }}
          onDismiss={() => {
            console.log('[offline-time] User dismissed prompt')
            setOfflineTimePrompt(null)
          }}
        />
      )}
    </div>
  )
}

export default App
