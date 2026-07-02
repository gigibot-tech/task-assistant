import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, protocol, screen } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { captureScreen, captureScreenBase64, cleanupOldScreenshots, getRecentScreenshots, getScreenPermissionStatus, requestScreenPermission, openScreenRecordingSettings, verifyScreenCaptureWorks, listCaptureDisplays, setCaptureDisplayResolver } from './screenCapture'
import { checkDeviationFromScreen, analyzeScreenshotActivity, analyzeScreenshotAtPath, compareTaskToActivity, formatPlannedTask } from './activityAnalysis'
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
  clearOllamaFailure,
  isOllamaFailure,
  isOllamaPaused,
  recordOllamaFailure
} from './ollamaFailure'
import {
  checkpointAllTasks,
  completeTaskWork,
  findRunningTaskId,
  getTaskTimeStatusFromList,
  migrateAllTaskTimes,
  pauseTaskWork,
  resumeTaskWork,
  startTaskWork,
  allocateTaskOfflineTime
} from './timeTrackingService'
import { getOpenSession } from './timeTracking'
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
import { estimateSubtaskMinutes, estimateTaskMinutes } from './taskEstimate'
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
  getFeatureFlagsFromSettings,
  isFeatureEnabled,
  mergeFeatureFlags
} from './features/registry'
import {
  getFeatureBus,
  getRegisteredModules,
  initFeatureKernel,
  runAfterPipeline
} from './features/kernel/register'
import { registerFeatureIpc } from './features/kernel/ipcRouter'
import {
  getActiveWorkplacePath,
  getReviewWorkplacePath,
  mergeTaskUpdate,
  normalizeTaskWorkspaces,
  type TaskWithWorkspaces
} from '../../src/shared/workplace/workspaces'
import type { DomainEvent, FeatureContext } from '../../src/shared/kernel/types'
import {
  applySemanticSorterMoves,
  getSemanticSorterSettingsFromData,
  runSemanticSorterDryRun,
  saveSemanticSorterFeedback
} from './semanticSorter/semanticSorter'
import { DEFAULT_SEMANTIC_SORTER_SETTINGS } from './semanticSorter/semanticSorterPaths'
import {
  DEFAULT_OLLAMA_NUM_PREDICT,
  getOllamaNumPredict
} from './ollamaSettings'
import { computeVisionBudget } from './visionPayload'
import { indexReviewWorktree } from './review/reviewIndexer'
import {
  applyScheduleToStatuses,
  generateReviewSchedule
} from './review/reviewScheduler'
import { runSmeValidation, smeTaskContextFromRecord } from './sme/smeValidator'
import { DEFAULT_DRIVE_ENABLED_ASPECTS } from '../../src/lib/taskDrive'
import { fromAppFileUrl } from '../../src/shared/appFileUrl'
import { migrateTaskToBreakdown, needsMigration } from '../../src/lib/taskBreakdownMigration'
import {
  setActiveBreakdownItem
} from '../../src/lib/breakdownHelpers'
import type { TaskBreakdownItem } from '../../src/lib/taskBreakdownTypes'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_OLLAMA_MODEL = 'gemma4:latest'
const OLLAMA_API_URL = 'http://localhost:11434/api/generate'
const OLLAMA_TAGS_URL = 'http://localhost:11434/api/tags'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-file',
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

function registerAppFileProtocol(): void {
  protocol.registerFileProtocol('app-file', (request, callback) => {
    try {
      const filePath = fromAppFileUrl(request.url)
      callback({ path: filePath })
    } catch (err) {
      console.error('[app-file] failed:', request.url, err)
      callback({ error: -2 })
    }
  })
}

let dataPath: string
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let snoozeUntil: number | null = null
let snoozeResumeTimeout: ReturnType<typeof setTimeout> | null = null
let timeCheckpointInterval: ReturnType<typeof setInterval> | null = null
let pomodoroCyclesCompleted = 0
let appIsQuitting = false

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
        ollamaNumPredict: DEFAULT_OLLAMA_NUM_PREDICT,
        deviationThreshold: 0.7,
        pollIntervalMinutes: 5,
        activeTaskId: null,
        currentActivity: '',
        lastSimilarity: null,
        lastOnTask: null,
        lastFocusNote: '',
        lastCheckedTaskId: null,
        lastScreenCaptureSimilarity: null,
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
        driveEnabledAspects: [...DEFAULT_DRIVE_ENABLED_ASPECTS],
        ...defaultWorkplaceSettings(),
        semanticSorter: { ...DEFAULT_SEMANTIC_SORTER_SETTINGS }
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

function syncCaptureDisplaySettings(data?: ReturnType<typeof readData>, persist = true) {
  const d = data ?? readData()
  d.settings = d.settings || {}
  const displays = screen.getAllDisplays()
  const count = displays.length
  const lastCount = d.settings.lastKnownDisplayCount as number | undefined

  if (typeof lastCount === 'number' && lastCount !== count) {
    delete d.settings.captureDisplayId
  }
  d.settings.lastKnownDisplayCount = count

  const stored = d.settings.captureDisplayId as number | undefined
  if (stored != null && !displays.some((disp) => disp.id === stored)) {
    delete d.settings.captureDisplayId
  }

  if (persist) writeData(d)
  return d
}

function resolveCaptureDisplayId(): number {
  const displays = screen.getAllDisplays()
  const stored = readData().settings?.captureDisplayId as number | undefined
  if (stored != null && displays.some((d) => d.id === stored)) return stored
  return screen.getPrimaryDisplay().id
}

function getCaptureDisplayState() {
  const data = readData()
  const displays = screen.getAllDisplays()
  const stored = data.settings?.captureDisplayId as number | undefined
  const validStored = stored != null && displays.some((d) => d.id === stored) ? stored : null
  const primaryId = screen.getPrimaryDisplay().id
  const index = validStored != null ? displays.findIndex((d) => d.id === validStored) : -1
  const label =
    validStored != null && index >= 0
      ? `Display ${index + 1}${validStored === primaryId ? ' (Primary)' : ''}`
      : null

  return {
    displayId: validStored,
    displayCount: displays.length,
    needsSelection: displays.length > 1 && validStored == null,
    label
  }
}

function migratePersistedData() {
  const data = readData()
  data.tasks = migrateAllTaskTimes(data.tasks || [])
    .map((task: TaskWithWorkspaces) => normalizeTaskWorkspaces(task))
    .map((task: Record<string, unknown>) => {
      if (needsMigration(task as Parameters<typeof needsMigration>[0])) {
        return migrateTaskToBreakdown(task as Parameters<typeof migrateTaskToBreakdown>[0])
      }
      return task
    })
  data.settings = data.settings || {}
  data.settings.featureFlags = mergeFeatureFlags(data.settings.featureFlags)
  if (!data.settings.semanticSorter) {
    data.settings.semanticSorter = { ...DEFAULT_SEMANTIC_SORTER_SETTINGS }
  }
  if (!Array.isArray(data.settings.driveEnabledAspects) || !data.settings.driveEnabledAspects.length) {
    data.settings.driveEnabledAspects = [...DEFAULT_DRIVE_ENABLED_ASPECTS]
  }
  syncCaptureDisplaySettings(data, false)
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

async function scheduleTaskEstimateAfterCreate(taskId: string) {
  try {
    const data = readData()
    const task = data.tasks.find((t: { id: string }) => t.id === taskId)
    if (!task || task.ai_estimate_minutes || !task.title?.trim()) return

    const health = await checkOllamaHealth()
    if (!health.online || !health.modelAvailable) return

    const result = await estimateTaskMinutes(getOllamaModel(), task, data.settings || {})
    const idx = data.tasks.findIndex((t: { id: string }) => t.id === taskId)
    if (idx === -1) return

    data.tasks[idx] = {
      ...data.tasks[idx],
      ai_estimate_minutes: result.estimate,
      updated_at: new Date().toISOString()
    }
    writeData(data)

    sendNotification({
      type: 'task_estimate_ready',
      data: { taskId, estimate: result.estimate, confidence: result.confidence }
    })
  } catch (err) {
    console.warn('[estimate] Auto-estimate on create failed:', err instanceof Error ? err.message : err)
  }
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

function checkOpenSessionsOnStartup() {
  const data = readData()
  const tasks = data.tasks || []

  const pending = data.settings?.pendingOfflineCheck as
    | { taskId: string; taskTitle: string; sessionEndedAt: string }
    | undefined

  if (pending?.taskId && pending.sessionEndedAt) {
    const offlineMinutes = Math.floor(
      (Date.now() - new Date(pending.sessionEndedAt).getTime()) / 60000
    )
    if (offlineMinutes > 5) {
      sendNotification({
        type: 'offline_time_prompt',
        data: {
          taskId: pending.taskId,
          taskTitle: pending.taskTitle,
          offlineMinutes,
          sessionStartedAt: pending.sessionEndedAt
        }
      })
    }
    return
  }

  for (const task of tasks) {
    const open = getOpenSession(task)
    if (!open) continue

    const offlineMinutes = Math.floor(
      (Date.now() - new Date(open.started_at).getTime()) / 60000
    )

    if (offlineMinutes > 5) {
      sendNotification({
        type: 'offline_time_prompt',
        data: {
          taskId: task.id,
          taskTitle: task.title,
          offlineMinutes,
          sessionStartedAt: open.started_at
        }
      })
    }
  }
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

  // Check for open sessions after window loads
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      checkOpenSessionsOnStartup()
    }, 1000) // Wait 1 second for UI to be ready
  })

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

function resolveBreakdownForTask(task: Record<string, unknown>): TaskBreakdownItem[] {
  if (Array.isArray(task.task_breakdown) && task.task_breakdown.length > 0) {
    return task.task_breakdown as TaskBreakdownItem[]
  }
  if (needsMigration(task as Parameters<typeof needsMigration>[0])) {
    return migrateTaskToBreakdown(task as Parameters<typeof migrateTaskToBreakdown>[0]).task_breakdown ?? []
  }
  return []
}

function taskFocusContext(task: {
  title: string
  description?: string
  task_breakdown?: TaskBreakdownItem[]
  subtasks?: unknown[]
  active_subtask_id?: string | null
  work_phase?: string
}) {
  const breakdown = task.task_breakdown?.length
    ? task.task_breakdown
    : resolveBreakdownForTask(task as Record<string, unknown>)
  return taskSubtaskContextFromTask({
    title: task.title,
    description: task.description,
    task_breakdown: breakdown,
    active_subtask_id: task.active_subtask_id,
    work_phase: task.work_phase
  })
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
    const captureHistory = appendFocusCapture(
      task.focus_capture_history as FocusCaptureRecord[] | undefined,
      result.imagePath
    )
    const screenStats = analyzeCaptureHistory(captureHistory)

    const nextTask: Record<string, unknown> = {
      ...task,
      focus_capture_history: captureHistory,
      updated_at: new Date().toISOString()
    }

    data.settings = {
      ...data.settings,
      lastScreenCaptureSimilarity:
        screenStats.sampleCount >= 2 ? screenStats.averageSimilarity : null
    }

    if (result.onTask && result.similarity >= threshold) {
      nextTask.last_on_task_capture = {
        imagePath: result.imagePath,
        capturedAt: new Date().toISOString(),
        similarity: result.similarity,
        activity: result.currentActivity
      }
    }

    if (result.imagePath) {
      const screenshots = [...((task.screenshots as unknown[]) ?? [])]
      screenshots.push({
        timestamp: new Date().toISOString(),
        imagePath: result.imagePath,
        aiPrediction: result.currentActivity,
        activityLabel: result.activityLabel ?? 'focus_check',
        recommendation: result.suggestion,
        deviationScore: 1 - result.similarity,
        onTask: result.onTask,
        similarity: result.similarity
      })
      nextTask.screenshots = screenshots
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
    featureFlags: getFeatureFlagsFromSettings(settings),
    numPredict: getOllamaNumPredict(settings, 'vision')
  }
}

function notifyFocusCheckComplete(
  taskId: string,
  taskTitle: string,
  result: Awaited<ReturnType<typeof checkDeviationFromScreen>>,
  nextCheckAt: number | null
) {
  const fresh = readData()
  const settings = fresh.settings || {}
  const task = fresh.tasks.find((t: { id: string }) => t.id === taskId) ?? {}
  const screenStats = screenStatsForTask(task)

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
      checkedAt: settings.lastActivityDetectedAt ?? new Date().toISOString(),
      screenCaptureSimilarity:
        typeof settings.lastScreenCaptureSimilarity === 'number'
          ? settings.lastScreenCaptureSimilarity
          : screenStats.sampleCount >= 2
            ? screenStats.averageSimilarity
            : null
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
    getActiveWorkplacePath(task)
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

function notifyOllamaUnavailable(
  message: string,
  pausedUntil: number,
  model: string
) {
  sendNotification({
    type: 'ollama_unavailable',
    data: { message, pausedUntil, model }
  })
  void showNativeNotification({
    title: 'Ollama unavailable — screen checks paused',
    body: `${message}. Retrying after ${new Date(pausedUntil).toLocaleTimeString()}.`,
    subtitle: 'Task Assistant'
  })
}

function applyOllamaPollFailure(
  data: ReturnType<typeof readData>,
  error: Error
): number {
  data.settings = recordOllamaFailure(data.settings || {}, error)
  writeData(data)
  const pausedUntil = data.settings.ollamaPausedUntil as number
  notifyOllamaUnavailable(error.message, pausedUntil, getOllamaModel())
  scheduleCheckAt(pausedUntil, () => runDeviationCheck(true))
  persistNextCheckAt(pausedUntil)
  broadcastMonitoringState(pausedUntil)
  return pausedUntil
}

async function runDeviationCheck(fromPoll = false) {
  if (appIsQuitting) return
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

  if (fromPoll && isOllamaPaused(settings)) {
    const pausedUntil = settings.ollamaPausedUntil as number
    scheduleCheckAt(pausedUntil, () => runDeviationCheck(true))
    persistNextCheckAt(pausedUntil)
    broadcastMonitoringState(pausedUntil)
    return
  }

  if (fromPoll) {
    const health = await checkOllamaHealth()
    if (!health.online) {
      applyOllamaPollFailure(data, new Error('Ollama is offline — start it with: ollama serve'))
      return
    }
    if (!health.modelAvailable) {
      applyOllamaPollFailure(
        data,
        new Error(`Model "${health.model}" is not loaded — run: ollama run ${health.model}`)
      )
      return
    }
  }

  const task = data.tasks.find((t: any) => t.id === activeTaskId)
  if (!task || task.status === 'completed') return

  const taskContext = taskFocusContext(task)
  const threshold = settings.deviationThreshold ?? 0.7
  let nextCheckAt: number | null = null
  const ollamaWasPaused = isOllamaPaused(settings)

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
      {
        ...focusCheckOptionsForTask(task, settings),
        showErrorDialog: !fromPoll
      }
    )

    persistFocusCheckResult(data, activeTaskId, result, threshold)

    const afterSuccess = readData()
    afterSuccess.settings = clearOllamaFailure(afterSuccess.settings || {})
    writeData(afterSuccess)
    if (ollamaWasPaused) {
      sendNotification({ type: 'ollama_recovered', data: { model: getOllamaModel() } })
    }

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
      
      // Auto-pause task when off-task
      try {
        const currentData = readData()
        const { tasks: updatedTasks } = pauseTaskWork(currentData.tasks, activeTaskId, 'system')
        currentData.tasks = updatedTasks
        writeData(currentData)
        console.log('[auto-pause] Task paused due to off-task detection')
        sendNotification({
          type: 'task_auto_paused',
          data: {
            taskId: activeTaskId,
            taskTitle: task.title,
            reason: 'Off-task activity detected'
          }
        })
        
        // Show native notification with resume action
        void showNativeNotification({
          title: `Task paused — ${task.title}`,
          body: 'Off-task activity detected. Click to resume task.',
          onClick: () => {
            // Resume task when notification is clicked
            try {
              const data = readData()
              const { tasks: resumedTasks } = resumeTaskWork(data.tasks, activeTaskId)
              data.tasks = resumedTasks
              writeData(data)
              console.log('[auto-pause] Task manually resumed via notification click')
              sendNotification({
                type: 'task_auto_resumed',
                data: {
                  taskId: activeTaskId,
                  taskTitle: task.title
                }
              })
              void showNativeNotification({
                title: `Task resumed — ${task.title}`,
                body: 'You\'re back on track!'
              })
            } catch (err) {
              console.error('[auto-pause] Failed to resume task from notification:', err)
            }
          }
        })
      } catch (err) {
        console.error('[auto-pause] Failed to pause task:', err)
      }
    } else {
      // Auto-resume task when back on-task
      try {
        const currentData = readData()
        const timeStatus = getTaskTimeStatusFromList(currentData.tasks, activeTaskId)
        if (timeStatus && timeStatus.isPaused) {
          const { tasks: updatedTasks } = resumeTaskWork(currentData.tasks, activeTaskId)
          currentData.tasks = updatedTasks
          writeData(currentData)
          console.log('[auto-resume] Task resumed - back on task')
          sendNotification({
            type: 'task_auto_resumed',
            data: {
              taskId: activeTaskId,
              taskTitle: task.title
            }
          })
          
          // Show native notification confirming auto-resume
          void showNativeNotification({
            title: `Task resumed — ${task.title}`,
            body: 'You\'re back on track! Task automatically resumed.'
          })
        }
      } catch (err) {
        console.error('[auto-resume] Failed to resume task:', err)
      }
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
      const err = error instanceof Error ? error : new Error(String(error))
      if (isOllamaFailure(err)) {
        console.error('Deviation poll failed (Ollama):', err.message)
        applyOllamaPollFailure(readData(), err)
      } else {
        console.error('Deviation poll error:', error)
        const minutes = settings.pollIntervalMinutes ?? 5
        nextCheckAt = scheduleNextCheck(minutes, () => runDeviationCheck(true))
        persistNextCheckAt(nextCheckAt)
      }
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
  const flags = getFeatureFlagsFromSettings(settings)

  if (
    settings.autoScreenshotMonitoring === false ||
    !settings.activeTaskId ||
    !isFeatureEnabled(flags, 'focusMonitor')
  ) {
    disableBackgroundMonitoring()
    updateTrayForMonitoring(false)
    return
  }

  enableBackgroundMonitoring()
  updateTrayForMonitoring(true, settings.pollIntervalMinutes)

  if (isOllamaPaused(settings)) {
    const pausedUntil = settings.ollamaPausedUntil as number
    scheduleCheckAt(pausedUntil, () => runDeviationCheck(true))
    persistNextCheckAt(pausedUntil)
    broadcastMonitoringState(pausedUntil)
    return
  }

  if (runImmediately) {
    void runDeviationCheck(true)
    return
  }

  const existingNext = settings.nextCheckAt
  if (existingNext && existingNext > Date.now()) {
    scheduleCheckAt(existingNext, () => runDeviationCheck(true))
    broadcastMonitoringState(existingNext)
  } else {
    void runDeviationCheck(true)
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
    return (data.tasks || []).map((task: TaskWithWorkspaces) => normalizeTaskWorkspaces(task))
  })

  ipcMain.handle('create-task', async (_: any, task: any) => {
    const { v4: uuidv4 } = await import('uuid')
    const id = uuidv4()

    const newTask = normalizeTaskWorkspaces({
      id,
      ...task,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })

    const data = readData()
    data.tasks.push(newTask)
    writeData(data)

    void scheduleTaskEstimateAfterCreate(id)

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

      data.tasks[taskIndex] = mergeTaskUpdate(
        data.tasks[taskIndex] as TaskWithWorkspaces,
        { ...nextUpdates, updated_at: new Date().toISOString() }
      )
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
      let row = normalizeTaskWorkspaces(data.tasks[taskIndex] as TaskWithWorkspaces)
      if (!row.drive_work_started_at) {
        row = { ...row, drive_work_started_at: new Date().toISOString() }
      }

      if (getActiveWorkplacePath(row)) {
        const index = indexTaskWorkplace(row as WorkplaceTaskRecord, getWorkplaceSettingsFromData(data))
        if (index) {
          row = mergeTaskUpdate(row, { workplace_index: index })
        }
      }

      data.tasks[taskIndex] = row
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
    const { tasks, task } = pauseTaskWork(data.tasks || [], taskId, 'break')
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
    if (appIsQuitting) {
      throw new Error('App is closing — screen check cancelled')
    }
    const data = readData()
    const task = data.tasks.find((t: any) => t.id === taskId)
    if (!task) throw new Error('Task not found')

    const permitted = await ensureScreenPermission(true)
    if (!permitted) {
      throw new Error(
        'Screen Recording permission required. Open System Settings → Privacy → Screen Recording and enable Task Assistant.'
      )
    }

    const health = await checkOllamaHealth()
    if (!health.online) {
      throw new Error('Ollama is offline — start it with: ollama serve')
    }
    if (!health.modelAvailable) {
      throw new Error(`Model "${health.model}" is not loaded — run: ollama run ${health.model}`)
    }

    const wasPaused = isOllamaPaused(data.settings)

    const result = await checkDeviationFromScreen(
      getOllamaModel(),
      taskFocusContext(task),
      true,
      {
        ...focusCheckOptionsForTask(task, data.settings),
        showErrorDialog: true
      }
    )

    data.settings = { ...data.settings, activeTaskId: taskId }
    const threshold = data.settings?.deviationThreshold ?? 0.7
    persistFocusCheckResult(data, taskId, result, threshold)

    const afterSuccess = readData()
    afterSuccess.settings = clearOllamaFailure(afterSuccess.settings || {})
    writeData(afterSuccess)
    if (wasPaused) {
      sendNotification({ type: 'ollama_recovered', data: { model: getOllamaModel() } })
    }
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
    const data = readData()
    const stored = data.tasks.find((t: { id: string }) => t.id === task.id) ?? task
    const merged = { ...stored, ...task }
    return estimateTaskMinutes(getOllamaModel(), merged, data.settings || {})
  })

  ipcMain.handle('estimate-subtask-time', async (_: any, taskId: string, subtaskId: string) => {
    const data = readData()
    const task = data.tasks.find((t: { id: string }) => t.id === taskId)
    if (!task) throw new Error('Task not found')
    const breakdown = resolveBreakdownForTask(task)
    const item = breakdown.find((i: TaskBreakdownItem) => i.id === subtaskId)
    if (!item?.technical) throw new Error('Breakdown item not found')

    const subtask = {
      id: item.id,
      title: item.title,
      input: item.technical.input,
      output: item.technical.output,
      transformation: item.technical.transformation,
      outcome: item.technical.outcome,
      ai_estimate_minutes: item.ai_estimate_minutes
    }

    const result = await estimateSubtaskMinutes(
      getOllamaModel(),
      task,
      subtask,
      data.settings || {}
    )

    const idx = data.tasks.findIndex((t: { id: string }) => t.id === taskId)
    const itemIdx = breakdown.findIndex((i: TaskBreakdownItem) => i.id === subtaskId)
    if (idx !== -1 && itemIdx !== -1) {
      const nextBreakdown = [...breakdown]
      nextBreakdown[itemIdx] = { ...nextBreakdown[itemIdx], ai_estimate_minutes: result.estimate }
      data.tasks[idx] = {
        ...data.tasks[idx],
        task_breakdown: nextBreakdown,
        updated_at: new Date().toISOString()
      }
      writeData(data)
    }

    return result
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

  ipcMain.handle(
    'validate-sme-for-task',
    async (_: unknown, taskId: string, domain: string, approach: string) => {
      const data = readData()
      const taskIndex = data.tasks.findIndex((t: { id: string }) => t.id === taskId)
      if (taskIndex === -1) throw new Error('Task not found')

      const task = data.tasks[taskIndex] as Record<string, unknown>
      const entry = await runSmeValidation(
        getOllamaModel(),
        smeTaskContextFromRecord(task),
        domain,
        approach,
        data.settings
      )

      const validations = [...((task.sme_validations as unknown[]) ?? []), entry]
      data.tasks[taskIndex] = {
        ...task,
        sme_validations: validations,
        updated_at: new Date().toISOString()
      }
      writeData(data)
      return entry
    }
  )

  ipcMain.handle(
    'promote-sme-step-to-subtask',
    async (_: unknown, taskId: string, entryId: string, stepIndex: number) => {
      const data = readData()
      const taskIndex = data.tasks.findIndex((t: { id: string }) => t.id === taskId)
      if (taskIndex === -1) throw new Error('Task not found')

      const task = data.tasks[taskIndex] as Record<string, unknown>
      const validations = (task.sme_validations ?? []) as Array<{
        id: string
        recommended_steps?: Array<{ title: string; rationale: string }>
        promoted_subtask_ids?: string[]
      }>
      const entry = validations.find((e) => e.id === entryId)
      const step = entry?.recommended_steps?.[stepIndex]
      if (!entry || !step) throw new Error('SME step not found')

      const { v4: uuidv4 } = await import('uuid')
      const itemId = uuidv4()
      const rationale = step.rationale?.trim() || step.title
      const breakdownItem: TaskBreakdownItem = {
        id: itemId,
        title: step.title.trim(),
        type: 'technical',
        status: 'pending',
        created_at: new Date().toISOString(),
        source: 'ai_sme',
        sme_validation_id: entryId,
        order: resolveBreakdownForTask(task).length,
        technical: {
          input: '',
          output: step.title.trim(),
          transformation: rationale,
          outcome: rationale
        }
      }

      const nextValidations = validations.map((e) =>
        e.id === entryId
          ? {
              ...e,
              promoted_subtask_ids: [...(e.promoted_subtask_ids ?? []), itemId]
            }
          : e
      )

      const existingBreakdown = resolveBreakdownForTask(task)
      data.tasks[taskIndex] = {
        ...task,
        task_breakdown: [...existingBreakdown, breakdownItem],
        sme_validations: nextValidations,
        updated_at: new Date().toISOString()
      }
      writeData(data)
      return {
        subtask: {
          id: itemId,
          title: breakdownItem.title,
          input: '',
          output: breakdownItem.technical!.output,
          transformation: breakdownItem.technical!.transformation,
          outcome: breakdownItem.technical!.outcome,
          status: 'pending',
          created_at: breakdownItem.created_at,
          source: 'ai_sme',
          sme_validation_id: entryId
        },
        task: data.tasks[taskIndex]
      }
    }
  )

  /** @deprecated Use validate-sme-for-task */
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

  ipcMain.handle('semantic-sorter-pick-folder', async () => {
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

  ipcMain.handle('semantic-sorter-dry-run', async () => {
    const data = readData()
    const sorterSettings = getSemanticSorterSettingsFromData(data.settings)
    return runSemanticSorterDryRun(getOllamaModel(), sorterSettings)
  })

  ipcMain.handle(
    'semantic-sorter-apply',
    async (_: unknown, decisions: import('./semanticSorter/semanticSorterTypes').SorterDecision[]) => {
      if (!Array.isArray(decisions) || decisions.length === 0) {
        throw new Error('No decisions to apply')
      }
      return applySemanticSorterMoves(decisions)
    }
  )

  ipcMain.handle(
    'semantic-sorter-save-feedback',
    async (
      _: unknown,
      record: import('./semanticSorter/semanticSorterTypes').SemanticSorterFeedbackRecord
    ) => {
      saveSemanticSorterFeedback(record)
      return { success: true }
    }
  )

  ipcMain.handle('semantic-sorter-get-settings', async () => {
    const data = readData()
    return getSemanticSorterSettingsFromData(data.settings)
  })

  ipcMain.handle('semantic-sorter-update-settings', async (_: unknown, partial: Record<string, unknown>) => {
    const data = readData()
    data.settings = {
      ...data.settings,
      semanticSorter: {
        ...getSemanticSorterSettingsFromData(data.settings),
        ...partial
      }
    }
    writeData(data)
    return getSemanticSorterSettingsFromData(data.settings)
  })

  ipcMain.handle('index-workplace', async (_: any, taskId: string) => {
    const data = readData()
    const taskIndex = data.tasks.findIndex((t: { id: string }) => t.id === taskId)
    if (taskIndex === -1) throw new Error('Task not found')

    const task = normalizeTaskWorkspaces(data.tasks[taskIndex] as TaskWithWorkspaces)
    const index = indexTaskWorkplace(task as WorkplaceTaskRecord, getWorkplaceSettingsFromData(data))
    if (!index) throw new Error('No valid workplace folder on this task')

    data.tasks[taskIndex] = mergeTaskUpdate(task, {
      workplace_index: index,
      updated_at: new Date().toISOString()
    })
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

      const task = normalizeTaskWorkspaces(data.tasks[taskIndex] as TaskWithWorkspaces)
      if (!getActiveWorkplacePath(task)) {
        throw new Error('No workplace folder set on this task')
      }

      const deviation = {
        currentActivity: data.settings?.currentActivity || 'Unknown activity',
        activityLabel: 'manual',
        similarity: data.settings?.lastSimilarity ?? 0.3,
        imagePath: data.settings?.lastScreenshotPath as string | undefined,
        suggestion: data.settings?.lastFocusNote || ''
      }

      const guidance = await runDeviationRecovery(getOllamaModel(), task as WorkplaceTaskRecord, deviation, {
        settings: getWorkplaceSettingsFromData(data),
        forceRefresh: !!forceRefresh
      })

      if (guidance) {
        data.tasks[taskIndex] = mergeTaskUpdate(task, {
          workplace_guidance: guidance,
          updated_at: new Date().toISOString()
        })
        writeData(data)
      }

      return guidance
    }
  )

  ipcMain.handle('index-worktree-files', async (_: any, taskId: string) => {
    const data = readData()
    const taskIndex = data.tasks.findIndex((t: { id: string }) => t.id === taskId)
    if (taskIndex === -1) throw new Error('Task not found')

    const task = normalizeTaskWorkspaces(data.tasks[taskIndex] as TaskWithWorkspaces)
    const workplacePath = getReviewWorkplacePath(task)
    if (!workplacePath) {
      throw new Error('No review workspace set on this task')
    }

    const wpSettings = getWorkplaceSettingsFromData(data)
    const index = indexReviewWorktree(workplacePath, wpSettings)

    const existingStatuses = (task.review_statuses ?? {}) as Record<string, Record<string, unknown>>
    const merged: Record<string, Record<string, unknown>> = { ...existingStatuses }

    for (const file of index.files) {
      const prev = merged[file.path] as Record<string, unknown> | undefined
      merged[file.path] = {
        filePath: file.path,
        reviewed: prev?.reviewed === true,
        reviewedAt: prev?.reviewedAt,
        scheduledDate: prev?.scheduledDate,
        hidden: prev?.hidden,
        notes: prev?.notes,
        metadata: {
          size: file.size,
          extension: file.extension,
          lastModified: file.lastModified
        }
      }
    }

    data.tasks[taskIndex] = mergeTaskUpdate(task, {
      review_statuses: merged as TaskWithWorkspaces['review_statuses'],
      updated_at: new Date().toISOString()
    })
    writeData(data)

    return {
      files: index.files,
      totalFiles: index.totalFiles,
      indexedAt: index.indexedAt,
      review_statuses: merged,
      errors: index.errors
    }
  })

  ipcMain.handle(
    'generate-review-schedule',
    async (_: unknown, taskId: string, daysAvailable: number) => {
      const data = readData()
      const taskIndex = data.tasks.findIndex((t: { id: string }) => t.id === taskId)
      if (taskIndex === -1) throw new Error('Task not found')

      const task = normalizeTaskWorkspaces(data.tasks[taskIndex] as TaskWithWorkspaces)
      const workplacePath = getReviewWorkplacePath(task)
      if (!workplacePath) {
        throw new Error('No review workspace set on this task')
      }

      const wpSettings = getWorkplaceSettingsFromData(data)
      const index = indexReviewWorktree(workplacePath, wpSettings)
      const schedule = await generateReviewSchedule(
        getOllamaModel(),
        index.files,
        daysAvailable,
        data.settings
      )

      const existingStatuses = (task.review_statuses ?? {}) as Record<string, Record<string, unknown>>
      const review_statuses = applyScheduleToStatuses(existingStatuses, schedule)

      data.tasks[taskIndex] = mergeTaskUpdate(task, {
        review_schedule: schedule,
        review_statuses: review_statuses as TaskWithWorkspaces['review_statuses'],
        updated_at: new Date().toISOString()
      })
      writeData(data)

      return { schedule, review_statuses }
    }
  )

  ipcMain.handle(
    'allocate-offline-time',
    async (
      _: unknown,
      taskId: string,
      payload: { offlineStartIso: string; breakMinutes: number; workMinutes: number }
    ) => {
      const data = readData()
      const { tasks, task } = allocateTaskOfflineTime(
        data.tasks || [],
        taskId,
        payload.offlineStartIso,
        payload.workMinutes
      )
      data.tasks = tasks
      if (data.settings?.pendingOfflineCheck) {
        const nextSettings = { ...data.settings }
        delete nextSettings.pendingOfflineCheck
        data.settings = nextSettings
      }
      writeData(data)
      notifyTimeTrackingUpdate(taskId)
      return task
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
            task_breakdown: resolveBreakdownForTask(task),
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
      const breakdown = resolveBreakdownForTask(task)
      const updatedBreakdown = subtaskId
        ? setActiveBreakdownItem(breakdown, subtaskId)
        : breakdown.map((item: TaskBreakdownItem) => ({
            ...item,
            status: item.status === 'active' ? 'pending' : item.status
          }))

      data.tasks[taskIndex] = {
        ...task,
        task_breakdown: updatedBreakdown,
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
      ollamaNumPredict: DEFAULT_OLLAMA_NUM_PREDICT,
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
    if (settings.featureFlags) {
      data.settings.featureFlags = mergeFeatureFlags(settings.featureFlags)
    }
    writeData(data)

    if ('pollIntervalMinutes' in settings || 'autoScreenshotMonitoring' in settings || 'featureFlags' in settings) {
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
      return await captureScreen(resolveCaptureDisplayId())
    } catch (error: any) {
      console.error('Screen capture error:', error)
      throw error
    }
  })

  ipcMain.handle('capture-screen-base64', async () => {
    try {
      return await captureScreenBase64(resolveCaptureDisplayId())
    } catch (error: any) {
      console.error('Screen capture base64 error:', error)
      throw error
    }
  })

  ipcMain.handle('list-capture-displays', async () => {
    try {
      return await listCaptureDisplays()
    } catch (error: any) {
      console.error('List capture displays error:', error)
      return []
    }
  })

  ipcMain.handle('get-capture-display', async () => {
    syncCaptureDisplaySettings()
    return getCaptureDisplayState()
  })

  ipcMain.handle('set-capture-display', async (_: unknown, displayId: number) => {
    const data = readData()
    const displays = screen.getAllDisplays()
    if (!displays.some((d) => d.id === displayId)) {
      throw new Error('Display not found')
    }
    data.settings = {
      ...data.settings,
      captureDisplayId: displayId,
      lastKnownDisplayCount: displays.length
    }
    writeData(data)
    return getCaptureDisplayState()
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
      const data = readData()
      const task = data.tasks.find((t: any) => t.id === taskId)

      if (!task) {
        throw new Error('Task not found')
      }

      const analysis = await analyzeScreenshotAtPath(getOllamaModel(), screenshotPath, {
        numPredict: getOllamaNumPredict(data.settings, 'text'),
        showErrorDialog: true
      })

      const comparison = await compareTaskToActivity(
        getOllamaModel(),
        taskFocusContext(task),
        analysis.activity,
        {
          numPredict: getOllamaNumPredict(data.settings, 'text'),
          showErrorDialog: true
        }
      )
      const deviationScore = 1 - comparison.similarity

      const screenshotAnalysis = {
        timestamp: new Date().toISOString(),
        imagePath: screenshotPath,
        aiPrediction: analysis.activity,
        activityLabel: analysis.label,
        recommendation: comparison.explanation || analysis.activity,
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

async function checkOllamaAvailability(): Promise<boolean> {
  try {
    const response = await axios.get(OLLAMA_TAGS_URL, { timeout: 3000 })
    return response.status === 200
  } catch {
    return false
  }
}

async function waitForOllama(model: string): Promise<void> {
  const command = `ollama run ${model}`
  let dialogWindow: BrowserWindow | null = null
  let checkInterval: NodeJS.Timeout | null = null
  let isResolved = false

  return new Promise((resolve) => {
    // Create a simple dialog window
    dialogWindow = new BrowserWindow({
      width: 600,
      height: 400,
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    // Load HTML content directly
    dialogWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              padding: 40px;
              margin: 0;
              background: #f5f5f5;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
            }
            .container {
              background: white;
              padding: 30px;
              border-radius: 12px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.1);
              max-width: 500px;
            }
            h1 {
              color: #d32f2f;
              margin: 0 0 20px 0;
              font-size: 24px;
            }
            p {
              color: #333;
              line-height: 1.6;
              margin: 0 0 20px 0;
            }
            .command-box {
              background: #f5f5f5;
              border: 1px solid #ddd;
              border-radius: 6px;
              padding: 15px;
              font-family: 'Monaco', 'Courier New', monospace;
              font-size: 14px;
              margin: 20px 0;
              position: relative;
              word-break: break-all;
            }
            .copy-btn {
              background: #1976d2;
              color: white;
              border: none;
              padding: 10px 20px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 14px;
              margin-top: 10px;
              width: 100%;
            }
            .copy-btn:hover {
              background: #1565c0;
            }
            .copy-btn:active {
              background: #0d47a1;
            }
            .status {
              margin-top: 20px;
              padding: 10px;
              background: #fff3cd;
              border: 1px solid #ffc107;
              border-radius: 6px;
              color: #856404;
              text-align: center;
            }
            .checking {
              animation: pulse 1.5s ease-in-out infinite;
            }
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.5; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>⚠️ Ollama Not Running</h1>
            <p>Task Assistant requires Ollama to be running with the <strong>${model}</strong> model.</p>
            <p>Please run this command in your terminal:</p>
            <div class="command-box" id="command">${command}</div>
            <button class="copy-btn" onclick="copyCommand()">📋 Copy Command</button>
            <div class="status checking" id="status">
              🔄 Checking for Ollama connection...
            </div>
          </div>
          <script>
            function copyCommand() {
              navigator.clipboard.writeText('${command}').then(() => {
                const btn = document.querySelector('.copy-btn');
                const originalText = btn.textContent;
                btn.textContent = '✓ Copied!';
                btn.style.background = '#4caf50';
                setTimeout(() => {
                  btn.textContent = originalText;
                  btn.style.background = '#1976d2';
                }, 2000);
              });
            }
          </script>
        </body>
      </html>
    `)}`)

    dialogWindow.on('closed', () => {
      if (checkInterval) clearInterval(checkInterval)
      if (!isResolved) {
        isResolved = true
        app.quit()
      }
    })

    // Poll for Ollama availability every 2 seconds
    checkInterval = setInterval(async () => {
      const available = await checkOllamaAvailability()
      if (available && !isResolved) {
        isResolved = true
        if (checkInterval) clearInterval(checkInterval)
        if (dialogWindow && !dialogWindow.isDestroyed()) {
          dialogWindow.close()
        }
        resolve()
      }
    }, 2000)

    // Initial check
    checkOllamaAvailability().then((available) => {
      if (available && !isResolved) {
        isResolved = true
        if (checkInterval) clearInterval(checkInterval)
        if (dialogWindow && !dialogWindow.isDestroyed()) {
          dialogWindow.close()
        }
        resolve()
      }
    })
  })
}

app.whenReady().then(async () => {
  registerAppFileProtocol()
  initDataStorage()
  migratePersistedData()

  const visionBudget = computeVisionBudget()
  console.log(
    `[vision] budget at startup: max ${visionBudget.maxImagesInBudget} image(s) at ${visionBudget.maxWidth}x${visionBudget.maxHeight}, ~${Math.round(visionBudget.estimatedBytesPerImage / 1024)}KB/image, two=${visionBudget.twoImagesPossible}`
  )
  
  // Check Ollama availability early and wait if needed
  const ollamaAvailable = await checkOllamaAvailability()
  if (!ollamaAvailable) {
    const model = getOllamaModel()
    await waitForOllama(model)
  }
  
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
  setCaptureDisplayResolver(() => resolveCaptureDisplayId())
  syncCaptureDisplaySettings()

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
  appIsQuitting = true
  stopDeviationPolling()
  const data = readData()
  const runningId = findRunningTaskId(data.tasks || [])
  if (runningId) {
    const { tasks, task } = pauseTaskWork(data.tasks || [], runningId, 'break')
    data.tasks = tasks
    const sessions = (task.work_sessions ?? []) as Array<{ ended_at?: string | null }>
    const lastEnded = [...sessions].reverse().find((s) => s.ended_at)?.ended_at
    if (lastEnded) {
      data.settings = {
        ...data.settings,
        pendingOfflineCheck: {
          taskId: runningId,
          taskTitle: String(task.title ?? 'Task'),
          sessionEndedAt: lastEnded
        }
      }
    }
  }
  data.tasks = checkpointAllTasks(data.tasks || [])
  writeData(data)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

export { getMainWindow }
