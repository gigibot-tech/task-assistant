/** Safe wrappers — preload only loads on app start; renderer HMR can outpace main. */

export const REQUIRED_PRELOAD_VERSION = 11

export interface ScreenPermissionResponse {
  status: string
  granted: boolean
  openedSettings: boolean
  message: string
}

export interface TaskTimeStatus {
  taskId: string
  isRunning: boolean
  isPaused: boolean
  recordedSeconds: number
  liveSeconds: number
  breakSeconds: number
  pauseSeconds: number
  currentSessionStartedAt: string | null
  sessionCount: number
}

export interface MonitoringStatus {
  monitoring: boolean
  intervalMinutes: number | null
  nextCheckAt: number | null
  checkInProgress: boolean
  snoozeUntil: number | null
  activeTaskId: string | null
  /** True when preload has IPC but main process is outdated (needs full restart). */
  staleMainProcess?: boolean
}

function missing(fn: string): never {
  throw new Error(
    `${fn} is unavailable. Quit Task Assistant completely (Cmd+Q), then run npm run electron:dev again.`
  )
}

function hasFn(name: keyof Window['electron']): boolean {
  return typeof window.electron?.[name] === 'function'
}

function isStaleMainProcessError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('No handler registered')
}

export function monitoringStatusFromSettings(
  settings: Record<string, unknown>,
  staleMainProcess = false
): MonitoringStatus {
  return {
    monitoring: !!settings.autoScreenshotMonitoring && !!settings.activeTaskId,
    intervalMinutes:
      typeof settings.pollIntervalMinutes === 'number' ? settings.pollIntervalMinutes : null,
    nextCheckAt: typeof settings.nextCheckAt === 'number' ? settings.nextCheckAt : null,
    checkInProgress: false,
    snoozeUntil: null,
    activeTaskId: typeof settings.activeTaskId === 'string' ? settings.activeTaskId : null,
    staleMainProcess
  }
}

export function getPreloadDiagnostics(): { ready: boolean; version: number; missing: string[] } {
  const required: Array<keyof Window['electron']> = [
    'getScreenPermission',
    'requestScreenPermission',
    'setMonitoringInterval',
    'checkDeviationFromScreen',
    'getMonitoringStatus',
    'startTaskWork',
    'getTaskTimeStatus'
  ]
  const missingFns = required.filter((name) => !hasFn(name))
  const version =
    typeof window.electron?.preloadVersion === 'number' ? window.electron.preloadVersion : 0

  return {
    ready: missingFns.length === 0 && version >= REQUIRED_PRELOAD_VERSION,
    version,
    missing: missingFns.map(String)
  }
}

export function isScreenCaptureReady(): boolean {
  return getPreloadDiagnostics().ready
}

export async function verifyScreenCapture(): Promise<{ status: string; captureWorks: boolean }> {
  if (hasFn('verifyScreenCapture')) {
    try {
      return await window.electron.verifyScreenCapture()
    } catch (err) {
      if (!isStaleMainProcessError(err)) throw err
    }
  }
  if (hasFn('getScreenPermission')) {
    return { status: await getScreenPermissionStatus(), captureWorks: false }
  }
  missing('verifyScreenCapture')
}

export async function getScreenPermissionStatus(): Promise<string> {
  if (hasFn('getScreenPermission')) {
    try {
      const { status } = await window.electron.getScreenPermission()
      return status
    } catch (err) {
      if (!isStaleMainProcessError(err)) throw err
    }
  }
  return 'unknown'
}

export async function requestScreenPermission(): Promise<ScreenPermissionResponse> {
  if (hasFn('requestScreenPermission')) {
    return window.electron.requestScreenPermission()
  }
  missing('requestScreenPermission')
}

export async function openScreenSettings(): Promise<{ opened: boolean; status: string }> {
  if (hasFn('openScreenSettings')) {
    return window.electron.openScreenSettings()
  }

  if (hasFn('requestScreenPermission')) {
    const result = await window.electron.requestScreenPermission()
    return {
      opened: result.openedSettings || !result.granted,
      status: result.status
    }
  }

  missing('openScreenSettings')
}

export async function setMonitoringInterval(
  taskId: string | null,
  minutes: number | null
) {
  if (hasFn('setMonitoringInterval')) {
    return window.electron.setMonitoringInterval(taskId, minutes)
  }
  missing('setMonitoringInterval')
}

export async function getTaskTimeStatus(taskId: string): Promise<TaskTimeStatus | null> {
  if (!hasFn('getTaskTimeStatus')) {
    return null
  }
  try {
    return await window.electron.getTaskTimeStatus(taskId)
  } catch (err) {
    if (isStaleMainProcessError(err)) return null
    throw err
  }
}

export async function startTaskWork(taskId: string) {
  if (hasFn('startTaskWork')) return window.electron.startTaskWork(taskId)
  missing('startTaskWork')
}

export async function pauseTaskWork(taskId: string) {
  if (hasFn('pauseTaskWork')) return window.electron.pauseTaskWork(taskId)
  missing('pauseTaskWork')
}

export async function resumeTaskWork(taskId: string) {
  if (hasFn('resumeTaskWork')) return window.electron.resumeTaskWork(taskId)
  missing('resumeTaskWork')
}

export async function completeTaskWork(taskId: string) {
  if (hasFn('completeTaskWork')) return window.electron.completeTaskWork(taskId)
  missing('completeTaskWork')
}

/** Start or resume the work timer after committing to a probe subtask. */
export async function startOrResumeTaskWork(taskId: string): Promise<unknown> {
  const timeStatus = await getTaskTimeStatus(taskId)
  if (timeStatus?.isRunning) {
    if (hasFn('setActiveTask')) await window.electron.setActiveTask(taskId)
    return null
  }

  const task =
    timeStatus && timeStatus.sessionCount > 0
      ? await resumeTaskWork(taskId)
      : await startTaskWork(taskId)

  if (hasFn('setActiveTask')) await window.electron.setActiveTask(taskId)
  return task
}

export async function allocateOfflineTime(
  taskId: string,
  payload: { offlineStartIso: string; breakMinutes: number; workMinutes: number }
) {
  if (hasFn('allocateOfflineTime')) {
    return window.electron.allocateOfflineTime(taskId, payload)
  }
  missing('allocateOfflineTime')
}

export async function generateReviewSchedule(taskId: string, daysAvailable: number) {
  if (hasFn('generateReviewSchedule')) {
    return window.electron.generateReviewSchedule(taskId, daysAvailable)
  }
  missing('generateReviewSchedule')
}

export async function getMonitoringStatus(): Promise<MonitoringStatus> {
  const fromSettings = async (stale: boolean) => {
    if (!hasFn('getSettings')) {
      return monitoringStatusFromSettings({}, stale)
    }
    const settings = await window.electron.getSettings()
    return monitoringStatusFromSettings(settings, stale)
  }

  if (!hasFn('getMonitoringStatus')) {
    return fromSettings(true)
  }

  try {
    const status = await window.electron.getMonitoringStatus()
    return { ...status, staleMainProcess: false }
  } catch (err) {
    if (isStaleMainProcessError(err)) {
      return fromSettings(true)
    }
    throw err
  }
}

export async function checkDeviationFromScreen(taskId: string) {
  if (hasFn('checkDeviationFromScreen')) {
    return window.electron.checkDeviationFromScreen(taskId)
  }
  missing('checkDeviationFromScreen')
}

export async function pickWorkplaceFolder() {
  if (hasFn('pickWorkplaceFolder')) return window.electron.pickWorkplaceFolder()
  missing('pickWorkplaceFolder')
}

export async function indexWorkplace(taskId: string) {
  if (hasFn('indexWorkplace')) return window.electron.indexWorkplace(taskId)
  missing('indexWorkplace')
}

export async function openWorkplacePath(taskId: string, relativePath: string) {
  if (hasFn('openWorkplacePath')) return window.electron.openWorkplacePath(taskId, relativePath)
  missing('openWorkplacePath')
}

export async function getWorkplaceGuidance(taskId: string, forceRefresh = false) {
  if (hasFn('getWorkplaceGuidance')) {
    return window.electron.getWorkplaceGuidance(taskId, forceRefresh)
  }
  missing('getWorkplaceGuidance')
}

export async function runSubtaskProbe(
  taskId: string,
  opts?: { trigger?: string; userLine?: string; thinkingBand?: string }
) {
  if (hasFn('runSubtaskProbe')) return window.electron.runSubtaskProbe(taskId, opts)
  missing('runSubtaskProbe')
}

export async function recordStuckEvent(
  taskId: string,
  payload: {
    trigger: string
    thinking_band: string
    subtask_id?: string
    ai_challenge?: string
    ai_suggested_subtask?: string
  }
) {
  if (hasFn('recordStuckEvent')) return window.electron.recordStuckEvent(taskId, payload)
  missing('recordStuckEvent')
}

export async function setActiveSubtask(taskId: string, subtaskId: string | null) {
  if (hasFn('setActiveSubtask')) return window.electron.setActiveSubtask(taskId, subtaskId)
  missing('setActiveSubtask')
}

export async function getFeatureFlags() {
  if (hasFn('getFeatureFlags')) return window.electron.getFeatureFlags()
  const settings = await window.electron.getSettings()
  return settings.featureFlags ?? {}
}

export async function setWorkPhase(
  taskId: string,
  phase: string,
  source: 'user' | 'git' | 'probe' = 'user'
) {
  if (hasFn('setWorkPhase')) return window.electron.setWorkPhase(taskId, phase, source)
  missing('setWorkPhase')
}

export async function syncPhaseGitSignals(taskId: string) {
  if (hasFn('syncPhaseGitSignals')) return window.electron.syncPhaseGitSignals(taskId)
  missing('syncPhaseGitSignals')
}

export async function semanticSorterDryRun() {
  if (hasFn('semanticSorterDryRun')) return window.electron.semanticSorterDryRun()
  missing('semanticSorterDryRun')
}

export async function semanticSorterApply(
  decisions: Parameters<Window['electron']['semanticSorterApply']>[0]
) {
  if (hasFn('semanticSorterApply')) return window.electron.semanticSorterApply(decisions)
  missing('semanticSorterApply')
}

export async function semanticSorterSaveFeedback(
  record: Parameters<Window['electron']['semanticSorterSaveFeedback']>[0]
) {
  if (hasFn('semanticSorterSaveFeedback')) return window.electron.semanticSorterSaveFeedback(record)
  missing('semanticSorterSaveFeedback')
}

export async function semanticSorterPickFolder() {
  if (hasFn('semanticSorterPickFolder')) return window.electron.semanticSorterPickFolder()
  missing('semanticSorterPickFolder')
}

export async function semanticSorterGetSettings() {
  if (hasFn('semanticSorterGetSettings')) return window.electron.semanticSorterGetSettings()
  missing('semanticSorterGetSettings')
}

export async function semanticSorterUpdateSettings(partial: Record<string, unknown>) {
  if (hasFn('semanticSorterUpdateSettings'))
    return window.electron.semanticSorterUpdateSettings(partial)
  missing('semanticSorterUpdateSettings')
}
