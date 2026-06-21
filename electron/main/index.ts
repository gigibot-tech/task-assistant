import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { captureScreen, captureScreenBase64, cleanupOldScreenshots, getRecentScreenshots, getScreenPermissionStatus, requestScreenPermission, openScreenRecordingSettings, verifyScreenCaptureWorks } from './screenCapture'
import { checkDeviationFromScreen, analyzeScreenshotActivity, compareTaskToActivity, formatPlannedTask } from './activityAnalysis'
import { deliverDeviationAlert, updateTrayMonitoringLabel } from './focusAlerts'
import { initNativeNotifications, openNotificationSettings, showNativeNotification } from './nativeNotifications'
import {
  cancelScheduledCheck,
  disableBackgroundMonitoring,
  enableBackgroundMonitoring,
  isCheckInProgress,
  scheduleCheckAt,
  scheduleNextCheck,
  setCheckInProgress
} from './monitoringSchedule'
import axios from 'axios'
import {
  checkpointAllTasks,
  completeTaskWork,
  findRunningTaskId,
  getTaskTimeStatusFromList,
  migrateAllTaskTimes,
  pauseTaskWork,
  resumeTaskWork,
  startTaskWork
} from './timeTrackingService'
import {
  configurePomodoro,
  defaultPomodoroSettings,
  getPomodoroSettings,
  getPomodoroState,
  setPomodoroPhaseEndHandler,
  skipPomodoroPhase,
  startPomodoroWork,
  stopPomodoro,
  type PomodoroSettings
} from './pomodoroSchedule'
import { computeStaleScore, effectiveEstimateMinutes, type StaleSensitivity } from './staleProgress'
import { applyCalibration, checklistProgressPercent, recordCalibrationSample } from './estimationCalibration'
import {
  analyzeCaptureHistory,
  appendFocusCapture,
  unchangedScreenHint,
  type FocusCaptureRecord
} from './screenshotSimilarity'
import { shouldSendAlert } from './alertCooldown'
import { defaultWorkplaceSettings } from './workplace/workplacePaths'
import {
  indexTaskWorkplace,
  openWorkplacePath,
  runDeviationRecovery,
  type WorkplaceTaskRecord
} from './workplace/workplaceContext'
import { runSubtaskProbe } from './subtaskProbe/subtaskProbe'
import {
  bandToSeconds,
  defaultWastedStats,
  recordOffTaskEpisode,
  recordWastedTime
} from './subtaskProbe/wastedTime'
import { taskSubtaskContextFromTask } from './subtaskProbe/subtaskFocusContext'
import {
  DEFAULT_FEATURE_FLAGS,
  getFeatureFlagsFromSettings
} from './features/registry'
import {
  getFeatureBus,
  getRegisteredModules,
  initFeatureKernel,
  runAfterPipeline
} from './features/kernel/register'
import { registerFeatureIpc } from './features/kernel/ipcRouter'
import type { DomainEvent, FeatureContext } from '../../src/shared/kernel/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_OLLAMA_MODEL = 'gemma4:latest'
const OLLAMA_API_URL = 'http://localhost:11434/api/generate'
const OLLAMA_TAGS_URL = 'http://localhost:11434/api/tags'

let dataPath: string
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let snoozeUntil: number | null = null
let snoozeResumeTimeout: ReturnType<typeof setTimeout> | null = null
let timeCheckpointInterval: ReturnType<typeof setInterval> | null = null
let pomodoroCyclesCompleted = 0

const DEVIATION_ALERT_COOLDOWN_MS = 5 * 60 * 1000
const STALE_ALERT_COOLDOWN_MS = 30 * 60 * 1000

function resolvePreloadScript(): string {
  const base = path.join(__dirname, '../preload')
  for (const name of ['index.js', 'index.mjs', 'index.cjs']) {
    const candidate = path.join(base, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return path.join(base, 'index.js')
}

function getPomodoroSettingsFromData(data: ReturnType<typeof readData>): PomodoroSettings {
  return { ...defaultPomodoroSettings(), ...(data.settings?.pomodoro || {}) }
}

function getWorkplaceSettingsFromData(data: ReturnType<typeof readData>) {
  return {
    workplaceMaxListFiles: data.settings?.workplaceMaxListFiles,
    workplaceMaxReadBytes: data.settings?.workplaceMaxReadBytes,
    workplaceMaxDepth: data.settings?.workplaceMaxDepth
  }
}

function initDataStorage() {
  dataPath = path.join(app.getPath('userData'), 'data.json')

  if (!fs.existsSync(dataPath)) {
    const initialData = {
      tasks: [],
      deviations: [],
      estimates: [],
      communications: [],
      settings: {
        ollamaModel: DEFAULT_OLLAMA_MODEL,
        deviationThreshold: 0.7,
        pollIntervalMinutes: 5,
        activeTaskId: null,
        currentActivity: '',
        lastSimilarity: null,
        lastOnTask: null,
        lastFocusNote: '',
        lastCheckedTaskId: null,
        nextCheckAt: null,
        screenPermissionPrompted: false,
        autoScreenshotMonitoring: true,
        pomodoro: defaultPomodoroSettings(),
        staleSensitivity: 'medium' as StaleSensitivity,
        estimate_calibration_factor: 1,
        estimate_calibration_samples: [],
        lastStaleAlertAt: null,
        lastDeviationAlertAt: null,
        workplaceGuidanceEnabled: true,
        wasted_stats: defaultWastedStats(),
        wastedBandMinutes: {
          under_10m: 5,
          '30m': 25,
          '1_2h': 90,
          more: 150
        },
        recordOffTaskWasted: true,
        featureFlags: { ...DEFAULT_FEATURE_FLAGS },
        ...defaultWorkplaceSettings()
      }
    }
    fs.writeFileSync(dataPath, JSON.stringify(initialData, null, 2))
  }
}

function readData() {
  const data = fs.readFileSync(dataPath, 'utf-8')
  return JSON.parse(data)
}

function writeData(data: any) {
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2))
}

function migratePersistedData() {
  const data = readData()
  data.tasks = migrateAllTaskTimes(data.tasks || [])
  writeData(data)
}

function notifyTimeTrackingUpdate(taskId?: string | null) {
  const data = readData()
  const id = taskId ?? data.settings?.activeTaskId ?? findRunningTaskId(data.tasks || [])
  if (!id) return
  const status = getTaskTimeStatusFromList(data.tasks || [], id)
  if (status) {
    sendNotification({ type: 'time_tracking_updated', data: status })
  }
}

function startTimePersistenceLoop() {
  if (timeCheckpointInterval) clearInterval(timeCheckpointInterval)
  timeCheckpointInterval = setInterval(() => {
    const data = readData()
    const tasks = checkpointAllTasks(data.tasks || [])
    data.tasks = tasks
    writeData(data)
    notifyTimeTrackingUpdate()
  }, 30000)
}

function getFeatureFlags(): ReturnType<typeof getFeatureFlagsFromSettings> {
  const data = readData()
  return getFeatureFlagsFromSettings(data.settings)
}

function emitFeatureBus(event: DomainEvent, ctx: FeatureContext) {
  try {
    getFeatureBus().emit(event, ctx)
  } catch {
    // Kernel not initialized yet (early boot)
  }
}

function getOllamaModel(): string {
  const data = readData()
  return data.settings?.ollamaModel || DEFAULT_OLLAMA_MODEL
}

function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function sendNotification(payload: Record<string, unknown>) {
  mainWindow?.webContents.send('notification', payload)
}

function persistNextCheckAt(nextAt: number | null) {
  const data = readData()
  data.settings = { ...data.settings, nextCheckAt: nextAt }
  writeData(data)
  sendNotification({
    type: 'monitoring_schedule_updated',
    data: { nextCheckAt: nextAt, checkInProgress: isCheckInProgress() }
  })
}

function broadcastMonitoringState(nextCheckAt?: number | null) {
  const data = readData()
  const settings = data.settings || {}
  sendNotification({
    type: 'monitoring_schedule_updated',
    data: {
      nextCheckAt: nextCheckAt ?? settings.nextCheckAt ?? null,
      checkInProgress: isCheckInProgress(),
      monitoring: !!settings.autoScreenshotMonitoring && !!settings.activeTaskId,
      intervalMinutes: settings.pollIntervalMinutes ?? null
    }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: resolvePreloadScript(),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    // DevTools auto-open triggers harmless Autofill CDP errors in Electron — opt in only.
    if (process.env.OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.openDevTools({ mode: 'detach' })
      })
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function resolveIconPath(): string {
  const packaged = path.join(process.resourcesPath, 'resources/icon.png')
  if (app.isPackaged && fs.existsSync(packaged)) {
    return packaged
  }
  return path.join(__dirname, '../../resources/icon.png')
}

function createTray() {
  const iconPath = resolveIconPath()
  let icon: Electron.NativeImage

  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath)
  } else {
    icon = nativeImage.createEmpty()
  }

  if (icon.isEmpty()) {
    return
  }

  tray = new Tray(icon.resize({ width: 16, height: 16 }))

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show App', click: () => mainWindow?.show() },
    { label: 'Quit', click: () => app.quit() }
  ])

  tray.setToolTip('Task Assistant')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.show()
    mainWindow?.focus()
  })
}

function updateTrayForMonitoring(active: boolean, intervalMinutes?: number) {
  if (!tray || tray.isDestroyed()) return
  if (active && intervalMinutes) {
    updateTrayMonitoringLabel(tray, `Task Assistant — Monitoring every ${intervalMinutes}m`)
  } else {
    updateTrayMonitoringLabel(tray, 'Task Assistant')
  }
}

async function checkOllamaHealth(): Promise<{ online: boolean; modelAvailable: boolean; model: string }> {
  const model = getOllamaModel()
  try {
    const response = await axios.get(OLLAMA_TAGS_URL, { timeout: 5000 })
    const models: { name: string }[] = response.data?.models || []
    const modelAvailable = models.some(
      (m) => m.name === model || m.name.startsWith(`${model.split(':')[0]}:`)
    )
    return { online: true, modelAvailable, model }
  } catch {
    return { online: false, modelAvailable: false, model }
  }
}

function logDeviation(entry: Record<string, unknown>) {
  const data = readData()
  if (!data.deviations) data.deviations = []
  data.deviations.push({ ...entry, timestamp: new Date().toISOString() })
  writeData(data)
}

async function ensureScreenPermission(promptIfNeeded = true): Promise<boolean> {
  const status = getScreenPermissionStatus()
  if (status === 'granted' || status === 'unsupported') return true
  if (!promptIfNeeded) return false

  const result = await requestScreenPermission()
  return result.granted || getScreenPermissionStatus() === 'granted'
}

function taskFocusContext(task: {
  title: string
  description?: string
  subtasks?: unknown[]
  active_subtask_id?: string | null
  work_phase?: string
}) {
  return taskSubtaskContextFromTask(task as Parameters<typeof taskSubtaskContextFromTask>[0])
}

function persistFocusCheckResult(
  data: ReturnType<typeof readData>,
  taskId: string,
  result: Awaited<ReturnType<typeof checkDeviationFromScreen>>,
  threshold = 0.7
) {
  data.settings = {
    ...data.settings,
    currentActivity: result.currentActivity,
    lastScreenshotPath: result.imagePath,
    lastActivityDetectedAt: new Date().toISOString(),
    lastSimilarity: result.similarity,
    lastOnTask: result.onTask,
    lastFocusNote: result.suggestion,
    lastCheckedTaskId: taskId
  }

  const taskIndex = data.tasks.findIndex((t: { id: string }) => t.id === taskId)
  if (taskIndex !== -1 && result.imagePath) {
    const task = data.tasks[taskIndex]
    const nextTask: Record<string, unknown> = {
      ...task,
      focus_capture_history: appendFocusCapture(
        task.focus_capture_history as FocusCaptureRecord[] | undefined,
        result.imagePath
      ),
      updated_at: new Date().toISOString()
    }

    if (result.onTask && result.similarity >= threshold) {
      nextTask.last_on_task_capture = {
        imagePath: result.imagePath,
        capturedAt: new Date().toISOString(),
        similarity: result.similarity,
        activity: result.currentActivity
      }
    }

    if (
      !result.onTask &&
      result.work_mode === 'off_task' &&
      data.settings?.recordOffTaskWasted !== false
    ) {
      data.settings = recordOffTaskEpisode(data.settings, 300)
      nextTask.wasted_time_seconds = (task.wasted_time_seconds ?? 0) + 300
    }

    const flags = getFeatureFlagsFromSettings(data.settings)
    runAfterPipeline(getRegisteredModules(), 'focus.after', {
      task: nextTask,
      flags,
      focusResult: result,
      settings: data.settings,
      parsed: {
        codebase_phase_match: result.phase_mismatch === false,
        work_mode: result.work_mode
      }
    })
    data.tasks[taskIndex] = nextTask
  }

  writeData(data)

  const updatedTask = data.tasks.find((t: { id: string }) => t.id === taskId)
  if (updatedTask) {
    const flags = getFeatureFlagsFromSettings(data.settings)
    const busCtx: FeatureContext = {
      task: updatedTask,
      flags,
      focusResult: result,
      settings: data.settings
    }
    emitFeatureBus('focus.check_complete', busCtx)
    if (!result.onTask) {
      emitFeatureBus('focus.off_task', busCtx)
    }
  }
}

function screenStatsForTask(task: { focus_capture_history?: FocusCaptureRecord[] }) {
  return analyzeCaptureHistory(task.focus_capture_history ?? [])
}

function focusCheckOptionsForTask(
  task: { focus_capture_history?: FocusCaptureRecord[] },
  settings?: Record<string, unknown>
) {
  const hint = unchangedScreenHint(task.focus_capture_history)
  const base = hint
    ? {
        recentScreenSimilarity: hint.avgSimilarity,
        recentScreenSampleCount: hint.sampleCount
      }
    : {}
  return {
    ...base,
    featureFlags: getFeatureFlagsFromSettings(settings)
  }
}

function notifyFocusCheckComplete(
  taskId: string,
  taskTitle: string,
  result: Awaited<ReturnType<typeof checkDeviationFromScreen>>,
  nextCheckAt: number | null
) {
  sendNotification({
    type: 'focus_check_complete',
    data: {
      taskId,
      taskTitle,
      currentActivity: result.currentActivity,
      similarity: result.similarity,
      onTask: result.onTask,
      suggestion: result.suggestion,
      severity: result.severity,
      nextCheckAt,
      checkInProgress: false,
      screenCaptureSimilarity: screenStatsForTask(
        readData().tasks.find((t: { id: string }) => t.id === taskId) ?? {}
      ).averageSimilarity
    }
  })
}

async function sendDeviationAlert(
  alertData: Parameters<typeof deliverDeviationAlert>[2],
  deviationResult: Awaited<ReturnType<typeof checkDeviationFromScreen>>,
  task: WorkplaceTaskRecord
) {
  const data = readData()
  const settings = data.settings || {}
  let workplace_guidance = task.workplace_guidance

  if (
    settings.workplaceGuidanceEnabled !== false &&
    task.workplace_folder &&
    task.workplace_folder.trim()
  ) {
    try {
      const wpSettings = getWorkplaceSettingsFromData(data)
      if (!task.workplace_index?.tree_text) {
        const index = indexTaskWorkplace(task, wpSettings)
        if (index) {
          const idx = data.tasks.findIndex((t: { id: string }) => t.id === alertData.taskId)
          if (idx !== -1) {
            data.tasks[idx] = { ...data.tasks[idx], workplace_index: index }
            task = { ...task, workplace_index: index }
            writeData(data)
          }
        }
      }

      workplace_guidance =
        (await runDeviationRecovery(getOllamaModel(), task, deviationResult, {
          settings: wpSettings
        })) ?? workplace_guidance

      if (workplace_guidance) {
        const idx = data.tasks.findIndex((t: { id: string }) => t.id === alertData.taskId)
        if (idx !== -1) {
          data.tasks[idx] = {
            ...data.tasks[idx],
            workplace_guidance
          }
          writeData(data)
        }
      }
    } catch (err) {
      console.error('[workplace] Guidance on deviation failed:', err)
    }
  }

  const nativeKey = `deviation:${alertData.taskId}`
  const sendNative = shouldSendAlert(nativeKey, DEVIATION_ALERT_COOLDOWN_MS)

  void deliverDeviationAlert(mainWindow, tray, alertData, {
    sendNative,
    restoreWindow: alertData.severity === 'high'
  })
  sendNotification({
    type: 'deviation_alert',
    data: {
      ...alertData,
      notificationSent: sendNative,
      workplace_guidance,
      matched_subtask_id: deviationResult.matched_subtask_id,
      on_active_subtask: deviationResult.on_active_subtask,
      work_mode: deviationResult.work_mode,
      active_subtask_id: task.active_subtask_id ?? null,
      phase_mismatch: deviationResult.phase_mismatch,
      work_phase: (task as { work_phase?: string }).work_phase ?? null
    }
  })

  const flags = getFeatureFlagsFromSettings(settings)
  emitFeatureBus('deviation.alert', {
    task: task as Record<string, unknown>,
    flags,
    focusResult: deviationResult,
    settings
  })
  if (!deviationResult.onTask) {
    emitFeatureBus('focus.off_task', {
      task: task as Record<string, unknown>,
      flags,
      focusResult: deviationResult,
      settings
    })
  }
}

function maybeNotifyStaleProgress(task: any, settings: Record<string, any>) {
  const status = getTaskTimeStatusFromList(readData().tasks || [], task.id)
  const sensitivity = (settings.staleSensitivity as StaleSensitivity) || 'medium'
  const screenStats = screenStatsForTask(task)
  const stale = computeStaleScore(
    {
      progressPercent: task.progress_percent ?? checklistProgressPercent(task.progress_checklist) ?? 0,
      progressUpdatedAt: task.progress_updated_at ?? null,
      recordedSeconds: status?.liveSeconds ?? task.recorded_seconds ?? 0,
      estimateMinutes: effectiveEstimateMinutes(task),
      lastOnTask: settings.lastOnTask ?? null,
      lastSimilarity: settings.lastSimilarity ?? null,
      sessionOpen: !!status?.isRunning,
      pomodoroCyclesCompleted,
      screenCaptureSimilarity: screenStats.averageSimilarity,
      screenCaptureSampleCount: screenStats.sampleCount
    },
    sensitivity
  )

  if (stale.level === 'ok') return stale

  sendNotification({
    type: 'stale_progress',
    data: { taskId: task.id, taskTitle: task.title, ...stale }
  })

  const nativeKey = `stale:${task.id}`
  if (
    stale.level === 'alert' &&
    shouldSendAlert(nativeKey, STALE_ALERT_COOLDOWN_MS)
  ) {
    void showNativeNotification({
      title: `Progress stale — ${task.title}`,
      body: stale.reasons[0] ?? 'Update progress or re-estimate this task.',
      subtitle: 'Task Assistant'
    })
  }

  return stale
}

async function runDeviationCheck(fromPoll = false) {
  if (fromPoll && isCheckInProgress()) return

  if (snoozeUntil && Date.now() < snoozeUntil) {
    if (fromPoll) {
      const data = readData()
      const minutes = data.settings?.pollIntervalMinutes ?? 5
      const nextAt = scheduleNextCheck(minutes, () => runDeviationCheck(true))
      persistNextCheckAt(nextAt)
    }
    return
  }

  const data = readData()
  const settings = data.settings || {}
  const activeTaskId = settings.activeTaskId

  if (!activeTaskId) return
  if (settings.autoScreenshotMonitoring === false) return

  const task = data.tasks.find((t: any) => t.id === activeTaskId)
  if (!task || task.status === 'completed') return

  const taskContext = taskFocusContext(task)
  const threshold = settings.deviationThreshold ?? 0.7
  let nextCheckAt: number | null = null

  setCheckInProgress(true)
  sendNotification({ type: 'monitoring_check_started', data: { checkInProgress: true } })

  try {
    const permitted = await ensureScreenPermission(!fromPoll)
    if (!permitted) {
      if (!fromPoll) {
        throw new Error('Screen Recording permission required. Enable it in System Settings.')
      }
      sendNotification({
        type: 'screen_permission_needed',
        data: { status: getScreenPermissionStatus() }
      })
      void showNativeNotification({
        title: 'Screen Recording required',
        body: 'Enable Task Assistant (or Electron in dev) in System Settings → Screen Recording.',
        subtitle: 'Task Assistant'
      })
      return
    }

    const result = await checkDeviationFromScreen(
      getOllamaModel(),
      taskContext,
      true,
      focusCheckOptionsForTask(task, settings)
    )

    persistFocusCheckResult(data, activeTaskId, result, threshold)

    const refreshedTask =
      readData().tasks.find((t: { id: string }) => t.id === activeTaskId) ?? task

    if (result.similarity < threshold || !result.onTask) {
      const alertData = {
        severity: result.severity,
        similarity: result.similarity,
        onTask: result.onTask,
        suggestion: result.suggestion,
        currentActivity: result.currentActivity,
        expectedTask: result.expectedTask,
        taskId: activeTaskId,
        taskTitle: task.title
      }

      logDeviation({ ...alertData, fromPoll })
      await sendDeviationAlert(alertData, result, refreshedTask)
    }

    maybeNotifyStaleProgress(refreshedTask, settings)

    if (fromPoll && settings.autoScreenshotMonitoring !== false) {
      const minutes = settings.pollIntervalMinutes ?? 5
      nextCheckAt = scheduleNextCheck(minutes, () => runDeviationCheck(true))
      persistNextCheckAt(nextCheckAt)
    }

    notifyFocusCheckComplete(activeTaskId, task.title, result, nextCheckAt)
  } catch (error) {
    if (fromPoll) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('Ollama') || message.includes('Empty')) {
        console.warn('Deviation poll skipped:', message)
      } else {
        console.error('Deviation poll error:', error)
      }
      const minutes = settings.pollIntervalMinutes ?? 5
      nextCheckAt = scheduleNextCheck(minutes, () => runDeviationCheck(true))
      persistNextCheckAt(nextCheckAt)
    } else {
      throw error
    }
  } finally {
    setCheckInProgress(false)
    if (fromPoll && settings.autoScreenshotMonitoring !== false && nextCheckAt === null) {
      const minutes = settings.pollIntervalMinutes ?? 5
      nextCheckAt = scheduleNextCheck(minutes, () => runDeviationCheck(true))
      persistNextCheckAt(nextCheckAt)
    }
    broadcastMonitoringState(nextCheckAt)
  }
}

function startDeviationPolling(runImmediately = false) {
  cancelScheduledCheck()

  const data = readData()
  const settings = data.settings || {}

  if (settings.autoScreenshotMonitoring === false || !settings.activeTaskId) {
    disableBackgroundMonitoring()
    updateTrayForMonitoring(false)
    return
  }

  enableBackgroundMonitoring()
  updateTrayForMonitoring(true, settings.pollIntervalMinutes)

  if (runImmediately) {
    runDeviationCheck(true)
    return
  }

  const existingNext = settings.nextCheckAt
  if (existingNext && existingNext > Date.now()) {
    scheduleCheckAt(existingNext, () => runDeviationCheck(true))
    broadcastMonitoringState(existingNext)
  } else {
    runDeviationCheck(true)
  }
}

function stopDeviationPolling() {
  cancelScheduledCheck()
  disableBackgroundMonitoring()
  updateTrayForMonitoring(false)

  const data = readData()
  data.settings = { ...data.settings, nextCheckAt: null }
  writeData(data)
  broadcastMonitoringState(null)
}

function setupIpcHandlers() {
  registerFeatureIpc(ipcMain, {
    readData,
    writeData,
    getFeatureFlags
  })

  ipcMain.handle('get-tasks', async () => {
    const data = readData()
    return data.tasks || []
  })

  ipcMain.handle('create-task', async (_: any, task: any) => {
    const { v4: uuidv4 } = await import('uuid')
    const id = uuidv4()

    const newTask = {
      id,
      ...task,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    const data = readData()
    data.tasks.push(newTask)
    writeData(data)

    return newTask
  })

  ipcMain.handle('update-task', async (_: any, id: string, updates: any) => {
    const data = readData()
    const taskIndex = data.tasks.findIndex((t: any) => t.id === id)

    if (taskIndex !== -1) {
      const nextUpdates = { ...updates }
      if ('progress_percent' in nextUpdates || 'progress_checklist' in nextUpdates) {
        nextUpdates.progress_updated_at = new Date().toISOString()
      }

      if ('progress_checklist' in nextUpdates && !('progress_percent' in nextUpdates)) {
        const fromChecklist = checklistProgressPercent(nextUpdates.progress_checklist)
        if (fromChecklist != null) {
          nextUpdates.progress_percent = fromChecklist
        }
      }

      data.tasks[taskIndex] = {
        ...data.tasks[taskIndex],
        ...nextUpdates,
        updated_at: new Date().toISOString()
      }
      writeData(data)
      return data.tasks[taskIndex]
    }

    throw new Error('Task not found')
  })

  ipcMain.handle('delete-task', async (_: any, id: string) => {
    const data = readData()
    const task = data.tasks.find((t: any) => t.id === id)
    if (task && findRunningTaskId([task]) === id) {
      const { tasks } = pauseTaskWork(data.tasks, id, 'system')
      data.tasks = tasks
    }
    data.tasks = data.tasks.filter((t: any) => t.id !== id)
    if (data.settings?.activeTaskId === id) {
      data.settings.activeTaskId = null
    }
    writeData(data)
    return { success: true }
  })

  ipcMain.handle('start-task-work', async (_: any, taskId: string) => {
    const data = readData()
    const { tasks, task } = startTaskWork(data.tasks || [], taskId)
    data.tasks = tasks

    const taskIndex = data.tasks.findIndex((t: { id: string }) => t.id === taskId)
    if (taskIndex !== -1) {
      const row = data.tasks[taskIndex]
      const patches: Record<string, unknown> = { ...row }

      if (!row.drive_work_started_at) {
        patches.drive_work_started_at = new Date().toISOString()
      }

      if (row.workplace_folder) {
        const index = indexTaskWorkplace(
          row as WorkplaceTaskRecord,
          getWorkplaceSettingsFromData(data)
        )
        if (index) {
          patches.workplace_index = index
        }
      }

      data.tasks[taskIndex] = patches
    }

    data.settings = {
      ...data.settings,
      activeTaskId: taskId,
      timeTrackingPaused: false
    }
    writeData(data)
    configurePomodoro(getPomodoroSettingsFromData(data))
    startPomodoroWork(taskId)
    sendNotification({ type: 'pomodoro_updated', data: getPomodoroState() })
    notifyTimeTrackingUpdate(taskId)
    return data.tasks.find((t: { id: string }) => t.id === taskId) ?? task
  })

  ipcMain.handle('pause-task-work', async (_: any, taskId: string) => {
    const data = readData()
    const { tasks, task } = pauseTaskWork(data.tasks || [], taskId, 'user')
    data.tasks = tasks
    data.settings = { ...data.settings, timeTrackingPaused: true }
    writeData(data)
    stopPomodoro()
    sendNotification({ type: 'pomodoro_updated', data: getPomodoroState() })
    notifyTimeTrackingUpdate(taskId)
    return task
  })

  ipcMain.handle('resume-task-work', async (_: any, taskId: string) => {
    const data = readData()
    const { tasks, task } = resumeTaskWork(data.tasks || [], taskId)
    data.tasks = tasks
    data.settings = {
      ...data.settings,
      activeTaskId: taskId,
      timeTrackingPaused: false,
      snoozePausedTaskId: null
    }
    writeData(data)
    configurePomodoro(getPomodoroSettingsFromData(data))
    startPomodoroWork(taskId)
    sendNotification({ type: 'pomodoro_updated', data: getPomodoroState() })
    notifyTimeTrackingUpdate(taskId)
    return task
  })

  ipcMain.handle('complete-task-work', async (_: any, taskId: string) => {
    const data = readData()
    const { tasks, task } = completeTaskWork(data.tasks || [], taskId)
    data.tasks = tasks

    const estimate = effectiveEstimateMinutes(task as Record<string, unknown>)
    const actualMinutes = Math.round(((task as { recorded_seconds?: number }).recorded_seconds ?? 0) / 60)
    if (estimate && actualMinutes > 0) {
      data.settings = recordCalibrationSample(
        data.settings || {},
        estimate,
        actualMinutes
      ) as typeof data.settings
    }

    if (data.settings?.activeTaskId === taskId) {
      data.settings.activeTaskId = null
    }
    data.settings = { ...data.settings, timeTrackingPaused: false }
    writeData(data)
    stopPomodoro()
    pomodoroCyclesCompleted = 0
    sendNotification({ type: 'pomodoro_updated', data: getPomodoroState() })
    stopDeviationPolling()
    notifyTimeTrackingUpdate(taskId)
    return task
  })

  ipcMain.handle('get-task-time-status', async (_: any, taskId: string) => {
    const data = readData()
    return getTaskTimeStatusFromList(data.tasks || [], taskId)
  })

  ipcMain.handle('check-deviation-from-screen', async (_: any, taskId: string) => {
    const data = readData()
    const task = data.tasks.find((t: any) => t.id === taskId)
    if (!task) throw new Error('Task not found')

    const permitted = await ensureScreenPermission(true)
    if (!permitted) {
      throw new Error(
        'Screen Recording permission required. Open System Settings → Privacy → Screen Recording and enable Task Assistant.'
      )
    }

    const result = await checkDeviationFromScreen(
      getOllamaModel(),
      taskFocusContext(task),
      true,
      focusCheckOptionsForTask(task, data.settings)
    )

    data.settings = { ...data.settings, activeTaskId: taskId }
    const threshold = data.settings?.deviationThreshold ?? 0.7
    persistFocusCheckResult(data, taskId, result, threshold)
    notifyFocusCheckComplete(taskId, task.title, result, data.settings?.nextCheckAt ?? null)

    if (result.similarity < threshold || !result.onTask) {
      const refreshed = readData().tasks.find((t: { id: string }) => t.id === taskId) ?? task
      await sendDeviationAlert(
        {
          severity: result.severity,
          similarity: result.similarity,
          onTask: result.onTask,
          suggestion: result.suggestion,
          currentActivity: result.currentActivity,
          expectedTask: result.expectedTask,
          taskId,
          taskTitle: task.title
        },
        result,
        refreshed
      )
    }

    return result
  })

  ipcMain.handle('check-deviation', async (_: any, _activity: string, taskDescription: string) => {
    const permitted = await ensureScreenPermission(true)
    if (!permitted) {
      throw new Error('Screen Recording permission required.')
    }
    return checkDeviationFromScreen(
      getOllamaModel(),
      { title: taskDescription, description: undefined },
      true
    )
  })

  ipcMain.handle('estimate-time', async (_: any, task: any) => {
    try {
      const subtasksText = task.subtasks?.map((st: any) => st.description).join(', ') || 'none'

      const prompt = `Estimate time in minutes for this task:
${formatPlannedTask(taskFocusContext(task))}
Subtasks: ${subtasksText}
Respond with JSON: {"total_minutes": number, "confidence": 0-1, "breakdown": {}}`

      const response = await axios.post(
        OLLAMA_API_URL,
        {
          model: getOllamaModel(),
          prompt,
          stream: false,
          format: 'json'
        },
        { timeout: 30000 }
      )

      const result = JSON.parse(response.data.response)
      const data = readData()
      const raw = result.total_minutes ?? 60
      const calibrated = applyCalibration(raw, data.settings || {})

      return {
        estimate: calibrated,
        rawEstimate: raw,
        calibrationFactor: data.settings?.estimate_calibration_factor ?? 1,
        confidence: result.confidence,
        breakdown: result.breakdown
      }
    } catch (error: any) {
      console.error('Time estimation error:', error)
      return {
        estimate: 60,
        rawEstimate: 60,
        calibrationFactor: 1,
        confidence: 0.5,
        breakdown: {}
      }
    }
  })

  ipcMain.handle('suggest-communication', async (_: any, text: string, context: string) => {
    try {
      const prompt = `Improve this ${context} message:
"${text}"
Respond with JSON: {"suggestions": ["..."], "improvements": ["more clear", ...]}`

      const response = await axios.post(
        OLLAMA_API_URL,
        {
          model: getOllamaModel(),
          prompt,
          stream: false,
          format: 'json'
        },
        { timeout: 30000 }
      )

      const result = JSON.parse(response.data.response)
      return {
        suggestions: result.suggestions || [],
        improvements: result.improvements || []
      }
    } catch (error: any) {
      console.error('Communication suggestion error:', error)
      return {
        suggestions: [text],
        improvements: ['Unable to generate suggestions - Ollama may not be running']
      }
    }
  })

  ipcMain.handle('validate-sme', async (_: any, approach: string, domain: string) => {
    try {
      const prompt = `As a ${domain} expert, evaluate this approach:
"${approach}"
Respond with JSON: {"alignment": 0-1, "feedback": "...", "agreement": "agree"|"disagree"|"partial", "reasoning": "..."}`

      const response = await axios.post(
        OLLAMA_API_URL,
        {
          model: getOllamaModel(),
          prompt,
          stream: false,
          format: 'json'
        },
        { timeout: 30000 }
      )

      const result = JSON.parse(response.data.response)
      const alignment = result.alignment ?? 0.5
      let agreement: 'agree' | 'disagree' | 'partial' = result.agreement
      if (!agreement) {
        if (alignment >= 0.7) agreement = 'agree'
        else if (alignment >= 0.4) agreement = 'partial'
        else agreement = 'disagree'
      }

      return {
        alignment,
        feedback: result.feedback || '',
        agreement,
        reasoning: result.reasoning || result.feedback || ''
      }
    } catch (error: any) {
      console.error('SME validation error:', error)
      return {
        alignment: 0.5,
        feedback: 'Unable to validate - Ollama may not be running',
        agreement: 'partial' as const,
        reasoning: 'Ollama connection failed'
      }
    }
  })

  ipcMain.handle('pick-workplace-folder', async () => {
    const win =
      mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : BrowserWindow.getFocusedWindow() ?? undefined
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) {
      return { path: null as string | null }
    }
    return { path: result.filePaths[0] }
  })

  ipcMain.handle('index-workplace', async (_: any, taskId: string) => {
    const data = readData()
    const taskIndex = data.tasks.findIndex((t: { id: string }) => t.id === taskId)
    if (taskIndex === -1) throw new Error('Task not found')

    const task = data.tasks[taskIndex] as WorkplaceTaskRecord
    const index = indexTaskWorkplace(task, getWorkplaceSettingsFromData(data))
    if (!index) throw new Error('No valid workplace folder on this task')

    data.tasks[taskIndex] = { ...task, workplace_index: index, updated_at: new Date().toISOString() }
    writeData(data)
    return index
  })

  ipcMain.handle('open-workplace-path', async (_: any, taskId: string, relativePath: string) => {
    const data = readData()
    const task = data.tasks.find((t: { id: string }) => t.id === taskId) as
      | WorkplaceTaskRecord
      | undefined
    if (!task) throw new Error('Task not found')
    return openWorkplacePath(task, relativePath)
  })

  ipcMain.handle(
    'get-workplace-guidance',
    async (_: any, taskId: string, forceRefresh = false) => {
      const data = readData()
      const taskIndex = data.tasks.findIndex((t: { id: string }) => t.id === taskId)
      if (taskIndex === -1) throw new Error('Task not found')

      const task = data.tasks[taskIndex] as WorkplaceTaskRecord
      if (!task.workplace_folder?.trim()) {
        throw new Error('No workplace folder set on this task')
      }

      const deviation = {
        currentActivity: data.settings?.currentActivity || 'Unknown activity',
        activityLabel: 'manual',
        similarity: data.settings?.lastSimilarity ?? 0.3,
        imagePath: data.settings?.lastScreenshotPath as string | undefined,
        suggestion: data.settings?.lastFocusNote || ''
      }

      const guidance = await runDeviationRecovery(getOllamaModel(), task, deviation, {
        settings: getWorkplaceSettingsFromData(data),
        forceRefresh: !!forceRefresh
      })

      if (guidance) {
        data.tasks[taskIndex] = {
          ...task,
          workplace_guidance: guidance,
          updated_at: new Date().toISOString()
        }
        writeData(data)
      }

      return guidance
    }
  )

  ipcMain.handle(
    'run-subtask-probe',
    async (
      _: unknown,
      taskId: string,
      opts: { trigger?: string; userLine?: string; thinkingBand?: string } = {}
    ) => {
      const data = readData()
      const task = data.tasks.find((t: { id: string }) => t.id === taskId)
      if (!task) throw new Error('Task not found')

      return runSubtaskProbe(
        getOllamaModel(),
        {
          task: {
            title: task.title,
            description: task.description,
            subtasks: task.subtasks,
            active_subtask_id: task.active_subtask_id,
            work_phase: task.work_phase
          },
          userLine: opts.userLine,
          thinkingBand: opts.thinkingBand,
          trigger: opts.trigger
        },
        data.settings?.featureFlags
      )
    }
  )

  ipcMain.handle(
    'record-stuck-event',
    async (
      _: unknown,
      taskId: string,
      payload: {
        trigger: string
        thinking_band: string
        subtask_id?: string
        ai_challenge?: string
        ai_suggested_subtask?: string
      }
    ) => {
      const { v4: uuidv4 } = await import('uuid')
      const data = readData()
      const taskIndex = data.tasks.findIndex((t: { id: string }) => t.id === taskId)
      if (taskIndex === -1) throw new Error('Task not found')

      const band = payload.thinking_band as 'under_10m' | '30m' | '1_2h' | 'more'
      const wastedSeconds = bandToSeconds(band, data.settings)
      const wasted = recordWastedTime(
        data.settings,
        band,
        data.tasks[taskIndex].wasted_time_seconds ?? 0
      )

      const event = {
        id: uuidv4(),
        recorded_at: new Date().toISOString(),
        trigger: payload.trigger,
        thinking_band: band,
        wasted_seconds_estimated: wastedSeconds,
        subtask_id: payload.subtask_id,
        ai_challenge: payload.ai_challenge,
        ai_suggested_subtask: payload.ai_suggested_subtask
      }

      const task = data.tasks[taskIndex]
      data.settings = wasted.settings
      data.tasks[taskIndex] = {
        ...task,
        stuck_events: [...(task.stuck_events ?? []), event],
        wasted_time_seconds: wasted.taskWastedSeconds,
        updated_at: new Date().toISOString()
      }
      writeData(data)
      return event
    }
  )

  ipcMain.handle(
    'set-active-subtask',
    async (_: unknown, taskId: string, subtaskId: string | null) => {
      const data = readData()
      const taskIndex = data.tasks.findIndex((t: { id: string }) => t.id === taskId)
      if (taskIndex === -1) throw new Error('Task not found')

      const task = data.tasks[taskIndex]
      const subtasks = (task.subtasks ?? []).map((st: { id: string; status?: string }) => ({
        ...st,
        status:
          st.id === subtaskId
            ? 'active'
            : st.status === 'active'
              ? 'pending'
              : st.status ?? 'pending'
      }))

      data.tasks[taskIndex] = {
        ...task,
        subtasks,
        active_subtask_id: subtaskId,
        updated_at: new Date().toISOString()
      }
      writeData(data)
      return data.tasks[taskIndex]
    }
  )

  ipcMain.handle('get-settings', async () => {
    const data = readData()
    return {
      ollamaModel: DEFAULT_OLLAMA_MODEL,
      deviationThreshold: 0.7,
      pollIntervalMinutes: 5,
      activeTaskId: null,
      currentActivity: '',
      workplaceGuidanceEnabled: true,
      ...defaultWorkplaceSettings(),
      ...data.settings
    }
  })

  ipcMain.handle('update-settings', async (_: any, settings: any) => {
    const data = readData()
    if (settings.pomodoro) {
      data.settings = {
        ...data.settings,
        pomodoro: { ...getPomodoroSettingsFromData(data), ...settings.pomodoro }
      }
      configurePomodoro(data.settings.pomodoro)
      delete settings.pomodoro
    }
    data.settings = { ...data.settings, ...settings }
    writeData(data)

    if ('pollIntervalMinutes' in settings || 'autoScreenshotMonitoring' in settings) {
      if (data.settings.autoScreenshotMonitoring === false) {
        stopDeviationPolling()
      } else {
        startDeviationPolling(false)
      }
    }

    return { success: true }
  })

  ipcMain.handle('get-screen-permission', async () => {
    return { status: getScreenPermissionStatus() }
  })

  ipcMain.handle('verify-screen-capture', async () => {
    const status = getScreenPermissionStatus()
    const captureWorks = await verifyScreenCaptureWorks()
    return { status, captureWorks }
  })

  ipcMain.handle('request-screen-permission', async () => {
    return requestScreenPermission()
  })

  ipcMain.handle('open-screen-settings', async () => {
    const opened = await openScreenRecordingSettings()
    return { opened, status: getScreenPermissionStatus() }
  })

  ipcMain.handle('test-native-notification', async () => {
    const ok = await showNativeNotification({
      title: 'Task Assistant',
      body: 'Notifications are working — you will see focus alerts here when off task.',
      subtitle: 'Test notification'
    })
    return { ok }
  })

  ipcMain.handle('open-notification-settings', async () => {
    const opened = await openNotificationSettings()
    return { opened }
  })

  ipcMain.handle('set-monitoring-interval', async (_: any, taskId: string | null, minutes: number | null) => {
    const data = readData()

    if (!taskId || minutes === null || minutes <= 0) {
      data.settings = {
        ...data.settings,
        autoScreenshotMonitoring: false
      }
      writeData(data)
      stopDeviationPolling()
      return { success: true, monitoring: false }
    }

    const permitted = await ensureScreenPermission(true)
    if (!permitted) {
      throw new Error(
        'Screen Recording permission required. Grant access in System Settings → Privacy → Screen Recording.'
      )
    }

    data.settings = {
      ...data.settings,
      activeTaskId: taskId,
      pollIntervalMinutes: minutes,
      autoScreenshotMonitoring: true
    }
    writeData(data)

    startDeviationPolling(true)
    const nextAt = readData().settings?.nextCheckAt ?? null
    return { success: true, monitoring: true, intervalMinutes: minutes, nextCheckAt: nextAt }
  })

  ipcMain.handle('get-pomodoro-status', async () => {
    return {
      state: getPomodoroState(),
      settings: getPomodoroSettings()
    }
  })

  ipcMain.handle('skip-pomodoro-phase', async () => {
    skipPomodoroPhase()
    sendNotification({ type: 'pomodoro_updated', data: getPomodoroState() })
    return getPomodoroState()
  })

  ipcMain.handle('get-monitoring-status', async () => {
    const data = readData()
    const settings = data.settings || {}
    return {
      monitoring: !!settings.autoScreenshotMonitoring && !!settings.activeTaskId,
      intervalMinutes: settings.pollIntervalMinutes ?? null,
      nextCheckAt: settings.nextCheckAt ?? null,
      checkInProgress: isCheckInProgress(),
      snoozeUntil,
      activeTaskId: settings.activeTaskId ?? null
    }
  })

  ipcMain.handle('check-ollama-health', async () => {
    return checkOllamaHealth()
  })

  ipcMain.handle('set-snooze', async (_: any, minutes: number) => {
    snoozeUntil = Date.now() + minutes * 60 * 1000

    const data = readData()
    const runningId = findRunningTaskId(data.tasks || [])
    const activeId = runningId || data.settings?.activeTaskId

    if (activeId) {
      const { tasks } = pauseTaskWork(data.tasks || [], activeId, 'snooze')
      data.tasks = tasks
      data.settings = {
        ...data.settings,
        snoozePausedTaskId: activeId,
        timeTrackingPaused: true
      }
      writeData(data)
      notifyTimeTrackingUpdate(activeId)
    }

    if (snoozeResumeTimeout) clearTimeout(snoozeResumeTimeout)
    snoozeResumeTimeout = setTimeout(() => {
      snoozeUntil = null
      const latest = readData()
      const resumeId = latest.settings?.snoozePausedTaskId
      if (resumeId && latest.tasks?.some((t: any) => t.id === resumeId && t.status === 'in_progress')) {
        const { tasks } = resumeTaskWork(latest.tasks, resumeId)
        latest.tasks = tasks
        latest.settings = {
          ...latest.settings,
          snoozePausedTaskId: null,
          timeTrackingPaused: false,
          activeTaskId: resumeId
        }
        writeData(latest)
        notifyTimeTrackingUpdate(resumeId)
      }
    }, minutes * 60 * 1000)

    return { success: true, until: snoozeUntil }
  })

  ipcMain.handle('set-active-task', async (_: any, taskId: string | null) => {
    const data = readData()
    data.settings = {
      ...data.settings,
      activeTaskId: taskId
    }
    writeData(data)

    if (taskId) {
      await ensureScreenPermission(true)
    }

    return { success: true }
  })

  ipcMain.handle('capture-screen', async () => {
    try {
      return await captureScreen()
    } catch (error: any) {
      console.error('Screen capture error:', error)
      throw error
    }
  })

  ipcMain.handle('capture-screen-base64', async () => {
    try {
      return await captureScreenBase64()
    } catch (error: any) {
      console.error('Screen capture base64 error:', error)
      throw error
    }
  })

  ipcMain.handle('get-recent-screenshots', async (_: any, limit: number = 10) => {
    try {
      return getRecentScreenshots(limit)
    } catch (error: any) {
      console.error('Get screenshots error:', error)
      return []
    }
  })

  ipcMain.handle('cleanup-screenshots', async () => {
    try {
      cleanupOldScreenshots()
      return { success: true }
    } catch (error: any) {
      console.error('Cleanup error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('analyze-screenshot-for-task', async (_: any, taskId: string, screenshotPath: string) => {
    try {
      const prompt = `Analyze this screenshot context and describe what the user is likely doing.
Provide activity description, label, and focus recommendation.
Respond with JSON: {"activity": "...", "label": "...", "recommendation": "..."}`

      const response = await axios.post(
        OLLAMA_API_URL,
        {
          model: getOllamaModel(),
          prompt,
          stream: false,
          format: 'json'
        },
        { timeout: 30000 }
      )

      const analysis = JSON.parse(response.data.response)

      const data = readData()
      const task = data.tasks.find((t: any) => t.id === taskId)

      if (!task) {
        throw new Error('Task not found')
      }

      const comparison = await compareTaskToActivity(
        getOllamaModel(),
        taskFocusContext(task),
        analysis.activity
      )
      const deviationScore = 1 - comparison.similarity

      const screenshotAnalysis = {
        timestamp: new Date().toISOString(),
        imagePath: screenshotPath,
        aiPrediction: analysis.activity,
        activityLabel: analysis.label,
        recommendation: comparison.explanation || analysis.recommendation,
        deviationScore,
        onTask: comparison.onTask,
        similarity: comparison.similarity
      }

      if (!task.screenshots) {
        task.screenshots = []
      }
      task.screenshots.push(screenshotAnalysis)
      task.updated_at = new Date().toISOString()
      writeData(data)

      return screenshotAnalysis
    } catch (error: any) {
      console.error('Screenshot analysis error:', error)
      return {
        timestamp: new Date().toISOString(),
        imagePath: screenshotPath,
        aiPrediction: 'Unable to analyze - Ollama may not be running',
        activityLabel: 'unknown',
        recommendation: 'Ensure Ollama is running and try again',
        deviationScore: 0.5
      }
    }
  })
}

app.whenReady().then(async () => {
  initDataStorage()
  migratePersistedData()
  await initNativeNotifications()

  initFeatureKernel({
    sendNotification,
    showNativeNotification,
    shouldSendAlert
  })

  setPomodoroPhaseEndHandler(async (event) => {
    const data = readData()
    const taskId = event.taskId
    if (!taskId) return

    if (event.phase === 'work') {
      pomodoroCyclesCompleted += 1
      const { tasks } = pauseTaskWork(data.tasks || [], taskId, 'break')
      data.tasks = tasks
      data.settings = { ...data.settings, timeTrackingPaused: true }
      writeData(data)
      notifyTimeTrackingUpdate(taskId)
      sendNotification({ type: 'pomodoro_updated', data: getPomodoroState() })

      void showNativeNotification({
        title: 'Break time',
        body:
          event.nextPhase === 'long_break'
            ? 'Long break — step away for a few minutes.'
            : 'Short break — stretch and rest your eyes.',
        subtitle: 'Task Assistant'
      })
      return
    }

    if (event.nextPhase === 'work') {
      const { tasks } = resumeTaskWork(data.tasks || [], taskId)
      data.tasks = tasks
      data.settings = {
        ...data.settings,
        activeTaskId: taskId,
        timeTrackingPaused: false
      }
      writeData(data)
      notifyTimeTrackingUpdate(taskId)
      sendNotification({ type: 'pomodoro_updated', data: getPomodoroState() })

      void showNativeNotification({
        title: 'Back to work',
        body: 'Break finished — work session resumed.',
        subtitle: 'Task Assistant'
      })
    }
  })

  const bootData = readData()
  configurePomodoro(getPomodoroSettingsFromData(bootData))

  setupIpcHandlers()
  createWindow()
  createTray()
  startDeviationPolling()
  startTimePersistenceLoop()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  const data = readData()
  data.tasks = checkpointAllTasks(data.tasks || [])
  writeData(data)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

export { getMainWindow }
