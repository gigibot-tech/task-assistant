import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  preloadVersion: 9,
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  createTask: (task: any) => ipcRenderer.invoke('create-task', task),
  updateTask: (id: string, updates: any) => ipcRenderer.invoke('update-task', id, updates),
  deleteTask: (id: string) => ipcRenderer.invoke('delete-task', id),

  startTaskWork: (taskId: string) => ipcRenderer.invoke('start-task-work', taskId),
  pauseTaskWork: (taskId: string) => ipcRenderer.invoke('pause-task-work', taskId),
  resumeTaskWork: (taskId: string) => ipcRenderer.invoke('resume-task-work', taskId),
  completeTaskWork: (taskId: string) => ipcRenderer.invoke('complete-task-work', taskId),
  getTaskTimeStatus: (taskId: string) => ipcRenderer.invoke('get-task-time-status', taskId),
  getPomodoroStatus: () => ipcRenderer.invoke('get-pomodoro-status'),
  skipPomodoroPhase: () => ipcRenderer.invoke('skip-pomodoro-phase'),

  checkDeviationFromScreen: (taskId: string) =>
    ipcRenderer.invoke('check-deviation-from-screen', taskId),
  checkDeviation: (activity: string, task: string) =>
    ipcRenderer.invoke('check-deviation', activity, task),
  estimateTime: (task: any) => ipcRenderer.invoke('estimate-time', task),
  suggestCommunication: (text: string, context: string) =>
    ipcRenderer.invoke('suggest-communication', text, context),
  validateWithSME: (approach: string, domain: string) =>
    ipcRenderer.invoke('validate-sme', approach, domain),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings: any) => ipcRenderer.invoke('update-settings', settings),
  checkOllamaHealth: () => ipcRenderer.invoke('check-ollama-health'),
  setSnooze: (minutes: number) => ipcRenderer.invoke('set-snooze', minutes),
  setActiveTask: (taskId: string | null) => ipcRenderer.invoke('set-active-task', taskId),
  setMonitoringInterval: (taskId: string | null, minutes: number | null) =>
    ipcRenderer.invoke('set-monitoring-interval', taskId, minutes),
  getMonitoringStatus: () => ipcRenderer.invoke('get-monitoring-status'),
  getScreenPermission: () => ipcRenderer.invoke('get-screen-permission'),
  verifyScreenCapture: () => ipcRenderer.invoke('verify-screen-capture'),
  requestScreenPermission: () => ipcRenderer.invoke('request-screen-permission'),
  openScreenSettings: () => ipcRenderer.invoke('open-screen-settings'),
  testNativeNotification: () => ipcRenderer.invoke('test-native-notification'),
  openNotificationSettings: () => ipcRenderer.invoke('open-notification-settings'),

  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  captureScreenBase64: () => ipcRenderer.invoke('capture-screen-base64'),
  getRecentScreenshots: (limit?: number) => ipcRenderer.invoke('get-recent-screenshots', limit),
  cleanupScreenshots: () => ipcRenderer.invoke('cleanup-screenshots'),
  analyzeScreenshotForTask: (taskId: string, screenshotPath: string) =>
    ipcRenderer.invoke('analyze-screenshot-for-task', taskId, screenshotPath),

  pickWorkplaceFolder: () => ipcRenderer.invoke('pick-workplace-folder'),
  indexWorkplace: (taskId: string) => ipcRenderer.invoke('index-workplace', taskId),
  openWorkplacePath: (taskId: string, relativePath: string) =>
    ipcRenderer.invoke('open-workplace-path', taskId, relativePath),
  getWorkplaceGuidance: (taskId: string, forceRefresh?: boolean) =>
    ipcRenderer.invoke('get-workplace-guidance', taskId, forceRefresh),

  runSubtaskProbe: (
    taskId: string,
    opts?: { trigger?: string; userLine?: string; thinkingBand?: string }
  ) => ipcRenderer.invoke('run-subtask-probe', taskId, opts ?? {}),
  recordStuckEvent: (
    taskId: string,
    payload: {
      trigger: string
      thinking_band: string
      subtask_id?: string
      ai_challenge?: string
      ai_suggested_subtask?: string
    }
  ) => ipcRenderer.invoke('record-stuck-event', taskId, payload),
  setActiveSubtask: (taskId: string, subtaskId: string | null) =>
    ipcRenderer.invoke('set-active-subtask', taskId, subtaskId),

  getFeatureFlags: () => ipcRenderer.invoke('get-feature-flags'),
  setWorkPhase: (taskId: string, phase: string, source?: string) =>
    ipcRenderer.invoke('set-work-phase', taskId, phase, source ?? 'user'),
  syncPhaseGitSignals: (taskId: string) =>
    ipcRenderer.invoke('sync-phase-git-signals', taskId),

  onNotification: (callback: (data: any) => void) => {
    ipcRenderer.on('notification', (_, data) => callback(data))
  }
})

export interface DeviationScreenResult {
  similarity: number
  severity: 'low' | 'medium' | 'high'
  suggestion: string
  currentActivity: string
  activityLabel?: string
  imagePath?: string
  onTask: boolean
  expectedTask: string
}

export interface ElectronAPI {
  preloadVersion: number
  getTasks: () => Promise<any[]>
  createTask: (task: any) => Promise<any>
  updateTask: (id: string, updates: any) => Promise<any>
  deleteTask: (id: string) => Promise<{ success: boolean }>
  startTaskWork: (taskId: string) => Promise<any>
  pauseTaskWork: (taskId: string) => Promise<any>
  resumeTaskWork: (taskId: string) => Promise<any>
  completeTaskWork: (taskId: string) => Promise<any>
  getTaskTimeStatus: (taskId: string) => Promise<{
    taskId: string
    isRunning: boolean
    isPaused: boolean
    recordedSeconds: number
    liveSeconds: number
    currentSessionStartedAt: string | null
    sessionCount: number
  } | null>
  getPomodoroStatus: () => Promise<{
    state: {
      phase: 'idle' | 'work' | 'break' | 'long_break'
      cycleIndex: number
      phaseEndsAt: number | null
      taskId: string | null
    }
    settings: {
      enabled: boolean
      workMinutes: number
      breakMinutes: number
      longBreakMinutes: number
      cyclesBeforeLongBreak: number
      autoStartBreak: boolean
      autoStartWork: boolean
    }
  }>
  skipPomodoroPhase: () => Promise<{
    phase: 'idle' | 'work' | 'break' | 'long_break'
    cycleIndex: number
    phaseEndsAt: number | null
    taskId: string | null
  }>
  checkDeviationFromScreen: (taskId: string) => Promise<DeviationScreenResult>
  checkDeviation: (activity: string, task: string) => Promise<DeviationScreenResult>
  estimateTime: (task: any) => Promise<{
    estimate: number
    confidence: number
    breakdown: Record<string, number>
  }>
  suggestCommunication: (text: string, context: string) => Promise<{
    suggestions: string[]
    improvements: string[]
  }>
  validateWithSME: (approach: string, domain: string) => Promise<{
    alignment: number
    feedback: string
    agreement: 'agree' | 'disagree' | 'partial'
    reasoning: string
  }>
  getSettings: () => Promise<Record<string, any>>
  updateSettings: (settings: any) => Promise<{ success: boolean }>
  checkOllamaHealth: () => Promise<{ online: boolean; modelAvailable: boolean; model: string }>
  setSnooze: (minutes: number) => Promise<{ success: boolean; until: number }>
  setActiveTask: (taskId: string | null) => Promise<{ success: boolean }>
  setMonitoringInterval: (
    taskId: string | null,
    minutes: number | null
  ) => Promise<{ success: boolean; monitoring: boolean; intervalMinutes?: number; nextCheckAt?: number | null }>
  getMonitoringStatus: () => Promise<{
    monitoring: boolean
    intervalMinutes: number | null
    nextCheckAt: number | null
    checkInProgress: boolean
    snoozeUntil: number | null
    activeTaskId: string | null
  }>
  getScreenPermission: () => Promise<{ status: string }>
  verifyScreenCapture: () => Promise<{ status: string; captureWorks: boolean }>
  requestScreenPermission: () => Promise<{
    status: string
    granted: boolean
    openedSettings: boolean
    message: string
  }>
  openScreenSettings: () => Promise<{ opened: boolean; status: string }>
  testNativeNotification: () => Promise<{ ok: boolean }>
  openNotificationSettings: () => Promise<{ opened: boolean }>
  captureScreen: () => Promise<{ imagePath: string; timestamp: string; displayId: number }>
  captureScreenBase64: () => Promise<string>
  getRecentScreenshots: (limit?: number) => Promise<Array<{ imagePath: string; timestamp: string; displayId: number }>>
  cleanupScreenshots: () => Promise<{ success: boolean }>
  analyzeScreenshotForTask: (taskId: string, screenshotPath: string) => Promise<{
    timestamp: string
    imagePath: string
    aiPrediction: string
    activityLabel: string
    recommendation: string
    deviationScore: number
  }>
  pickWorkplaceFolder: () => Promise<{ path: string | null }>
  indexWorkplace: (taskId: string) => Promise<{
    indexed_at: string
    file_count: number
    tree_text: string
  }>
  openWorkplacePath: (
    taskId: string,
    relativePath: string
  ) => Promise<{ success: boolean; error?: string }>
  getWorkplaceGuidance: (
    taskId: string,
    forceRefresh?: boolean
  ) => Promise<{
    generated_at: string
    summary: string
    suggested_files: Array<{ path: string; reason: string }>
    suggested_actions: string[]
    tools_hint?: string
  } | null>
  runSubtaskProbe: (
    taskId: string,
    opts?: { trigger?: string; userLine?: string; thinkingBand?: string }
  ) => Promise<{
    challenge: string
    input: string
    output: string
    transformation: string
    smallest_slice: string
    suggested_subtask: {
      title: string
      input: string
      output: string
      transformation: string
      outcome: string
    }
    stupid_version_hint: string
    must_code_by: string
    build_one_now: string
    max_components: number
  }>
  recordStuckEvent: (
    taskId: string,
    payload: {
      trigger: string
      thinking_band: string
      subtask_id?: string
      ai_challenge?: string
      ai_suggested_subtask?: string
    }
  ) => Promise<{
    id: string
    recorded_at: string
    trigger: string
    thinking_band: string
    wasted_seconds_estimated: number
  }>
  setActiveSubtask: (taskId: string, subtaskId: string | null) => Promise<any>
  getFeatureFlags: () => Promise<Record<string, boolean>>
  setWorkPhase: (
    taskId: string,
    phase: string,
    source?: string
  ) => Promise<Record<string, unknown>>
  syncPhaseGitSignals: (taskId: string) => Promise<{
    suggested_phase: string
    confidence: number
    recent_commits_summary: string[]
    imbalance_score: number
    git_available: boolean
    phase_balance?: Record<string, unknown>
  }>
  onNotification: (callback: (data: any) => void) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}
